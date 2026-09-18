import { describe, it, expect } from 'vitest';
import { PathBuilder } from '../track/path.js';
import { computeElevationProfile, buildRampStructure } from './surfaces.js';

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
