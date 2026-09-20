/**
 * Player-only feedback for the two ways a car can leave the ideal line:
 * running onto the grass shoulder, and hitting the road's outer barrier.
 * Before this, both were numbers only -- a lower speed cap on grass, a
 * position snap and a camera shake at the wall -- with nothing at the car
 * itself to say what just happened.
 *
 * Two independent particle systems, each in its own view so they can sit on
 * opposite sides of the car in the paint order (see main.js): dust spawns
 * continuously off `car.onGrass` and belongs at road level, under the car,
 * the same as the drift marks; sparks fire once per `car.wallImpact` and
 * belong ON TOP, over the car, the same as an impact ought to read.
 *
 * State (the live particle lists) lives in this module's closure rather
 * than on the car, matching finishfx.js's confetti/lines -- it is pure
 * effect, regenerated from the car's current state each frame, not
 * something the simulation itself needs to remember.
 */
import { Container, Graphics } from '../pixi.js';

const DUST_LIFE = 0.62;
const DUST_MAX = 48;
const SPARK_LIFE = 0.32;
const SPARK_COUNT = 12;

export function buildContactFX() {
  const dustView = new Container();
  const dustGfx = new Graphics();
  dustView.addChild(dustGfx);

  const sparkView = new Container();
  const sparkGfx = new Graphics();
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
   * @param car  PlayerCar: x, y, angle, speed, onGrass, wallImpact
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

    // --- sparks: one burst per NEW wall impact, not per frame of contact --
    // (car.wallImpact is already the rising edge -- see player.js) so no
    // debouncing is needed here.
    if (car.wallImpact) {
      for (let i = 0; i < SPARK_COUNT; i++) {
        const a = Math.random() * Math.PI * 2;
        const spd = (90 + Math.random() * 170) * s;
        sparks.push({
          x: car.x,
          y: car.y,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          age: 0,
          size: (2 + Math.random() * 2) * s,
        });
      }
    }

    sparkGfx.clear();
    sparks = sparks.filter((p) => {
      p.age += dt;
      if (p.age >= SPARK_LIFE) return false;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - Math.min(1, dt * 3.2);
      p.vy *= 1 - Math.min(1, dt * 3.2);
      const t = p.age / SPARK_LIFE;
      const color = t < 0.45 ? 0xfff4c8 : 0xff9a3c;
      sparkGfx.circle(p.x, p.y, p.size * (1 - t * 0.5)).fill({ color, alpha: 1 - t });
      return true;
    });
  }

  return { dustView, sparkView, update, reset };
}
