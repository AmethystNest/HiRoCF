/**
 * Player-only feedback for the three ways a car can leave the ideal line:
 * running onto the grass shoulder, hitting the road's outer barrier, and
 * hitting the rival. Before this, all three were numbers only -- a lower
 * speed cap on grass, a position snap and a camera shake at the wall, a
 * shove and a speed scrub on the rival -- with nothing at the car itself
 * to say what just happened.
 *
 * Two independent particle systems, each in its own view so they can sit on
 * opposite sides of the car in the paint order (see main.js): dust spawns
 * continuously off `car.onGrass` and belongs at road level, under the car,
 * the same as the drift marks; sparks fire once per `car.wallImpact` or
 * `car.carImpact` and belong ON TOP, over the car, the same as an impact
 * ought to read.
 *
 * State (the live particle lists) lives in this module's closure rather
 * than on the car, matching finishfx.js's confetti/lines -- it is pure
 * effect, regenerated from the car's current state each frame, not
 * something the simulation itself needs to remember.
 */
import { Container, Graphics } from '../pixi.js';

const DUST_LIFE = 0.62;
const DUST_MAX = 48;
// Short and fast -- a spark is a glint, not a lingering glow. The dust
// puffs above are the slow, soft, fading shape; sparks have to read as the
// opposite of that at a glance; blendMode add on sparkGfx does the rest
// (see below), separating "bright glowing streak" from "flat brown smoke"
// by more than just the numbers.
const SPARK_LIFE = 0.24;
const SPARK_COUNT = 16;

export function buildContactFX() {
  const dustView = new Container();
  const dustGfx = new Graphics();
  dustView.addChild(dustGfx);

  const sparkView = new Container();
  const sparkGfx = new Graphics();
  // Additive: overlapping sparks brighten instead of mixing into a flat
  // wash, which is what a filled, normal-blend circle looked like -- soft
  // and grey rather than a hot glint. This one change reads as "metal",
  // same as boostfx.js's inner flame layers use it for "fire".
  sparkGfx.blendMode = 'add';
  sparkView.addChild(sparkGfx);

  let dust = [];
  let sparks = [];
  // Fractional spawn accumulator -- spawn rate is continuous (particles per
  // second), dt is not, so a straight "spawn N this frame" would tie the
  // dust density to the frame rate.
  let dustAccum = 0;

  function reset() {
    dust = [];
    sparks = [];
    dustAccum = 0;
    dustGfx.clear();
    sparkGfx.clear();
  }

  /**
   * @param car  PlayerCar: x, y, angle, speed, onGrass, wallImpact,
   *             carImpact
   * @param dt
   * @param s    worldScale -- converts screen-pixel authoring sizes/speeds
   *             into world units, same convention as boostfx.js.
   */
  function update(car, dt, s) {
    // --- dust: kicked up from the rear while grinding across the grass ---
    // Below walking-off-the-line speed there is nothing to kick up, and at
    // full off-road speed (grassMax) the plume is at its densest.
    if (car.onGrass && car.speed > 40) {
      const rate = 14 + 26 * Math.min(1, car.speed / 320);
      dustAccum += dt * rate;
      const backX = -Math.cos(car.angle), backY = -Math.sin(car.angle);
      const sideX = -Math.sin(car.angle), sideY = Math.cos(car.angle);
      while (dustAccum >= 1) {
        dustAccum -= 1;
        const back = (22 + Math.random() * 10) * s;
        const side = (Math.random() - 0.5) * 26 * s;
        dust.push({
          x: car.x + backX * back + sideX * side,
          y: car.y + backY * back + sideY * side,
          vx: backX * (30 + Math.random() * 30) + (Math.random() - 0.5) * 40,
          vy: backY * (30 + Math.random() * 30) + (Math.random() - 0.5) * 40,
          age: 0,
          size: (5 + Math.random() * 5) * s,
        });
      }
      if (dust.length > DUST_MAX) dust.splice(0, dust.length - DUST_MAX);
    } else {
      dustAccum = 0;
    }

    dustGfx.clear();
    dust = dust.filter((p) => {
      p.age += dt;
      if (p.age >= DUST_LIFE) return false;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - Math.min(1, dt * 2.2);
      p.vy *= 1 - Math.min(1, dt * 2.2);
      const t = p.age / DUST_LIFE;
      // grows and fades -- a puff, not a dot
      dustGfx.circle(p.x, p.y, p.size * (0.7 + t * 0.9)).fill({ color: 0xb99a68, alpha: 0.34 * (1 - t) });
      return true;
    });

    // --- sparks: one burst per NEW impact (wall or rival), not per frame
    // of contact -- car.wallImpact/car.carImpact are already the rising
    // edge (see player.js and race.js) so no debouncing is needed here.
    if (car.wallImpact || car.carImpact) {
      for (let i = 0; i < SPARK_COUNT; i++) {
        const a = Math.random() * Math.PI * 2;
        // Sharp and fast -- a shooting glint, not a drifting puff. Drag
        // below pulls this down hard within the first few frames, which is
        // what makes it read as a snap rather than a throw.
        const spd = (260 + Math.random() * 260) * s;
        sparks.push({
          x: car.x,
          y: car.y,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          age: 0,
          len: (9 + Math.random() * 9) * s,
          width: (1.1 + Math.random() * 0.9) * s,
        });
      }
    }

    sparkGfx.clear();
    sparks = sparks.filter((p) => {
      p.age += dt;
      if (p.age >= SPARK_LIFE) return false;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Heavy drag, no gravity: this is a top-down camera that rotates
      // with the car, so a world-space "down" would fall sideways or
      // upward depending on heading. A symmetric snap-to-a-stop reads
      // right from every rotation instead.
      const drag = 1 - Math.min(1, dt * 5.5);
      p.vx *= drag;
      p.vy *= drag;
      const t = p.age / SPARK_LIFE;
      const speed = Math.hypot(p.vx, p.vy) || 1;
      // Drawn as a short streak trailing back along its own velocity --
      // a line, not a dot -- and shrinking as it cools rather than
      // growing, which is what a puff of smoke would do.
      const len = p.len * (1 - t * 0.55);
      const dx = (p.vx / speed) * len, dy = (p.vy / speed) * len;
      const color = t < 0.35 ? 0xfffaf0 : 0xffb238;
      sparkGfx.moveTo(p.x - dx, p.y - dy).lineTo(p.x, p.y)
        .stroke({ width: p.width * (1 - t * 0.6), color, alpha: Math.max(0, 1 - t * 1.2), cap: 'round' });
      return true;
    });
  }

  return { dustView, sparkView, update, reset };
}
