/**
 * What it looks like when a car leaves the ideal line: dust off the grass
 * shoulder, and sparks/smoke where a panel is grinding on a barrier or on
 * the other car. Runs for BOTH cars -- update() takes the list.
 *
 * Four particle systems across two views, so they can sit on opposite
 * sides of the cars in the paint order (see main.js):
 *
 *   under the cars   dust    grass thrown up behind the wheels
 *                    smoke   grey haze off a grinding contact patch
 *   over the cars    sparks  the abrasion itself
 *                    flash   the first frame of a real impact
 *
 * The realism is mostly in WHERE and WHICH WAY, not in the particle count.
 * Sparks come off the contact patch that car.contact reports -- the
 * barrier face, or the point where two bodies actually touch -- rather
 * than the middle of the roof, and they spray backwards along the car's
 * travel and away from the surface, the way an abrasion throws them,
 * instead of radiating evenly in a ring. A contact that keeps going keeps
 * producing them, at a rate that follows how fast the car is still
 * moving, because that is what a car scraping down a wall does.
 *
 * Drawn as pooled ParticleContainer sprites, NOT as Graphics. The first
 * version issued a fill or a stroke per particle into a Graphics that was
 * cleared and refilled every frame, which re-tessellates and re-uploads
 * the whole geometry each time: measured at ~50ms a frame with both cars
 * scraping, against 0.4ms with the effects off. Particles only ever
 * change position, rotation, scale and colour, which is exactly the set
 * ParticleContainer uploads as plain buffers, so the pools below are
 * allocated once and the per-frame work is arithmetic and nothing else.
 *
 * State (the live particle lists) lives in this module's closure rather
 * than on the cars, matching finishfx.js's confetti/lines -- it is pure
 * effect, regenerated from the cars' current state each frame, not
 * something the simulation needs to remember.
 */
import { Container } from '../pixi.js';
import { makeBlobTexture, makeStreakTexture, makePool, take, release, clearPool } from './particlePool.js';

const DUST_LIFE = 0.62;
const SMOKE_LIFE = 0.75;
const SPARK_LIFE = 0.30;
const FLASH_LIFE = 0.11;

// Pool sizes. A pooled particle that is not in use costs one alpha-0
// entry in a buffer upload, so these are sized for the worst case (both
// cars grinding along a barrier at speed) and then left alone.
const DUST_MAX = 56;
const SMOKE_MAX = 44;
const SPARK_MAX = 190;
const FLASH_MAX = 8;

const DUST_TINT = 0xb99a68;
const SMOKE_TINT = 0x9fa4a8;
const FLASH_TINT = 0xfff6d8;
// white-hot, then yellow, then a dull orange ember
const SPARK_TINTS = [0xfffdf4, 0xffe07a, 0xff8c28];

/** Unit vector, with a fallback so a zero-length input cannot produce NaN. */
function unit(x, y, fx = 1, fy = 0) {
  const d = Math.hypot(x, y);
  return d > 1e-6 ? [x / d, y / d] : [fx, fy];
}

// Built once for the whole app, not per stage: buildContactFX() runs on
// every loadStage.
let blobTexture = null;
let streakTexture = null;

