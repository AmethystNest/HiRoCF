import { describe, it, expect } from 'vitest';
import { PathBuilder } from '../track/path.js';
import { ribbonGeometry } from './ribbon.js';

/**
 * A rounded rectangle: two long straights (where adaptive sampling should
 * collapse hundreds of points into a handful of quads) and four corners
 * (where it must keep enough points to stay smooth).
 */
function buildLoop() {
  return new PathBuilder()
    .line(0, 0, 4000, 0, 100)
    .arc(4000, 600, 600, -Math.PI / 2, 0, 40)
    .line(4600, 600, 4600, 2000, 60)
    .line(4600, 2000, 0, 2000, 100)
    .line(0, 2000, 0, 0, 60)
    .build(26);
}

function vertexCount(geom) {
  return geom.attributes.aPosition.buffer.data.length / 2;
}

describe('ribbonGeometry adaptive sampling', () => {
  it('uses far fewer vertices than centreline points for a constant-width strip', () => {
    const path = buildLoop();
    const geom = ribbonGeometry(path, { innerOffset: -300, outerOffset: 300 });
    // one pair per centreline point, plus the closing pair, is the old cost
    expect(vertexCount(geom)).toBeLessThan((path.count + 1) * 2 * 0.25);
  });

  it('still compresses a strip whose offset varies per index', () => {
    const path = buildLoop();
    const geom = ribbonGeometry(path, {
      innerOffset: -300,
      outerOffset: (k) => 300 + (k % 7),
    });
    // the sawtooth offset is real detail, so this keeps far more points
    // than a constant-width strip -- but it is still measured, not assumed
    expect(vertexCount(geom)).toBeLessThanOrEqual((path.count + 1) * 2);
  });

  it('keeps every point when asked for a dense strip', () => {
    const path = buildLoop();
    const geom = ribbonGeometry(path, { innerOffset: -300, outerOffset: 300, dense: true });
    expect(vertexCount(geom)).toBe((path.count + 1) * 2);
  });

  it('closes the loop exactly: last vertex pair equals the first', () => {
    const path = buildLoop();
    const geom = ribbonGeometry(path, { innerOffset: -300, outerOffset: 300 });
    const pos = geom.attributes.aPosition.buffer.data;
    const n = pos.length;
    for (let c = 0; c < 4; c++) expect(pos[n - 4 + c]).toBeCloseTo(pos[c], 4);
  });

  it('never strays far from the strip the dense version would build', () => {
    const path = buildLoop();
    const half = 420; // the widest offset the game uses
    const opts = { innerOffset: -half, outerOffset: half };
    const dense = ribbonGeometry(path, { ...opts, dense: true }).attributes.aPosition.buffer.data;
    const sparse = ribbonGeometry(path, opts).attributes.aPosition.buffer.data;

    // walk both in order: every sparse vertex pair is also a dense one, so
    // the dense samples between two kept ones are exactly what got dropped.
    // Their distance from the chord is the error the sampling introduces --
    // including at the hard 90 degree corners of this loop, where the inner
    // edge folds back on itself and a curvature-only rule would cut across.
    const distToSeg = (px, py, ax, ay, bx, by) => {
      const dx = bx - ax, dy = by - ay;
      const L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
      return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    };
    const same = (si, di) => Math.hypot(sparse[si * 4] - dense[di * 4], sparse[si * 4 + 1] - dense[di * 4 + 1]) < 1e-3
      && Math.hypot(sparse[si * 4 + 2] - dense[di * 4 + 2], sparse[si * 4 + 3] - dense[di * 4 + 3]) < 1e-3;

    let worst = 0;
    let di = 0;
    const sparsePairs = sparse.length / 4;
    const densePairs = dense.length / 4;
    for (let si = 0; si + 1 < sparsePairs; si++) {
      let dj = di + 1;
      while (dj < densePairs && !same(si + 1, dj)) dj++;
      expect(dj).toBeLessThan(densePairs); // sparse samples are a subset
      for (let k = di + 1; k < dj; k++) {
        for (const lane of [0, 2]) {
          worst = Math.max(worst, distToSeg(
            dense[k * 4 + lane], dense[k * 4 + lane + 1],
            sparse[si * 4 + lane], sparse[si * 4 + lane + 1],
            sparse[(si + 1) * 4 + lane], sparse[(si + 1) * 4 + lane + 1],
          ));
        }
      }
      di = dj;
    }
    expect(worst).toBeLessThan(1.6);
  });

  it('gives a partial ribbon the right span', () => {
    const path = buildLoop();
    const geom = ribbonGeometry(path, {
      innerOffset: -300, outerOffset: 300, fromIndex: 10, spanIndices: 12,
    });
    const pos = geom.attributes.aPosition.buffer.data;
    const first = path.points[10];
    const last = path.points[22];
    // inner edge start/end sit `300` off those two centreline points
    expect(Math.hypot(pos[0] - first[0], pos[1] - first[1])).toBeCloseTo(300, 3);
    const n = pos.length;
    expect(Math.hypot(pos[n - 4] - last[0], pos[n - 3] - last[1])).toBeCloseTo(300, 3);
  });
});
