import { describe, it, expect } from 'vitest';
import { STAGE_PATHS, buildStage3Path, buildStage4Path } from './stages.js';

// Stage 4 road geometry, from config.js + the highway surface preset:
// roadHalf 360 plus bands (26 + 78) = 464 per side.
const ROAD_HALF = 360;
const SWATH = ROAD_HALF + 104;
const MIN_SEP = SWATH * 2;

function routeGap(i, j, n) {
  const d = Math.abs(i - j);
  return Math.min(d, n - d);
}

/** Every place two non-adjacent stretches of the loop actually intersect. */
function findCrossings(path, adjacency = 2000) {
  const n = path.count;
  const adj = Math.ceil(adjacency / path.spacing);
  const hits = [];
  const seg = (p1, p2, p3, p4) => {
    const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
    const d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-9) return false;
    const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den;
    const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (routeGap(i, j, n) < adj) continue;
      const a1 = path.points[i], a2 = path.points[(i + 1) % n];
      const b1 = path.points[j], b2 = path.points[(j + 1) % n];
      if (seg(a1, a2, b1, b2)) hits.push({ i, j });
    }
  }
  // collapse the handful of segment pairs that make up one physical crossing
  const groups = [];
  for (const h of hits) {
    if (groups.some((g) => routeGap(g.i, h.i, n) < adj && routeGap(g.j, h.j, n) < adj)) continue;
    groups.push(h);
  }
  return groups;
}

describe('stage 4 course', () => {
  const path = buildStage4Path();
  const n = path.count;
  const crossings = findCrossings(path);

  it('closes exactly on its start point', () => {
    // The turtle's last segment must land back on the first point, leaving
    // exactly one spacing between the last resampled point and the first.
    const a = path.points[0];
    const b = path.points[n - 1];
    const gap = Math.hypot(b[0] - a[0], b[1] - a[1]);
    expect(gap).toBeLessThan(path.spacing * 1.6);
  });

  it('is a long course', () => {
    expect(path.length).toBeGreaterThan(80000);
  });

  it('crosses over itself exactly once', () => {
    expect(crossings.length).toBe(1);
  });

  it('separates the two passes of the crossing onto different decks', () => {
    // This is the whole point of the layout: if both passes were on the same
    // deck, two cars meeting there would collide through the bridge.
    const { i, j } = crossings[0];
    const a = path.layerAtIndex(i);
    const b = path.layerAtIndex(j);
    expect(a.deckId).not.toBe(b.deckId);
    // and specifically: one is the raised deck, one is ground
    expect(Math.max(a.zLevel, b.zLevel)).toBeGreaterThanOrEqual(2);
    expect(Math.min(a.zLevel, b.zLevel)).toBe(0);
  });

  it('crosses at close to a right angle', () => {
    const { i, j } = crossings[0];
    let d = ((path.tangents[j] - path.tangents[i]) * 180) / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    expect(Math.abs(Math.abs(d) - 90)).toBeLessThan(15);
  });

  it('keeps every non-crossing pair of stretches clear of the road swath', () => {
    // Anything closer than the full painted width would visually overlap.
    const adj = Math.ceil(2000 / path.spacing);
    const nearCrossing = (i, j) => crossings.some(
      (c) => (routeGap(c.i, i, n) < adj && routeGap(c.j, j, n) < adj)
          || (routeGap(c.i, j, n) < adj && routeGap(c.j, i, n) < adj),
    );
    let worst = Infinity;
    for (let i = 0; i < n; i += 2) {
      for (let j = i + 1; j < n; j += 2) {
        if (routeGap(i, j, n) < adj) continue;
        if (nearCrossing(i, j)) continue;
        const a = path.points[i], b = path.points[j];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (d < worst) worst = d;
      }
    }
    expect(worst).toBeGreaterThan(MIN_SEP);
  });

  it('has no corner tighter than the road can physically turn', () => {
    let maxCurv = 0, at = 0;
    for (let i = 0; i < n; i++) {
      if (path.curvature[i] > maxCurv) { maxCurv = path.curvature[i]; at = i; }
    }
    let d = path.tangents[path.wrap(at + 2)] - path.tangents[path.wrap(at - 2)];
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const radius = Math.abs(d) > 1e-6 ? (4 * path.spacing) / Math.abs(d) : Infinity;
    // inside edge of the painted road must not pinch through itself
    expect(radius).toBeGreaterThan(SWATH);
  });

  it('runs ground -> ramp -> elevated -> ramp -> ground, then stays down', () => {
    const at = (f) => path.zLevels[Math.floor(n * f)];
    expect(at(0.01)).toBe(0);   // south side, before the climb
    expect(at(0.075)).toBe(1);  // ascent
    expect(at(0.15)).toBe(2);   // inner ring, raised
    expect(at(0.30)).toBe(2);
    expect(at(0.357)).toBe(1);  // descent
    expect(at(0.50)).toBe(0);   // outer ring, all ground
    expect(at(0.85)).toBe(0);
  });

  it('marks a tunnel on the ground section only', () => {
    let tunnelPoints = 0;
    for (let i = 0; i < n; i++) {
      if (!path.tunnelFlags[i]) continue;
      tunnelPoints++;
      expect(path.zLevels[i]).toBe(0);
    }
    expect(tunnelPoints).toBeGreaterThan(0);
  });
});

