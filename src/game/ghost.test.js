import { describe, it, expect } from 'vitest';
import { GhostRecorder, encodeGhost, decodeGhost, ghostAt, saveGhost, loadGhost, GHOST_HZ } from './ghost.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}

/** A car going round a circle of radius 5000 at 1 rad/s, for `secs` seconds. */
function lap(secs, frame = 1 / 60) {
  const rec = new GhostRecorder();
  for (let t = 0; t <= secs + 1e-9; t += frame) {
    rec.sample(t, { x: 5000 * Math.cos(t), y: 5000 * Math.sin(t), angle: t + Math.PI / 2 });
  }
  return rec;
}

describe('ghost recording', () => {
  it('takes GHOST_HZ samples a second whatever the frame rate', () => {
    for (const frame of [1 / 60, 1 / 30, 1 / 144]) {
      const rec = lap(4, frame);
      expect(Math.abs(rec.length - (4 * GHOST_HZ + 1))).toBeLessThanOrEqual(1);
    }
  });

  it('fills the gap when a slow frame skips samples', () => {
    const rec = new GhostRecorder();
    rec.sample(0, { x: 0, y: 0, angle: 0 });
    rec.sample(0.2, { x: 10, y: 0, angle: 0 });
    expect(rec.length).toBe(Math.floor(0.2 * GHOST_HZ) + 1);
  });
});

describe('ghost encoding', () => {
  it('round-trips to within a few world units and a hair of heading', () => {
    const rec = lap(6);
    const g = decodeGhost(encodeGhost(rec, 6000));
    expect(g.n).toBe(rec.length);
    expect(g.timeMs).toBe(6000);
    for (let i = 0; i < g.n; i += 17) {
      expect(Math.abs(g.x[i] - rec.x[i])).toBeLessThanOrEqual(2.01);
      expect(Math.abs(g.y[i] - rec.y[i])).toBeLessThanOrEqual(2.01);
      const da = Math.atan2(Math.sin(g.a[i] - rec.a[i]), Math.cos(g.a[i] - rec.a[i]));
      expect(Math.abs(da)).toBeLessThan(2e-4);
    }
  });

  it('is small: a three-minute run is under 48 KB', () => {
    expect(encodeGhost(lap(180), 180000).length).toBeLessThan(48000);
  });

  it('refuses text that is not a ghost', () => {
    for (const bad of ['', 'nope', '{}', '{"v":2}', JSON.stringify({ v: 1, hz: 30, n: 5, t: 1, d: 'AAAA' }), null]) {
      expect(decodeGhost(bad)).toBeNull();
    }
  });
});

describe('ghost playback', () => {
  const g = decodeGhost(encodeGhost(lap(6), 6000));

  it('finds the car where it was between samples', () => {
    for (const t of [0.5, 1.234, 3.9, 5.5]) {
      const p = ghostAt(g, t);
      expect(Math.hypot(p.x - 5000 * Math.cos(t), p.y - 5000 * Math.sin(t))).toBeLessThan(8);
    }
  });

  it('turns the short way round at +-pi', () => {
    const rec = new GhostRecorder();
    rec.sample(0, { x: 0, y: 0, angle: Math.PI - 0.05 });
    rec.sample(1 / GHOST_HZ, { x: 0, y: 0, angle: -Math.PI + 0.05 });
    rec.sample(2 / GHOST_HZ, { x: 0, y: 0, angle: -Math.PI + 0.05 });
    const mid = ghostAt(decodeGhost(encodeGhost(rec, 100)), 0.5 / GHOST_HZ);
    expect(Math.abs(Math.atan2(Math.sin(mid.angle), Math.cos(mid.angle)))).toBeGreaterThan(Math.PI - 0.06);
  });

  it('is gone before the run starts and once it has ended', () => {
    expect(ghostAt(g, -0.1)).toBeNull();
    expect(ghostAt(g, g.duration + 0.1)).toBeNull();
    expect(ghostAt(null, 1)).toBeNull();
  });
});

describe('ghost storage', () => {
  it('keeps one ghost per stage and difficulty', () => {
    const store = memoryStorage();
    expect(saveGhost(3, 'normal', lap(3), 3000, store)).toBe(true);
    expect(loadGhost(3, 'normal', store).timeMs).toBe(3000);
    expect(loadGhost(3, 'hard', store)).toBeNull();
    expect(loadGhost(4, 'normal', store)).toBeNull();
    saveGhost(3, 'normal', lap(2), 2000, store);
    expect(loadGhost(3, 'normal', store).timeMs).toBe(2000);
  });

  it('carries on without one when storage is missing, full or broken', () => {
    expect(saveGhost(1, 'normal', lap(3), 3000, null)).toBe(false);
    expect(loadGhost(1, 'normal', null)).toBeNull();
    const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(saveGhost(1, 'normal', lap(3), 3000, full)).toBe(false);
    const broken = { getItem: () => { throw new Error('denied'); } };
    expect(loadGhost(1, 'normal', broken)).toBeNull();
    expect(loadGhost(1, 'normal', { getItem: () => 'garbage' })).toBeNull();
  });
});
