/**
 * Shared plumbing for every effect drawn as pooled ParticleContainer
 * sprites rather than per-frame Graphics -- contactfx.js (dust/smoke/
 * sparks) and boostfx.js (nitro flame/embers) both build their pools with
 * this. A Graphics cleared and refilled every frame re-tessellates and
 * re-uploads its whole geometry; a Particle only ever changes position,
 * rotation, scale and colour, which is exactly what ParticleContainer
 * uploads as plain buffers. Measured on contactfx's burst: ~50ms a frame
 * with both cars scraping as Graphics, 0.4ms as particles.
 */
import { Particle, ParticleContainer, Texture } from '../pixi.js';

/** Soft round puff, white so a per-particle tint can colour it. Used for
 *  dust, smoke, the impact flash, and embers. */
export function makeBlobTexture(size = 32) {
  const r = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
      // soft all the way out to the rim, so there is no hard circle edge
      const a = d >= 1 ? 0 : (1 - d * d) ** 1.6;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * a);
    }
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(canvas);
}

/** A streak: bright at the head (right edge), fading back to nothing at
 *  the tail, soft top to bottom so it has no hard edge. Anchor at the
 *  head (anchorX: 1) to trail backwards from a moving point -- sparks --
 *  or at the tail (anchorX: 0) to grow forward from a fixed one -- a
 *  flame tongue rooted at its nozzle. */
export function makeStreakTexture(w = 64, h = 8) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const ty = Math.abs((y + 0.5) / h - 0.5) * 2;      // 0 centre .. 1 edge
    // flat core with the softness kept to the rim -- a falloff across the
    // whole width washes the streak out to a grey smear at these sizes
    const ay = Math.max(0, 1 - ty ** 4);
    for (let x = 0; x < w; x++) {
      const ax = ((x + 0.5) / w) ** 1.05;               // dim tail, hot head
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * ax * ay);
    }
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(canvas);
}

/**
 * A fixed pool of particles, all added to their container once. Live ones
 * are the first `count` entries of `items`; the rest are parked at alpha
 * 0. Nothing is allocated or removed after construction.
 */
export function makePool(texture, max, { anchorX = 0.5, anchorY = 0.5, blend = 'normal' } = {}) {
  const view = new ParticleContainer({
    dynamicProperties: { vertex: true, position: true, rotation: true, color: true },
  });
  view.blendMode = blend;
  const items = [];
  for (let i = 0; i < max; i++) {
    const particle = new Particle({ texture, anchorX, anchorY, alpha: 0 });
    view.addParticle(particle);
    items.push({ particle, age: 0, life: 1, x: 0, y: 0, vx: 0, vy: 0 });
  }
  return { view, items, count: 0 };
}

/** Take the next free slot, or steal slot 0 if the pool is saturated. */
export function take(pool) {
  if (pool.count < pool.items.length) return pool.items[pool.count++];
  // Full. Overwriting slot 0 in place keeps this O(1) -- rotating the
  // array to get a true oldest-first would be O(n) on the one path that
  // is already the busy one, and one reused slot out of a full pool is
  // not something anyone can pick out of a spark shower.
  return pool.items[0];
}

/** Drop a dead slot, keeping the live ones packed at the front. */
export function release(pool, index) {
  pool.count--;
  const dead = pool.items[index];
  pool.items[index] = pool.items[pool.count];
  pool.items[pool.count] = dead;
  dead.particle.alpha = 0;
}

/** Every live particle's alpha to 0 and the pool back to empty -- for a
 *  stage reload, so nothing from the last stage lingers into the next. */
export function clearPool(pool) {
  for (const it of pool.items) it.particle.alpha = 0;
  pool.count = 0;
}
