/**
 * A pair of wings of light in place of the nitro flame, for the one rival
 * that asks for it (`boostFx: 'wings'` in config.js, stage 3's AE86).
 * Same contract as buildBoostFlame(): { view, update, reset }, one per car,
 * pinned to the car and turned with its drawn heading, tail toward +y.
 *
 * Drawn top-down, so the wings spread out over the road from the car's
 * shoulders and sweep back toward its tail:
 *   wings     a fan of tapered feathers, white at the root going blue and
 *             clear at the tips -- a soft additive layer for the glow and a
 *             normal-blend one under it so they still read over pale road.
 *             They open with a little overshoot when the boost starts, beat
 *             gently while it runs, and fold away slowly when it ends.
 *   feathers  single feathers that come off the wings and drift back,
 *             swaying, turning over and fading (pooled, like the embers).
 *   halo      a soft blue glow behind the car, and one white pulse on the
 *             frame the burst starts.
 * Everything is generated (canvas), nothing is a picture.
 */
import { Container, Sprite, Texture } from '../pixi.js';
import { makeBlobTexture, makePool, take, release, clearPool } from './particlePool.js';

const WING_TEX = 256;
const ROOT_X = 10, ROOT_Y = 125;      // where the wing joins the car, in the texture
const FEATHERS = 12;
const FAN_FROM = -25 * Math.PI / 180;  // the leading feather, a little forward of straight out
const FAN_TO = 78 * Math.PI / 180;     // the trailing one, nearly back along the car
const FEATHER_LEN = 240;

const featherLength = (t) => FEATHER_LEN * (1 - 0.5 * t ** 1.3);   // longest at the front edge
const featherAngle = (t) => FAN_FROM + (FAN_TO - FAN_FROM) * t;

let wingTexture = null, featherTexture = null, blobTexture = null;

/** One leaf, root at the origin pointing along +x, `len` long and `w` wide. */
function leaf(ctx, len, w) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.45, -w, len, 0);
  ctx.quadraticCurveTo(len * 0.5, w * 0.85, 0, 0);
  ctx.fill();
}

function makeWingTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = WING_TEX;
  const ctx = c.getContext('2d');
  ctx.globalCompositeOperation = 'lighter';
  // the vane of the wing itself: a soft surface out to the feather tips, so
  // the feathers read as one wing rather than a fan of spikes
  const tip = (t) => [ROOT_X + Math.cos(featherAngle(t)) * featherLength(t) * 0.97, ROOT_Y + Math.sin(featherAngle(t)) * featherLength(t) * 0.97];
  ctx.beginPath();
  ctx.moveTo(ROOT_X, ROOT_Y);
  for (let i = 0; i < FEATHERS; i++) { const [x, y] = tip(i / (FEATHERS - 1)); ctx.lineTo(x, y); }
  ctx.closePath();
  const vane = ctx.createRadialGradient(ROOT_X, ROOT_Y, 0, ROOT_X, ROOT_Y, FEATHER_LEN);
  vane.addColorStop(0, 'rgba(255,255,255,0.42)');
  vane.addColorStop(0.6, 'rgba(190,210,255,0.22)');
  vane.addColorStop(1, 'rgba(130,150,255,0.05)');
  ctx.fillStyle = vane;
  ctx.fill();
  for (let i = 0; i < FEATHERS; i++) {
    const t = i / (FEATHERS - 1), len = featherLength(t), w = 40 - 15 * t;
    ctx.save();
    ctx.translate(ROOT_X, ROOT_Y);
    ctx.rotate(featherAngle(t));
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.5, 'rgba(214,232,255,0.4)');
    g.addColorStop(1, 'rgba(120,140,255,0)');
    ctx.fillStyle = g;
    leaf(ctx, len, w);
    // the rib, brighter than the vane
    const rib = ctx.createLinearGradient(0, 0, len, 0);
    rib.addColorStop(0, 'rgba(255,255,255,0.7)');
    rib.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = rib;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len * 0.94, 0); ctx.stroke();
    ctx.restore();
  }
  // a bright wash at the root where the feathers all meet
  const glow = ctx.createRadialGradient(ROOT_X, ROOT_Y, 0, ROOT_X, ROOT_Y, 70);
  glow.addColorStop(0, 'rgba(255,255,255,0.26)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WING_TEX, WING_TEX);
  return Texture.from(c);
}

