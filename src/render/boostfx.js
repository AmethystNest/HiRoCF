/**
 * Nitro exhaust, for both player and rival -- one buildBoostFlame() per
 * car, called the same way boostfx.js always has been.
 *
 * Three things now instead of two flat colour layers:
 *
 *   flame    a soft outer tongue (normal blend, so it reads as solid over
 *            bright road/kerb rather than washing out) with a hot inner
 *            core (additive) inside it -- same colour scheme as before
 *            (blue outer, orange core), just textured instead of a
 *            hard-edged polygon, and only 2 particles per layer (one per
 *            pipe) rather than a pool: there is nothing bursty about the
 *            flame body itself, it is either on or off.
 *   embers   small glowing specks that spit out the back of each pipe
 *            for as long as the car is boosting, drifting and cooling
 *            before they fade -- pooled the same way contactfx.js's
 *            dust and sparks are, since these ARE bursty.
 *   ignition  one bright pulse on the exact frame a burst starts, so the
 *            first instant of a nitro press reads as a punch rather than
 *            a fade-in.
 *
 * The view is pinned to the car and rotated the same way as its sprite
 * every frame, so the exhaust always sits at the rear regardless of
 * heading -- unchanged from the original.
 */
import { Container, Particle, ParticleContainer, Texture } from '../pixi.js';
import { makeBlobTexture, makePool, take, release, clearPool } from './particlePool.js';

// Lateral exhaust spacing as a fraction of the vehicle's own width, so a
// wider vehicle's pipes sit under its body rather than inside its centre
// line. 14/70 and 15/74 are the player's and the car rivals' original
// pixel offsets, unchanged.
const PLAYER_EXHAUST_SPREAD = 14 / 70;
const RIVAL_EXHAUST_SPREAD = 15 / 74;

const EMBER_LIFE = 0.4;
const EMBER_MAX = 30;
const EMBER_RATE = 55; // particles/second, total across both pipes
const IGNITION_LIFE = 0.16;

const FLAME_TEX_W = 24;
const FLAME_TEX_H = 64;

let flameTexture = null;
let blobTexture = null;

/**
 * A flame tongue, anchored at its nozzle (top-centre): wide and bright
 * near the anchor, tapering to a soft point at the far edge. Scaling this
 * per frame (scaleY for length, scaleX for width) reshapes the whole
 * tongue at once, so the flicker that used to redraw three polygons is
 * now two numbers.
 */
function makeFlameTexture(w = FLAME_TEX_W, h = FLAME_TEX_H) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const cx = w / 2;
  for (let y = 0; y < h; y++) {
    const ty = y / (h - 1);                              // 0 nozzle .. 1 tip
    const halfW = cx * Math.max(0.08, 1 - ty * 0.82);      // a body, not a needle -- still has a third of its width left at the tip
    const lenFalloff = (1 - ty) ** 0.55;                   // brightest at the nozzle, stays lit further down
    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x + 0.5 - cx);
      const edge = dx > halfW ? 0 : 1 - dx / halfW;        // 0 at the flame's own edge, 1 at its spine
      const a = (edge ** 0.85) * lenFalloff;                // fuller across the width, less of a hard spine
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
    }
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(canvas);
}

/** Two fixed particles (one per exhaust pipe) on their own layer -- there
 *  is nothing bursty about the flame body, so this is not a pool: just
 *  two sprites toggled on and reshaped every frame. */
function makeTongueLayer(texture, blend) {
  const view = new ParticleContainer({
    dynamicProperties: { vertex: true, position: true, rotation: true, color: true },
  });
  view.blendMode = blend;
  const left = new Particle({ texture, anchorX: 0.5, anchorY: 0, alpha: 0 });
  const right = new Particle({ texture, anchorX: 0.5, anchorY: 0, alpha: 0 });
  view.addParticle(left);
  view.addParticle(right);
  return { view, sprites: [left, right] };
}

