import { describe, it, expect } from 'vitest';
import { buildStage2Path } from '../track/stages.js';
import { LAYOUTS } from '../track/layouts.js';
import { cityStreets, streetMouths, routeCrossroads } from './city.js';

// Stage 2: roadHalf 230, the city pavement 248 (surfaces.js city bands).
const ROAD = 230, PAVE = 248;

describe('stage 2 town grid', () => {
  const path = buildStage2Path();
  const def = LAYOUTS[2].cityGrid;
  const streets = cityStreets(def);

  it('puts every straight of the course on a street of the grid', () => {
    // every point of the course that is on a straight (not turning) lies on
    // some street's centre line
    let straight = 0, off = 0;
    for (let i = 0; i < path.count; i++) {
      if (path.curvature[i] > 0.02) continue;
      straight++;
      const [x, y] = path.points[i];
      const on = streets.some((s) => (s.v
        ? Math.abs(x - s.c) < 2 && y >= s.a0 && y <= s.a1
        : Math.abs(y - s.c) < 2 && x >= s.a0 && x <= s.a1));
      if (!on) off++;
    }
    expect(straight).toBeGreaterThan(path.count * 0.5);
    expect(off).toBe(0);
  });

  it('leaves room for a block between any two parallel streets that overlap', () => {
    // two corridors (carriageway + pavement each side) plus a building
    const minGap = 2 * (def.streetHalf + PAVE) + 400;
    for (const a of streets) {
      for (const b of streets) {
        if (a === b || a.v !== b.v || a.c === b.c) continue;
        const overlap = Math.min(a.a1, b.a1) - Math.max(a.a0, b.a0);
        if (overlap <= 0) continue;
        expect(Math.abs(a.c - b.c)).toBeGreaterThanOrEqual(minGap);
      }
    }
  });

  it('opens a junction at every corner and at every street crossing a straight', () => {
    const crossroads = routeCrossroads(path, streets, def.streetHalf);
    // x = 1460 over the start straight, y = 1510 twice, y = 5430 twice and
    // x = 4160 over the bottom straight
    expect(crossroads.length).toBe(6);
    const { pos, neg } = streetMouths(path, streets, { roadHalf: ROAD, pave: PAVE, streetHalf: def.streetHalf });
    // count separate mouths: runs of flagged indices per side
    const runs = (m) => {
      let n = 0;
      for (let i = 0; i < m.length; i++) if (m[i] && !m[(i + m.length - 1) % m.length]) n++;
      return n;
    };
    // a crossroads opens both sides, a corner its outside only
    expect(runs(pos) + runs(neg)).toBe(crossroads.length * 2 + 8);
  });
});
