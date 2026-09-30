/**
 * A green aura for a boosting car (rival config `boostFx: 'aura'`, stage 5's
 * boss): the whole body lit green, and streaks of light that start at the
 * nose -- the way the car is heading -- and stream back along its flanks and
 * off the tail, as the air would go past it. No flame.
 *
 * Same contract as buildBoostFlame / buildBoostWings: a `view` pinned to the
 * car, `update(car, dt, s, size)` every frame, `reset()`. The view is rotated
 * with the car sprite, so here -y is the nose, +y the tail and x across.
 *
 *   glow    the car's own silhouette, tinted green and softened, laid behind
 *           it at 2.5x, additive -- the halo round the body. Softened by
 *           halving the canvas down and scaling it back up, not ctx.filter
 *           (Safari on iPhone does not have it).
 *   tint    the car's own picture again, green and additive, over the car:
 *           the body itself takes the colour.
 *   flame   behind the tail, green tongues in the shape of a flame (the
 *           same tapered tongue texture the nitro flame uses): a big one
 *           down the middle and a smaller one either side, flickering, and
 *           growing and dying with the burst. Green sparks break off them.
 *   streaks pooled particles (particlePool.js), born along the nose, run
 *           back at 2-3 car lengths a second, fade in and out.
 *   pulse   one bright ring on the frame a burst starts.
 */
import { Container, Sprite, Texture } from '../pixi.js';
import { makeBlobTexture, makeStreakTexture, makePool, take, release, clearPool } from './particlePool.js';
import { makeFlameTexture } from './boostfx.js';

const GREEN = 0x3dff7c;
const GREEN_HOT = 0xc4ffd6;

/** The car sits in the middle of the glow canvas, this fraction of its size. */
const GLOW_CAR_SHARE = 0.4;
const STREAK_MAX = 64;
const STREAK_RATE = 70;    // per second while it burns
const EMBER_MAX = 36;
const EMBER_RATE = 60;     // per second while it burns
const EMBER_LIFE = 0.55;
const PULSE_LIFE = 0.4;

let blobTexture = null;
let streakTexture = null;
let flameTexture = null;
const glowTextures = new WeakMap();

