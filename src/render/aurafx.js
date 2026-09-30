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
 *   streaks pooled particles (particlePool.js), born along the nose, run
 *           back at 2-3 car lengths a second, fade in and out.
 *   pulse   one bright ring on the frame a burst starts.
 */
import { Container, Sprite, Texture } from '../pixi.js';
import { makeBlobTexture, makeStreakTexture, makePool, take, release, clearPool } from './particlePool.js';

const GREEN = 0x3dff7c;
const GREEN_HOT = 0xc4ffd6;

/** The car sits in the middle of the glow canvas, this fraction of its size. */
const GLOW_CAR_SHARE = 0.4;
const STREAK_MAX = 64;
const STREAK_RATE = 120;   // per second while it burns
const PULSE_LIFE = 0.4;

let blobTexture = null;
let streakTexture = null;
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

  // texture x runs to the tail (+y) with rotation pi/2, the bright head at the
  // right and anchored, so each streak leads toward the tail
  const streaks = makePool(streakTexture, STREAK_MAX, { anchorX: 1, anchorY: 0.5, blend: 'add' });
  view.addChild(streaks.view);
  const pulse = makePool(blobTexture, 2, { blend: 'add' });
  view.addChild(pulse.view);

  let amt = 0, clock = 0, accum = 0, wasBoosting = false;

  function reset() {
    glow.alpha = 0;
    tint.alpha = 0;
    clearPool(streaks);
    clearPool(pulse);
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