function makeFeatherTexture() {
  const w = 16, h = 48;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.translate(w / 2, h);
  ctx.rotate(-Math.PI / 2);          // root at the bottom, tip at the top
  const g = ctx.createLinearGradient(0, 0, h, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.7, 'rgba(235,244,255,0.9)');
  g.addColorStop(1, 'rgba(200,220,255,0.35)');
  ctx.fillStyle = g;
  leaf(ctx, h, w * 0.5);
  ctx.strokeStyle = 'rgba(150,175,255,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(h * 0.95, 0); ctx.stroke();
  return Texture.from(c);
}

const FEATHER_MAX = 40;
const FEATHER_RATE = 34;   // per second while the wings are open
const FEATHER_BURST = 12;  // and this many at the moment they open

export function buildBoostWings() {
  if (!wingTexture) wingTexture = makeWingTexture();
  if (!featherTexture) featherTexture = makeFeatherTexture();
  if (!blobTexture) blobTexture = makeBlobTexture();

  const view = new Container();

  const halo = new Sprite(blobTexture);
  halo.anchor.set(0.5);
  halo.blendMode = 'add';
  halo.tint = 0x8fa8ff;
  halo.alpha = 0;
  view.addChild(halo);

  // [right, left], each a soft normal-blend body under an additive glow
  const wings = [1, -1].map((side) => {
    const body = new Sprite(wingTexture);
    const glow = new Sprite(wingTexture);
    for (const s of [body, glow]) { s.anchor.set(ROOT_X / WING_TEX, ROOT_Y / WING_TEX); s.alpha = 0; }
    body.tint = 0xc9dcff;
    glow.blendMode = 'add';
    glow.tint = 0xdfe9ff;
    view.addChild(body, glow);
    return { side, body, glow };
  });

  const feathers = makePool(featherTexture, FEATHER_MAX, { anchorX: 0.5, anchorY: 0.5, blend: 'normal' });
  view.addChild(feathers.view);
  const pulse = makePool(blobTexture, 2, { blend: 'add' });
  view.addChild(pulse.view);

  let amt = 0, pop = 0, clock = 0, accum = 0, wasBoosting = false;

  function reset() {
    for (const w of wings) { w.body.alpha = 0; w.glow.alpha = 0; }
    halo.alpha = 0;
    clearPool(feathers);
    clearPool(pulse);
    amt = pop = clock = accum = 0;
    wasBoosting = false;
  }

  function spawnFeather(s, rootX, rootY, size, scale) {
    const side = Math.random() < 0.5 ? 1 : -1;
    const t = Math.random(), a = featherAngle(t), u = 0.5 + Math.random() * 0.5;
    const len = featherLength(t) * scale * u;
    const f = take(feathers);
    f.x = side * (rootX + Math.cos(a) * len);
    f.y = rootY + Math.sin(a) * len;
    f.vx = side * (14 + Math.random() * 56) * s;
    f.vy = (70 + Math.random() * 110) * s;
    f.age = 0;
    f.life = 0.85 + Math.random() * 0.5;
    f.phase = Math.random() * 6.28;
    f.sway = (10 + Math.random() * 16) * s;
    f.len = (15 + Math.random() * 10) * s;
    f.rot = Math.random() * 6.28;
    f.spin = (Math.random() - 0.5) * 5;
  }

  /** As buildBoostFlame's update: `size` is the vehicle's drawn {w, h} in
   *  screen pixels and `s` the world scale. */
  function update(car, dt, s, size = { w: 70, h: 98 }) {
    view.position.set(car.x, car.y);
    view.rotation = car.angle + Math.PI / 2 + (car.driftVisualAngle || 0);
    clock += dt;

    const boosting = !!(car.wingsOpen ?? car.boosting);
    const rootX = 0.30 * size.w * s, rootY = -0.02 * size.h * s;
    const scale = (1.1 * size.h * s) / FEATHER_LEN;

    if (boosting && !wasBoosting) {
      pop = 1;
      for (let i = 0; i < FEATHER_BURST; i++) spawnFeather(s, rootX, rootY, size, scale);
      const p = take(pulse);
      p.x = 0; p.y = 0; p.age = 0;
    }
    wasBoosting = boosting;
    amt += ((boosting ? 1 : 0) - amt) * (1 - Math.exp(-dt * (boosting ? 14 : 1.3)));
    if (amt < 0.004) amt = 0;
    pop *= Math.exp(-dt * 6);

    if (amt > 0) {
      const beat = Math.sin(clock * 7.5);
      const open = amt * (1 + 0.28 * pop);          // opens past full, settles back
      for (const w of wings) {
        const rot = (0.02 + 0.08 * beat) * amt;      // the beat of the wing about its root
        const sx = scale * open * (1 + 0.05 * beat), sy = scale * open;
        for (const sp of [w.body, w.glow]) {
          sp.x = w.side * rootX; sp.y = rootY;
          sp.scale.set(w.side * sx, sy);
          sp.rotation = w.side * rot;
        }
        w.body.alpha = 0.5 * Math.min(1, amt * 1.4);
        w.glow.alpha = (0.85 + 0.15 * Math.sin(clock * 11 + w.side)) * amt;
      }
      halo.scale.set((2.4 * size.w * s * (1 + 0.1 * beat)) / 32 * 1.0);
      halo.alpha = 0.3 * amt;
    } else {
      for (const w of wings) { w.body.alpha = 0; w.glow.alpha = 0; }
      halo.alpha = 0;
    }

    if (amt > (boosting ? 0.5 : 0.4)) {
      accum += dt * FEATHER_RATE;
      while (accum >= 1) { accum -= 1; spawnFeather(s, rootX, rootY, size, scale); }
    } else accum = 0;

    for (let i = feathers.count - 1; i >= 0; i--) {
      const f = feathers.items[i];
      f.age += dt;
      if (f.age >= f.life) { release(feathers, i); continue; }
      f.x += (f.vx + Math.cos(f.age * 5 + f.phase) * f.sway) * dt;
      f.y += f.vy * dt;
      f.vy *= 1 - Math.min(1, dt * 0.6);
      f.rot += f.spin * dt;
      const t = f.age / f.life;
      const g = f.particle;
      g.x = f.x; g.y = f.y;
      g.rotation = f.rot;
      // turning over as it falls: its width breathes
      g.scaleX = (f.len * 0.34 * (0.55 + 0.45 * Math.abs(Math.cos(f.age * 4 + f.phase)))) / 16 * 1.4;
      g.scaleY = f.len / 48;
      g.tint = t < 0.5 ? 0xf5faff : 0xbcd2ff;
      g.alpha = Math.min(1, f.age / 0.08) * (1 - t * t);
    }

    for (let i = pulse.count - 1; i >= 0; i--) {
      const p = pulse.items[i];
      p.age += dt;
      if (p.age >= 0.22) { release(pulse, i); continue; }
      const t = p.age / 0.22, g = p.particle;
      g.x = p.x; g.y = p.y;
      g.scaleX = g.scaleY = (3.2 * size.w * s * (0.4 + t)) / 32;
      g.tint = 0xdbe6ff;
      g.alpha = 0.8 * (1 - t);
    }
  }

  return { view, update, reset };
}