/** Halve a canvas `times` over, each step averaging 2x2 (bilinear). */
function shrink(canvas, times) {
  let cur = canvas;
  for (let i = 0; i < times; i++) {
    const next = document.createElement('canvas');
    next.width = Math.max(2, cur.width >> 1);
    next.height = Math.max(2, cur.height >> 1);
    const c = next.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  return cur;
}

/** Green light in the shape of the car: crisp core plus two widths of soft halo. */
function makeGlowTexture(carTexture) {
  const src = carTexture.source?.resource;
  const aspect = src?.width ? src.height / src.width : 1.25;
  const W = 128, H = Math.round(128 * aspect);
  const car = document.createElement('canvas');
  car.width = W; car.height = H;
  const cc = car.getContext('2d');
  if (src?.width) {
    cc.drawImage(src, W * (1 - GLOW_CAR_SHARE) / 2, H * (1 - GLOW_CAR_SHARE) / 2, W * GLOW_CAR_SHARE, H * GLOW_CAR_SHARE);
  }
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const oc = out.getContext('2d');
  oc.imageSmoothingEnabled = true;
  oc.globalCompositeOperation = 'lighter';
  for (const [halve, alpha] of [[4, 1.0], [3, 0.9], [2, 0.7]]) {
    oc.globalAlpha = alpha;
    oc.drawImage(shrink(car, halve), 0, 0, W, H);
  }
  oc.globalAlpha = 0.35;
  oc.drawImage(car, 0, 0);
  // colour: whatever light there is becomes green
  oc.globalAlpha = 1;
  oc.globalCompositeOperation = 'source-in';
  oc.fillStyle = '#3dff7c';
  oc.fillRect(0, 0, W, H);
  return Texture.from(out);
}

export function buildBoostAura(carTexture) {
  if (!blobTexture) blobTexture = makeBlobTexture();
  if (!streakTexture) streakTexture = makeStreakTexture(64, 8);
  if (!flameTexture) flameTexture = makeFlameTexture();
  let glowTexture = glowTextures.get(carTexture);
  if (!glowTexture) { glowTexture = makeGlowTexture(carTexture); glowTextures.set(carTexture, glowTexture); }

  const view = new Container();

  const glow = new Sprite(glowTexture);
  glow.anchor.set(0.5);
  glow.blendMode = 'add';
  glow.alpha = 0;
  view.addChild(glow);

  // the body itself, coloured
  const tint = new Sprite(carTexture);
  tint.anchor.set(0.5);
  tint.blendMode = 'add';
  tint.tint = GREEN;
  tint.alpha = 0;
  view.addChild(tint);

  // flame tongues at the tail: [x share of the width, length, width] -- the
  // middle one biggest. Each is an outer green tongue with a pale core over it.
  const FLAME_TEX_W = 24, FLAME_TEX_H = 64;
  const tongues = [[0, 1, 1], [-0.25, 0.78, 0.7], [0.25, 0.78, 0.7]].map(([x, len, wid]) => {
    const outer = new Sprite(flameTexture);
    const core = new Sprite(flameTexture);
    for (const sp of [outer, core]) { sp.anchor.set(0.5, 0); sp.blendMode = 'add'; sp.alpha = 0; }
    outer.tint = GREEN;
    core.tint = 0xdcffe8;
    view.addChild(outer, core);
    return { x, len, wid, outer, core };
  });
  const embers = makePool(blobTexture, EMBER_MAX, { blend: 'add' });
  view.addChild(embers.view);

  // texture x runs to the tail (+y) with rotation pi/2, the bright head at the
  // right and anchored, so each streak leads toward the tail
  const streaks = makePool(streakTexture, STREAK_MAX, { anchorX: 1, anchorY: 0.5, blend: 'add' });
  view.addChild(streaks.view);
  const pulse = makePool(blobTexture, 2, { blend: 'add' });
  view.addChild(pulse.view);

  let amt = 0, clock = 0, accum = 0, emberAccum = 0, wasBoosting = false;

  function reset() {
    glow.alpha = 0;
    tint.alpha = 0;
    for (const t of tongues) { t.outer.alpha = 0; t.core.alpha = 0; }
    clearPool(embers);
    clearPool(streaks);
    clearPool(pulse);
    emberAccum = 0;
    amt = clock = accum = 0;
    wasBoosting = false;
  }

  function spawnStreak(s, size) {
    const w = size.w * s, h = size.h * s;
    const f = take(streaks);
    const u = Math.random() * 2 - 1;
    // along the nose and a little past the flanks, most of them on the body
    f.x = u * w * (0.34 + Math.random() * 0.2);
    f.y = -h * (0.36 + Math.random() * 0.12);
    f.vy = h * (2.0 + Math.random() * 1.2);
    // sliding off the body toward the tail: they open out a little
    f.vx = Math.sign(u || 1) * w * (0.15 + Math.random() * 0.35);
    f.age = 0;
    f.life = 0.42 + Math.random() * 0.26;
    f.len = h * (0.22 + Math.random() * 0.38);
    f.thick = (1.4 + Math.random() * 2.2) * s;
    f.hot = Math.random() < 0.3;
  }

  /**
   * @param car   x, y, angle, boosting, driftVisualAngle
   * @param s     worldScale (1/baseZoom)
   * @param size  the vehicle's DRAWN {w, h} in screen pixels
   */
  function update(car, dt, s, size = { w: 70, h: 98 }) {
    view.position.set(car.x, car.y);
    view.rotation = car.angle + Math.PI / 2 + (car.driftVisualAngle || 0);
    clock += dt;

    const boosting = !!car.boosting;
    if (boosting && !wasBoosting) {
      const p = take(pulse);
      p.x = 0; p.y = 0; p.age = 0;
    }
    wasBoosting = boosting;
    amt += ((boosting ? 1 : 0) - amt) * (1 - Math.exp(-dt * (boosting ? 12 : 3)));
    if (amt < 0.004) amt = 0;

    if (amt > 0) {
      const beat = 0.5 + 0.5 * Math.sin(clock * 15);
      const w = size.w * s, h = size.h * s;
      glow.width = (w / GLOW_CAR_SHARE) * (1 + 0.05 * beat);
      glow.height = (h / GLOW_CAR_SHARE) * (1 + 0.04 * beat);
      glow.alpha = (0.75 + 0.25 * beat) * amt;
      tint.width = w; tint.height = h;
      tint.alpha = (0.45 + 0.2 * beat) * amt;
    } else {
      glow.alpha = 0;
      tint.alpha = 0;
    }

    if (boosting) {
      accum += dt * STREAK_RATE;
      while (accum >= 1) { accum -= 1; spawnStreak(s, size); }
    } else accum = 0;

    // the flame: grows with the burst (amt) and flickers in length and width
    if (amt > 0) {
      const w = size.w * s, h = size.h * s;
      const base = h * 0.44;
      for (const t of tongues) {
        const flick = 1 + Math.random() * 0.45;
        const len = h * 1.3 * t.len * flick * amt;
        const wid = w * 1.0 * t.wid * (0.85 + Math.random() * 0.3) * (0.4 + 0.6 * amt);
        const o = t.outer;
        o.x = t.x * w; o.y = base;
        o.scale.set(wid / FLAME_TEX_W, len / FLAME_TEX_H);
        o.alpha = 0.85 * amt;
        const c = t.core;
        c.x = t.x * w; c.y = base + s;
        c.scale.set((wid * 0.45) / FLAME_TEX_W, (len * (0.55 + Math.random() * 0.12)) / FLAME_TEX_H);
        c.alpha = amt;
      }
    } else {
      for (const t of tongues) { t.outer.alpha = 0; t.core.alpha = 0; }
    }
    // sparks breaking off the flame
    if (boosting) {
      emberAccum += dt * EMBER_RATE;
      while (emberAccum >= 1) {
        emberAccum -= 1;
        const w = size.w * s, h = size.h * s;
        const e = take(embers);
        e.x = (Math.random() * 2 - 1) * w * 0.3;
        e.y = h * (0.5 + Math.random() * 0.9);
        e.vx = (Math.random() - 0.5) * w * 1.1;
        e.vy = h * (0.9 + Math.random() * 1.6);
        e.age = 0;
        e.size = (2.2 + Math.random() * 2.6) * s;
      }
    } else emberAccum = 0;
    for (let i = embers.count - 1; i >= 0; i--) {
      const e = embers.items[i];
      e.age += dt;
      if (e.age >= EMBER_LIFE) { release(embers, i); continue; }
      const t = e.age / EMBER_LIFE;
      e.x += e.vx * dt; e.y += e.vy * dt;
      const g = e.particle;
      g.x = e.x; g.y = e.y;
      g.scaleX = g.scaleY = (e.size * (1 - t * 0.5) * 2) / 32;
      g.tint = t < 0.4 ? GREEN_HOT : GREEN;
      g.alpha = Math.max(0, 1 - t * t);
    }

    for (let i = streaks.count - 1; i >= 0; i--) {
      const f = streaks.items[i];
      f.age += dt;
      if (f.age >= f.life) { release(streaks, i); continue; }
      const t = f.age / f.life;
      f.y += f.vy * dt;
      f.x += f.vx * dt * t;              // sliding outward more the further back
      const g = f.particle;
      g.x = f.x; g.y = f.y;
      g.rotation = Math.PI / 2;
      g.scaleX = f.len / 64;
      g.scaleY = f.thick / 8;
      g.tint = f.hot ? GREEN_HOT : GREEN;
      // in quickly, out over the last half
      g.alpha = Math.min(1, t / 0.12) * (t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5) * 0.9;
    }

    for (let i = pulse.count - 1; i >= 0; i--) {
      const p = pulse.items[i];
      p.age += dt;
      if (p.age >= PULSE_LIFE) { release(pulse, i); continue; }
      const t = p.age / PULSE_LIFE;
      const g = p.particle;
      g.x = p.x; g.y = p.y;
      g.scaleX = g.scaleY = (size.h * s * (1.0 + t * 1.6)) / 32;
      g.tint = GREEN;
      g.alpha = 0.8 * (1 - t) ** 1.5;
    }
  }

  return { view, update, reset };
}
