import { describe, it, expect } from 'vitest';
import { convexHull, simplify, silhouetteFractions, scalePolygon, worldPolygon, polygonContact, overlapDepth } from './hull.js';

const rect = (w, h) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];

describe('convexHull / simplify', () => {
  it('keeps only the outline of a cloud of points', () => {
    const pts = [[0, 0], [10, 0], [10, 10], [0, 10], [5, 5], [3, 7], [8, 2]];
    expect(convexHull(pts).length).toBe(4);
  });

  it('drops the least significant vertices first', () => {
    // a square with one barely-there bump on its top edge
    const poly = [[0, 0], [10, 0], [10, 10], [5, 10.05], [0, 10]];
    const out = simplify(poly, 4);
    expect(out.length).toBe(4);
    expect(out.some((p) => p[0] === 5)).toBe(false);
  });
});

describe('silhouetteFractions', () => {
  it('cuts the hull from the opaque pixels, in fractions of the image', () => {
    const W = 20, H = 40, d = new Uint8ClampedArray(W * H * 4);
    for (let y = 4; y < 36; y++) for (let x = 5; x < 15; x++) d[(y * W + x) * 4 + 3] = 255;
    const fr = silhouetteFractions(d, W, H);
    const xs = fr.map((p) => p[0]), ys = fr.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(5 / 20 - 0.5, 6);
    expect(Math.max(...xs)).toBeCloseTo(15 / 20 - 0.5, 6);
    expect(Math.min(...ys)).toBeCloseTo(4 / 40 - 0.5, 6);
    expect(Math.max(...ys)).toBeCloseTo(36 / 40 - 0.5, 6);
  });

  it('returns null for an empty picture', () => {
    expect(silhouetteFractions(new Uint8ClampedArray(16 * 4), 4, 4)).toBeNull();
  });

  it('scales to the drawn size', () => {
    expect(scalePolygon([[-0.25, -0.4], [0.25, 0.4]], 100, 200)).toEqual([[-25, -80], [25, 80]]);
  });
});

describe('worldPolygon', () => {
  it('puts the tail (+y) behind a car heading along +x', () => {
    const [p] = worldPolygon({ x: 100, y: 50, angle: 0 }, [[0, 10]]);
    expect(p[0]).toBeCloseTo(90, 6);
    expect(p[1]).toBeCloseTo(50, 6);
  });

  it('turns with the drawn angle, slide included', () => {
    const [a] = worldPolygon({ x: 0, y: 0, angle: 0.2, driftVisualAngle: 0.3 }, [[0, 10]]);
    const [b] = worldPolygon({ x: 0, y: 0, angle: 0.5 }, [[0, 10]]);
    expect(a[0]).toBeCloseTo(b[0], 6);
    expect(a[1]).toBeCloseTo(b[1], 6);
  });
});

describe('polygonContact', () => {
  const at = (x, y, poly) => poly.map(([px, py]) => [px + x, py + y]);

  it('is null for bodies that are apart', () => {
    expect(polygonContact(at(0, 0, rect(10, 10)), at(11, 0, rect(10, 10)))).toBeNull();
  });

  it('finds the way out along the shallow axis, pointing from a to b', () => {
    const hit = polygonContact(at(0, 0, rect(10, 10)), at(8, 1, rect(10, 10)));
    expect(hit.overlap).toBeCloseTo(2, 6);
    expect(hit.nx).toBeCloseTo(1, 6);
    expect(Math.abs(hit.ny)).toBeLessThan(1e-6);
    const back = polygonContact(at(8, 1, rect(10, 10)), at(0, 0, rect(10, 10)));
    expect(back.nx).toBeCloseTo(-1, 6);
  });

  it('puts the contact point inside the overlap', () => {
    const hit = polygonContact(at(0, 0, rect(10, 10)), at(8, 0, rect(10, 10)));
    expect(hit.x).toBeGreaterThan(2);
    expect(hit.x).toBeLessThan(6);
  });

  it('sees a rotated body poking into a flat one', () => {
    const diamond = worldPolygon({ x: 9, y: 0, angle: Math.PI / 4 }, rect(10, 10));
    const hit = polygonContact(at(0, 0, rect(10, 10)), diamond);
    expect(hit).not.toBeNull();
    expect(hit.overlap).toBeGreaterThan(0);
  });
});

describe('overlapDepth', () => {
  it('measures two cars by their drawn outlines', () => {
    const size = { poly: rect(60, 120) };
    const a = { x: 0, y: 0, angle: 0 };
    expect(overlapDepth(a, size, { x: 119, y: 0, angle: 0 }, size)).toBeCloseTo(1, 6);
    expect(overlapDepth(a, size, { x: 121, y: 0, angle: 0 }, size)).toBe(0);
  });
});
