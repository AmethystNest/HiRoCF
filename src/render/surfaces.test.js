import { describe, it, expect } from 'vitest';
import { PathBuilder } from '../track/path.js';
import { computeElevationProfile, buildRampStructure, computeTunnelDepth, buildTunnelStructure, outsideDropAmount } from './surfaces.js';

function buildLoop() {
  return new PathBuilder()
    .line(0, 0, 4000, 0, 100)
    .line(4000, 0, 4000, 2000, 60)
    .line(4000, 2000, 0, 2000, 100)
    .line(0, 2000, 0, 0, 60)
    .build(26);
}

describe('computeElevationProfile', () => {
  it('is all zero when the path never leaves zLevel 0', () => {
    const path = buildLoop();
    const height = computeElevationProfile(path);
    expect(height.every((h) => h === 0)).toBe(true);
  });

  it('ramps 0 -> 1 across a zLevel-1 run and stays 1 on zLevel >= 2', () => {
    const path = buildLoop();
    // mirrors Stage 4's own ramp-up / upper-deck / ramp-down pattern
    path.setLayerRange(0.0, 0.1, 0, 0);
    path.setLayerRange(0.1, 0.2, 1, 1);
    path.setLayerRange(0.2, 0.6, 1, 2);
    path.setLayerRange(0.6, 0.7, 1, 1);
    path.setLayerRange(0.7, 1.0, 0, 0);

    const height = computeElevationProfile(path);
    const n = path.count;
    const at = (frac) => height[Math.floor(n * frac)];

    expect(at(0.05)).toBe(0); // ground, before the ramp
    expect(at(0.3)).toBe(1); // upper deck
    expect(at(0.8)).toBe(0); // ground again, after the descent

    // inside the ascending ramp (0.1-0.2), height should climb monotonically
    const rampStart = Math.floor(n * 0.1);
    const rampEnd = Math.floor(n * 0.2);
    let prev = height[rampStart];
    for (let i = rampStart + 1; i < rampEnd; i++) {
      expect(height[i]).toBeGreaterThanOrEqual(prev);
      prev = height[i];
    }
    expect(prev).toBeCloseTo(1, 1);
  });
});

describe('buildRampStructure', () => {
  it('adds nothing (empty layer) for a path that never leaves zLevel 0', () => {
    const path = buildLoop();
    const layer = buildRampStructure(path, { wallHalf: 420 });
    expect(layer.children.length).toBe(0);
  });

  it('adds ribbon meshes and piers once the path climbs', () => {
    const path = buildLoop();
    path.setLayerRange(0.0, 0.1, 0, 0);
    path.setLayerRange(0.1, 0.2, 1, 1);
    path.setLayerRange(0.2, 0.6, 1, 2);
    path.setLayerRange(0.6, 0.7, 1, 1);
    path.setLayerRange(0.7, 1.0, 0, 0);

    const layer = buildRampStructure(path, { wallHalf: 420 });
    // 4 ribbon meshes per side (shadow, wall base, wall cap, girder) = 8,
    // plus one Graphics object holding every pier.
    expect(layer.children.length).toBe(9);
  });
});

describe('computeTunnelDepth', () => {
  it('is all zero when the path has no tunnel range set', () => {
    const path = buildLoop();
    const depth = computeTunnelDepth(path);
    expect(depth.every((d) => d === 0)).toBe(true);
  });

  it('fades 0 -> 1 -> 0 across a marked tunnel range', () => {
    const path = buildLoop();
    path.setTunnelRange(0.4, 0.6);
    const depth = computeTunnelDepth(path, 220);
    const n = path.count;

    expect(depth[Math.floor(n * 0.3)]).toBe(0); // well before the tunnel
    expect(depth[Math.floor(n * 0.5)]).toBeCloseTo(1, 1); // tunnel middle
    expect(depth[Math.floor(n * 0.8)]).toBe(0); // well after the tunnel

    // depth should rise monotonically through the first half of the range
    const start = Math.floor(n * 0.4);
    const mid = Math.floor(n * 0.5);
    let prev = depth[start];
    for (let i = start + 1; i <= mid; i++) {
      expect(depth[i]).toBeGreaterThanOrEqual(prev);
      prev = depth[i];
    }
  });
});

describe('buildTunnelStructure', () => {
  it('adds nothing for a path with no tunnel range', () => {
    const path = buildLoop();
    const layer = buildTunnelStructure(path, { roadHalf: 300, wallHalf: 355 });
    expect(layer.children.length).toBe(0);
  });

  it('adds wall ribbons plus the overlay/light Graphics once a tunnel is marked', () => {
    const path = buildLoop();
    path.setTunnelRange(0.4, 0.6);
    const layer = buildTunnelStructure(path, { roadHalf: 300, wallHalf: 355 });
    // 2 ribbon meshes per side (base, cap) = 4, plus overlay + lights Graphics.
    expect(layer.children.length).toBe(6);
  });
});

describe('outsideDropAmount', () => {
  // A single constant-radius loop: it turns the same way everywhere, so the
  // outside is always the same side of the road and the sign must never
  // flip. 500 radius is a real corner by this stage's standards (curvature
  // 189/500 = 0.38, comfortably past the 0.20 the apron starts at).
  function ring(r = 500) {
    return new PathBuilder()
      .arc(0, 0, r, 0, Math.PI * 2, Math.max(60, Math.round(r / 6)))
      .build(26);
  }

  it('is zero where the road is straight', () => {
    const path = new PathBuilder()
      .line(0, 0, 6000, 0, 120)
      .arc(6000, 900, 900, -Math.PI / 2, Math.PI / 2, 60)
      .line(6000, 1800, 0, 1800, 120)
      .arc(0, 900, 900, Math.PI / 2, Math.PI * 1.5, 60)
      .build(26);
    const drop = outsideDropAmount(path);
    // the midpoint of each long straight is well clear of both corners
    const mid = Math.round(path.count * 0.12);
    expect(Math.abs(drop[mid])).toBeLessThan(0.05);
  });

  it('puts the drop on the outside of the bend, on one side only', () => {
    const path = ring();
    const drop = outsideDropAmount(path);
    const signs = new Set();
    for (let i = 0; i < path.count; i++) {
      expect(Math.abs(drop[i])).toBeGreaterThan(0.3);
      signs.add(Math.sign(drop[i]));
    }
    expect(signs.size).toBe(1);
  });

  it('is stronger on a tighter corner', () => {
    const wide = outsideDropAmount(ring(1200));
    const tight = outsideDropAmount(ring(400));
    const avg = (a) => a.reduce((s, v) => s + Math.abs(v), 0) / a.length;
    expect(avg(tight)).toBeGreaterThan(avg(wide));
  });

  it('never exceeds full strength', () => {
    const drop = outsideDropAmount(ring());
    for (let i = 0; i < drop.length; i++) expect(Math.abs(drop[i])).toBeLessThanOrEqual(1);
  });
});