// Stage 3 road geometry: roadHalf 190 plus the mountain preset's bands
// (34 + 150) = 374 per side.
const S3_ROAD_HALF = 190;
const S3_SWATH = S3_ROAD_HALF + 184;

/** Local radius of the built centreline, over an 8-point window. */
function radiusAt(path, i) {
  const n = path.count;
  let d = path.tangents[(i + 4) % n] - path.tangents[(i - 4 + n) % n];
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) > 1e-6 ? (8 * path.spacing) / Math.abs(d) : Infinity;
}

describe('stage 3 course', () => {
  const path = buildStage3Path();
  const n = path.count;

  it('closes exactly on its start point', () => {
    const a = path.points[0];
    const b = path.points[n - 1];
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThan(path.spacing * 1.6);
  });

  it('has straight road behind the start line for the grid', () => {
    // Cars are placed 360 units back from index 0, so the run-in has to be
    // straight or the starting grid is laid out across a corner.
    for (let k = 1; k <= Math.ceil(600 / path.spacing); k++) {
      expect(path.curvature[path.wrap(-k)]).toBeLessThan(0.05);
    }
  });

  it('is built from real hairpins, not wide sweepers', () => {
    // Eight switchbacks, each tight enough that the player has to brake for
    // it: the car's grip radius at speed 500 is ~647, so anything at or
    // above that is a corner you take flat.
    const corners = [];
    let run = null;
    for (let i = 0; i < n * 2; i++) {
      const r = radiusAt(path, i % n);
      if (r <= 470) {
        if (!run) run = { start: i, tightest: r };
        else run.tightest = Math.min(run.tightest, r);
      } else if (run) {
        if (run.start < n) corners.push(run.tightest);
        run = null;
      }
      if (i >= n && !run) break;
    }
    expect(corners.length).toBe(8);
    // the six climbing switchbacks are the tight ones; the two on the
    // descent are deliberately a little wider, since the car arrives there
    // carrying more speed
    expect(corners.filter((r) => r < 400).length).toBe(6);
  });

  it('has no corner tighter than the car can drive', () => {
    // A drift on this stage holds ~330 radius; below about 300 the corner
    // stops being drivable at any speed the stage runs at.
    let tightest = Infinity;
    for (let i = 0; i < n; i++) tightest = Math.min(tightest, radiusAt(path, i));
    expect(tightest).toBeGreaterThan(300);
  });

  it('gives the rival one continuous turning run per hairpin', () => {
    // rival.js groups runs of same-signed turning and discards any shorter
    // than longCurveMinLen (1200) -- that run is what arms both the racing
    // line and the drift. A hairpin built as arc/straight/arc splits into
    // three runs that each fail the test, and the AI then drives straight
    // through the corner it was supposed to be drifting.
    const EPS = 0.02;
    const signed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let d = path.tangents[(i + 2) % n] - path.tangents[(i - 2 + n) % n];
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      signed[i] = d;
    }
    let start = 0;
    for (let k = 0; k < n; k++) if (Math.abs(signed[k]) < EPS) { start = k; break; }
    const runs = [];
    let idx = 0;
    while (idx < n) {
      const k = (start + idx) % n;
      if (Math.abs(signed[k]) < EPS) { idx++; continue; }
      const sign = Math.sign(signed[k]);
      let len = 0, tightestInRun = Infinity;
      while (idx < n) {
        const kk = (start + idx) % n;
        if (Math.abs(signed[kk]) < EPS || Math.sign(signed[kk]) !== sign) break;
        tightestInRun = Math.min(tightestInRun, radiusAt(path, kk));
        len++; idx++;
      }
      runs.push({ len: len * path.spacing, tightest: tightestInRun });
    }
    // every hairpin-tight run must be long enough to register as a corner
    const hairpinRuns = runs.filter((r) => r.tightest < 470);
    expect(hairpinRuns.length).toBe(8);
    for (const r of hairpinRuns) expect(r.len).toBeGreaterThan(1200);
  });

  it('keeps every pair of stretches clear of the road swath', () => {
    // "Non-adjacent" has to mean further apart along the route than one
    // whole corner complex: two points inside a single hairpin sit ~1050
    // apart in space while being most of a 2000-unit arc apart along the
    // route, and that is the corner working as designed.
    const adj = Math.ceil(2600 / path.spacing);
    let worst = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (routeGap(i, j, n) < adj) continue;
        const a = path.points[i], b = path.points[j];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (d < worst) worst = d;
      }
    }
    expect(worst).toBeGreaterThan(S3_SWATH * 2);
  });

  it('still has somewhere to use the boost', () => {
    let run = 0, best = 0;
    for (let i = 0; i < n * 2; i++) {
      if (path.curvature[i % n] < 0.06) { run++; best = Math.max(best, run); } else run = 0;
    }
    expect(Math.min(best, n) * path.spacing).toBeGreaterThan(3000);
  });
});

describe('other stages still build', () => {
  it('stages 1-3 remain single-level loops with no crossings', () => {
    for (const id of [1, 2, 3]) {
      const path = STAGE_PATHS[id]();
      expect(path.count).toBeGreaterThan(0);
      // none of them mark decks or tunnels
      let raised = 0, tunnel = 0;
      for (let i = 0; i < path.count; i++) {
        if (path.zLevels[i] !== 0) raised++;
        if (path.tunnelFlags[i]) tunnel++;
      }
      expect(raised).toBe(0);
      expect(tunnel).toBe(0);
      expect(findCrossings(path).length).toBe(0);
    }
  });
});
