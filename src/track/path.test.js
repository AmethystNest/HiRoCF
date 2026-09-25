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

  it('nearestLocal searches around the hint instead of globally', () => {
    const path = buildSquareLoop();
    const target = path.points[10];

    // hint already near the point: finds it
    const near = path.nearestLocal(target[0], target[1], 10, 20, 1e9);
    expect(Math.abs(near.index - 10)).toBeLessThan(3);

    // hint on the far side of the loop, with the safety valve effectively
    // off: the search stays where the hint says rather than snapping to the
    // globally nearest point. This is exactly what keeps a car on its own
    // deck where a course crosses over itself.
    const far = Math.floor(path.count / 2);
    const stayed = path.nearestLocal(target[0], target[1], far, 20, 1e9);
    expect(Math.abs(stayed.index - far)).toBeLessThanOrEqual(21);
  });

  it('nearestLocal falls back to a global search when the hint is stale', () => {
    const path = buildSquareLoop();
    const target = path.points[10];
    const far = Math.floor(path.count / 2);
    // same stale hint, but a realistic maxDist: nothing that far away is
    // within reach, so it re-acquires the real nearest point
    const recovered = path.nearestLocal(target[0], target[1], far, 20, 200);
    expect(Math.abs(recovered.index - 10)).toBeLessThan(3);
  });

  it('nearestLocal matches nearest() when the hint is current', () => {
    const path = buildSquareLoop();
    const x = 500, y = 40;
    const global = path.nearest(x, y);
    const local = path.nearestLocal(x, y, global.index, 30, 1e9);
    expect(local.index).toBe(global.index);
    expect(local.dist).toBeCloseTo(global.dist, 6);
    expect(local.distance).toBeCloseTo(global.distance, 6);
  });

  it('setTunnelRange flags a route range independently of deck/zLevel', () => {
    const path = buildSquareLoop();
    path.setLayerRange(0.0, 1.0, 1, 2); // whole loop elevated
    path.setTunnelRange(0.3, 0.4);

    const inside = Math.floor(path.count * 0.35);
    const outside = Math.floor(path.count * 0.1);
    expect(path.tunnelFlags[inside]).toBe(1);
    expect(path.tunnelFlags[outside]).toBe(0);
    // tunnel flag must not disturb the deck metadata set separately
    expect(path.deckIds[inside]).toBe(1);
    expect(path.zLevels[inside]).toBe(2);
  });
});
