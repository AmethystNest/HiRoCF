/**
 * Tyre marks from cornering hard on grip -- no slide, just a car carrying
 * real speed round a bend with the tyres working. Drift marks are laid
 * whenever a car slides (player.js / rival.js); these add fainter ones
 * when it is only leaning on its tyres.
 *
 * How hard a car is working its tyres is its lateral acceleration: ground
 * speed times the rate it is turning. The player's steering is on/off, so
 * that reading jumps; it is followed by a load that builds over a fraction
 * of a second and lets go faster, so a quick correction leaves nothing and
 * a held corner lays marks that fade in and out rather than switching.
 */
import { DRIFT_MARK_LIFE, PHYSICS as P } from '../config.js';

export const GRIP_MARK = {
  /** share of the car's top speed where marks start / are full */
  speedFrom: 0.45, speedFull: 0.65,
  /** lateral acceleration (world units/s^2) where they start / are full:
   *  full lock at racing speed is ~1,400-2,400, and the rivals spend
   *  about a fifth of a lap above 1,300 -- their real corners */
  latFrom: 1300, latFull: 1900,
  /** load follows the reading at these rates (1/s): builds, lets go */
  build: 4, release: 7,
  /** load below which nothing is laid, and a full load's opacity against
   *  a drift mark's */
  show: 0.3, strength: 0.85,
};

const ramp = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * One frame of a car's tyre marks. `drifting` lays a full mark; otherwise
 * the grip load decides. A point that starts a new run of marks is flagged
 * `gap`, so the renderer does not join it to wherever the last run ended.
 *
 * @param car   { x, y, driftTrail, speed } -- `_gripLoad`, `_gripYaw`,
 *              `_markRun` are kept on it
 * @param dt
 * @param yawRate  rad/s the car turned this frame
 * @param topSpeed the car's own top speed (dial units)
 * @param drifting laying a drift mark this frame
 */
export function layTyreMarks(car, dt, yawRate, topSpeed, drifting) {
  const ground = car.speed * P.moveScale;
  const target = ramp(GRIP_MARK.speedFrom, GRIP_MARK.speedFull, car.speed / topSpeed)
    * ramp(GRIP_MARK.latFrom, GRIP_MARK.latFull, ground * Math.abs(yawRate));
  const load = car._gripLoad ?? 0;
  const rate = target > load ? GRIP_MARK.build : GRIP_MARK.release;
  car._gripLoad = load + (target - load) * (1 - Math.exp(-dt * rate));

  let a = 0;
  if (drifting) a = 1;
  else if (car._gripLoad > GRIP_MARK.show) {
    a = GRIP_MARK.strength * (car._gripLoad - GRIP_MARK.show) / (1 - GRIP_MARK.show);
  }
  const trail = car.driftTrail;
  if (a > 0) {
    trail.push({ x: car.x, y: car.y, life: DRIFT_MARK_LIFE, a, gap: !car._markRun });
    if (trail.length > 160) trail.shift();
  }
  car._markRun = a > 0;
}
