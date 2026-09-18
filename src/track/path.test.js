import { describe, it, expect } from 'vitest';
import { PathBuilder } from './path.js';

function buildSquareLoop() {
  // simple closed square loop, 1000 units per side
  return new PathBuilder()
    .line(0, 0, 1000, 0, 20)
    .line(1000, 0, 1000, 1000, 20)
    .line(1000, 1000, 0, 1000, 20)
    .line(0, 1000, 0, 0, 20)
    .build(26);
}

describe('TrackPath', () => {
  it('resamples to a closed loop with uniform spacing', () => {
    const path = buildSquareLoop();
    expect(path.count).toBeGreaterThan(0);
    expect(path.spacing).toBeGreaterThan(0);
    // total length should be close to the authored 4000-unit perimeter
    expect(path.length).toBeGreaterThan(3800);
    expect(path.length).toBeLessThan(4200);
  });

  it('nearest() finds the closest point on the centreline', () => {
    const path = buildSquareLoop();
    const near = path.nearest(500, 5);
    expect(near.dist).toBeLessThan(30);
    expect(near.y).toBeCloseTo(0, -1);
  });

  it('setLayerRange/layerAtIndex assign deck metadata to a route range', () => {
    const path = buildSquareLoop();
    path.setLayerRange(0.25, 0.5, 1, 2);
    const mid = Math.floor(path.count * 0.35);
    const layer = path.layerAtIndex(mid);
    expect(layer.deckId).toBe(1);
    expect(layer.zLevel).toBe(2);

    const outside = path.layerAtIndex(0);
    expect(outside.deckId).toBe(0);
  });

  it('nearestNearIndex only matches points on the requested deckId', () => {
    const path = buildSquareLoop();
    path.setLayerRange(0.0, 0.5, 0, 0);
    path.setLayerRange(0.5, 1.0, 1, 1);
    const hint = Math.floor(path.count * 0.75);
    const p = path.points[hint];
    const near = path.nearestNearIndex(p[0], p[1], hint, 50, 1);
    expect(path.deckIds[near.index]).toBe(1);
  });

  it('wrap() keeps indices within [0, count)', () => {
    const path = buildSquareLoop();
    expect(path.wrap(-1)).toBe(path.count - 1);
    expect(path.wrap(path.count)).toBe(0);
  });
});