export function buildContactFX() {
  if (!blobTexture) blobTexture = makeBlobTexture();
  if (!streakTexture) streakTexture = makeStreakTexture();

  const dust = makePool(blobTexture, DUST_MAX);
  const smoke = makePool(blobTexture, SMOKE_MAX);
  // Additive: overlapping sparks brighten instead of mixing into a flat
  // wash, which is what normal-blended fills looked like -- soft and grey
  // rather than hot. Same reason boostfx.js uses it for flame.
  const sparks = makePool(streakTexture, SPARK_MAX, { anchorX: 1, blend: 'add' });
  const flash = makePool(blobTexture, FLASH_MAX, { blend: 'add' });

  const underView = new Container();
  underView.addChild(dust.view);
  underView.addChild(smoke.view);

  const overView = new Container();
  overView.addChild(sparks.view);
  overView.addChild(flash.view);

  // Fractional spawn accumulators -- spawn rates are continuous (particles
  // per second), dt is not, so a straight "spawn N this frame" would tie
  // the density to the frame rate. One per car, keyed by index.
  const dustAccum = [];
  const sparkAccum = [];

  function reset() {
    for (const pool of [dust, smoke, sparks, flash]) clearPool(pool);
    dustAccum.length = 0;
    sparkAccum.length = 0;
  }

  /**
   * One spark off a contact patch.
   *
   * @param ax,ay  the spray axis: where this batch is being thrown.
   * @param spread half-angle of the cone around that axis, radians.
   * @param power  0..1, scales speed and length -- a faster car throws
   *               them further, a slow scrape barely lifts them.
   */
  function spawnSpark(x, y, ax, ay, spread, power, s) {
    const a = Math.atan2(ay, ax) + (Math.random() * 2 - 1) * spread;
    const spd = (130 + Math.random() * 300) * (0.45 + 0.55 * power) * s;
    const it = take(sparks);
    it.x = x + (Math.random() - 0.5) * 6 * s;
    it.y = y + (Math.random() - 0.5) * 6 * s;
    it.vx = Math.cos(a) * spd;
    it.vy = Math.sin(a) * spd;
    it.age = 0;
    it.life = SPARK_LIFE * (0.55 + Math.random() * 0.75);
    it.len = (9 + Math.random() * 13) * (0.5 + 0.5 * power) * s;
    it.width = (2.2 + Math.random() * 1.8) * s;
    // Each one tumbles at its own rate, so the burst twinkles instead of
    // dimming as a single block.
    it.flicker = 7 + Math.random() * 16;
    it.drag = 4.0 + Math.random() * 3.5;
  }

  function spawnPuff(pool, x, y, vx, vy, size) {
    const it = take(pool);
    it.x = x; it.y = y;
    it.vx = vx; it.vy = vy;
    it.age = 0;
    it.size = size;
  }

  /**
   * @param cars  every car that should throw effects. Each needs x, y,
   *              angle, speed, onGrass and a `contact` record (contact.js).
   * @param dt
   * @param s     worldScale -- converts screen-pixel authoring sizes and
   *              speeds into world units, same convention as boostfx.js.
   */
  function update(cars, dt, s) {
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      if (!car) continue;
      if (dustAccum[i] === undefined) { dustAccum[i] = 0; sparkAccum[i] = 0; }

      const [headX, headY] = unit(Math.cos(car.angle), Math.sin(car.angle));

      // --- dust: thrown up behind the wheels while crossing the grass ---
      // Below walking-off-the-line speed there is nothing to kick up, and
      // at full off-road speed the plume is at its densest.
      if (car.onGrass && car.speed > 40) {
        dustAccum[i] += dt * (14 + 26 * Math.min(1, car.speed / 320));
        while (dustAccum[i] >= 1) {
          dustAccum[i] -= 1;
          const back = (22 + Math.random() * 10) * s;
          const side = (Math.random() - 0.5) * 26 * s;
          spawnPuff(
            dust,
            car.x - headX * back - headY * side,
            car.y - headY * back + headX * side,
            -headX * (30 + Math.random() * 30) + (Math.random() - 0.5) * 40,
            -headY * (30 + Math.random() * 30) + (Math.random() - 0.5) * 40,
            (5 + Math.random() * 5) * s,
          );
        }
      } else {
        dustAccum[i] = 0;
      }

      // --- contact: sparks off the patch, smoke behind it ---------------
      const c = car.contact;
      if (c && c.scrape) {
        // Away from the surface, and mostly backwards along the car's own
        // travel: that is the direction the abrasion throws material. A
        // pure surface normal sprays into the wall or straight off it,
        // neither of which is what a scrape looks like.
        const [ax, ay] = unit(-headX - c.nx * 0.45, -headY - c.ny * 0.45, -headX, -headY);

        if (c.impact) {
          // A hit is a wide, hard shower plus one frame of glare.
          const n = 10 + Math.round(14 * c.force);
          for (let k = 0; k < n; k++) spawnSpark(c.x, c.y, ax, ay, 1.15, 0.6 + 0.4 * c.force, s);
          const f = take(flash);
          f.x = c.x; f.y = c.y; f.age = 0; f.size = (11 + 16 * c.force) * s;
          sparkAccum[i] = 0;
        }
        // Held contact keeps grinding: a narrow, steady stream for as long
        // as the car is still moving along the barrier. This is the part
        // that reads as scraping rather than as a single collision.
        const grind = Math.min(1, car.speed / 420);
        if (grind > 0.05) {
          sparkAccum[i] += dt * (26 + 120 * grind);
          while (sparkAccum[i] >= 1) {
            sparkAccum[i] -= 1;
            spawnSpark(c.x, c.y, ax, ay, 0.42, grind, s);
          }
          // and a thin haze of smoke off the same patch
          if (Math.random() < dt * 20 * grind) {
            spawnPuff(
              smoke, c.x, c.y,
              -headX * 45 * grind + (Math.random() - 0.5) * 30,
              -headY * 45 * grind + (Math.random() - 0.5) * 30,
              (4 + Math.random() * 5) * s,
            );
          }
        }
      } else {
        sparkAccum[i] = 0;
      }
    }

    // --- advance ------------------------------------------------------
    // Walking backwards so release()'s swap-with-last cannot skip a slot.
    for (let i = dust.count - 1; i >= 0; i--) {
      const p = dust.items[i];
      p.age += dt;
      if (p.age >= DUST_LIFE) { release(dust, i); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = 1 - Math.min(1, dt * 2.2);
      p.vx *= k; p.vy *= k;
      const t = p.age / DUST_LIFE;
      // grows and fades -- a puff, not a dot
      const sc = (p.size * (0.7 + t * 0.9) * 2) / 32;
      const g = p.particle;
      g.x = p.x; g.y = p.y;
      g.scaleX = g.scaleY = sc;
      g.tint = DUST_TINT;
      g.alpha = 0.40 * (1 - t);
    }

    for (let i = smoke.count - 1; i >= 0; i--) {
      const p = smoke.items[i];
      p.age += dt;
      if (p.age >= SMOKE_LIFE) { release(smoke, i); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = 1 - Math.min(1, dt * 1.7);
      p.vx *= k; p.vy *= k;
      const t = p.age / SMOKE_LIFE;
      // paler and thinner than the grass dust, and it keeps growing after
      // the dust has stopped -- rubber and paint smoke, not soil
      const g = p.particle;
      g.x = p.x; g.y = p.y;
      g.scaleX = g.scaleY = (p.size * (0.6 + t * 1.9) * 2) / 32;
      g.tint = SMOKE_TINT;
      g.alpha = 0.30 * (1 - t) * (1 - t);
    }

    for (let i = sparks.count - 1; i >= 0; i--) {
      const p = sparks.items[i];
      p.age += dt;
      if (p.age >= p.life) { release(sparks, i); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      // Heavy drag, no gravity: this is a top-down camera that rotates
      // with the car, so a world-space "down" would fall sideways or
      // upward depending on heading. A per-particle snap-to-a-stop reads
      // right from every rotation instead.
      const k = 1 - Math.min(1, dt * p.drag);
      p.vx *= k; p.vy *= k;
      const t = p.age / p.life;
      const speed = Math.hypot(p.vx, p.vy) || 1;
      // The streak trails BACK from the head, so it is anchored at its
      // right edge and rotated to point along the direction of travel;
      // it shortens as it cools rather than growing, which is what smoke
      // would do.
      const g = p.particle;
      g.x = p.x; g.y = p.y;
      g.rotation = Math.atan2(p.vy / speed, p.vx / speed);
      g.scaleX = (p.len * (1 - t * 0.55)) / 64;
      g.scaleY = (p.width * (1 - t * 0.5)) / 8;
      g.tint = t < 0.25 ? SPARK_TINTS[0] : t < 0.6 ? SPARK_TINTS[1] : SPARK_TINTS[2];
      g.alpha = Math.max(0, 1 - t * t) * (0.72 + 0.28 * Math.sin(p.age * p.flicker));
    }

    for (let i = flash.count - 1; i >= 0; i--) {
      const p = flash.items[i];
      p.age += dt;
      if (p.age >= FLASH_LIFE) { release(flash, i); continue; }
      const t = p.age / FLASH_LIFE;
      const g = p.particle;
      g.x = p.x; g.y = p.y;
      g.scaleX = g.scaleY = (p.size * (0.55 + t * 0.85) * 2) / 32;
      g.tint = FLASH_TINT;
      g.alpha = 0.85 * (1 - t);
    }
  }

  return { underView, overView, update, reset };
}