export function buildBoostFlame() {
  if (!flameTexture) flameTexture = makeFlameTexture();
  if (!blobTexture) blobTexture = makeBlobTexture();

  const view = new Container();

  const outer = makeTongueLayer(flameTexture, 'normal');
  const inner = makeTongueLayer(flameTexture, 'add');
  view.addChild(outer.view);
  view.addChild(inner.view);

  const embers = makePool(blobTexture, EMBER_MAX, { blend: 'add' });
  view.addChild(embers.view);

  const ignition = makePool(blobTexture, 2, { blend: 'add' });
  view.addChild(ignition.view);

  let emberAccum = 0;
  let wasBoosting = false;

  function reset() {
    for (const p of outer.sprites) p.alpha = 0;
    for (const p of inner.sprites) p.alpha = 0;
    clearPool(embers);
    clearPool(ignition);
    emberAccum = 0;
    wasBoosting = false;
  }

  /**
   * @param car   anything with x, y, angle, boosting, driftVisualAngle
   *              (PlayerCar/RivalCar)
   * @param dt
   * @param s     worldScale (1/baseZoom) -- converts the effect's
   *              screen-pixel authoring sizes into world units, same
   *              convention used everywhere else cars/effects are sized.
   * @param size  the vehicle's DRAWN {w, h} in screen pixels -- the
   *              actual sprite size, so the exhaust sits at the rear of
   *              the car as drawn (matters for stage 2/5's rivals, which
   *              draw smaller than the box their other numbers are in).
   */
  function update(car, dt, s, size = { w: 70, h: 98 }) {
    view.position.set(car.x, car.y);
    // Follow the visible chassis angle, not only the travel/heading angle.
    // During a drift the body is yawed by driftVisualAngle, so the exhaust
    // must rotate with that rear end for both player and rival cars.
    view.rotation = car.angle + Math.PI / 2 + (car.driftVisualAngle || 0);

    const spread = (car?.constructor?.name === 'PlayerCar' ? PLAYER_EXHAUST_SPREAD : RIVAL_EXHAUST_SPREAD) * size.w;
    const base = size.h * 0.46 * s;
    const pipes = [-spread * s, spread * s];

    if (car.boosting) {
      if (!wasBoosting) {
        // Ignition: one bright pulse per pipe on the exact frame a burst
        // starts, so the first instant reads as a punch rather than a
        // fade-in.
        for (const x of pipes) {
          const p = take(ignition);
          p.x = x; p.y = base; p.age = 0;
        }
      }
      // Length AND width both flicker now, independently per pipe -- a
      // single shared length-only flicker (the original) moves both
      // tongues in lockstep, which reads as one flame with two nozzles
      // rather than two separate exhausts each doing their own thing.
      for (let k = 0; k < 2; k++) {
        const x = pipes[k];
        const flicker = 1 + Math.random() * 0.4;

        const outerLen = 58 * flicker * s;
        const outerW = 26 * (0.85 + Math.random() * 0.3) * s;
        const o = outer.sprites[k];
        o.x = x; o.y = base;
        o.scaleX = outerW / FLAME_TEX_W;
        o.scaleY = outerLen / FLAME_TEX_H;
        o.alpha = 0.78;
        o.tint = 0x84d8ff;

        const coreLen = outerLen * (0.58 + Math.random() * 0.12);
        const coreW = 13 * (0.85 + Math.random() * 0.3) * s;
        const c = inner.sprites[k];
        c.x = x; c.y = base + s;
        c.scaleX = coreW / FLAME_TEX_W;
        c.scaleY = coreLen / FLAME_TEX_H;
        c.alpha = 1;
        c.tint = 0xffcf7a;

        // Embers spawn anywhere along this pipe's flame length, not just
        // at the nozzle -- sparks breaking off the body of the flame,
        // not a separate fountain welling up from underneath it.
        emberAccum += dt * EMBER_RATE * 0.5;
        while (emberAccum >= 1) {
          emberAccum -= 1;
          const along = Math.random() * outerLen * 0.75;
          const jitter = (Math.random() - 0.5) * 0.7;
          const speed = (50 + Math.random() * 110) * s;
          const it = take(embers);
          it.x = x + (Math.random() - 0.5) * 4 * s;
          it.y = base + along;
          it.vx = Math.sin(jitter) * speed;
          it.vy = Math.cos(jitter) * speed + 30 * s;
          it.age = 0;
          it.size = (1.8 + Math.random() * 2.0) * s;
        }
      }
    } else {
      for (const p of outer.sprites) p.alpha = 0;
      for (const p of inner.sprites) p.alpha = 0;
      emberAccum = 0;
    }
    wasBoosting = car.boosting;

    for (let i = embers.count - 1; i >= 0; i--) {
      const p = embers.items[i];
      p.age += dt;
      if (p.age >= EMBER_LIFE) { release(embers, i); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = 1 - Math.min(1, dt * 2.4);
      p.vx *= k; p.vy *= k;
      const t = p.age / EMBER_LIFE;
      const g = p.particle;
      g.x = p.x; g.y = p.y;
      g.scaleX = g.scaleY = (p.size * (1 - t * 0.4) * 2) / 32;
      g.tint = t < 0.4 ? 0xfff0c0 : 0xff8a3a;
      g.alpha = Math.max(0, 1 - t * t);
    }

    for (let i = ignition.count - 1; i >= 0; i--) {
      const p = ignition.items[i];
      p.age += dt;
      if (p.age >= IGNITION_LIFE) { release(ignition, i); continue; }
      const t = p.age / IGNITION_LIFE;
      const g = p.particle;
      g.x = p.x; g.y = p.y;
      g.scaleX = g.scaleY = (14 * (0.5 + t * 0.9) * s * 2) / 32;
      g.tint = 0xffffff;
      g.alpha = 0.9 * (1 - t);
    }
  }

  return { view, update, reset };
}
