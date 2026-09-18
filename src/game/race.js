/**
 * Race progression: lap counting, standings, finish detection, and the
 * car-to-car contact resolution.
 *
 * Progress is tracked as distance travelled along the centreline rather than
 * by crossing a trigger line, so a car cannot skip a lap by cutting a corner
 * or bouncing over the start line sideways.
 */
import { RACE, PHYSICS as P } from '../config.js';

export class Progress {
  /**
   * @param startBack  world units the car starts behind the start/finish
   *                   line (grid position, not the line itself). `total` is
   *                   seeded at -startBack so it reaches exactly 0 the first
   *                   time the car reaches the real line, keeping lap
   *                   boundaries and the finish threshold (length*totalLaps)
   *                   aligned with the painted line instead of the grid.
   */
  constructor(path, startBack = 0) {
    this.path = path;
    this.startBack = startBack;
    this.reset();
  }

  reset() {
    this.lap = 1;
    this.total = -this.startBack; // distance past the start/finish line
    this.lastS = null;
    this.finished = false;
    this.finishTime = null;
  }

  /** Call once per frame with the car's current world position. */
  update(car) {
    const near = this.path.nearest(car.x, car.y);
    const s = near.distance;
    const len = this.path.length;

    if (this.lastS === null) { this.lastS = s; return; }

    let d = s - this.lastS;
    // wrapping past the start line shows up as a large negative jump
    if (d < -len / 2) d += len;
    else if (d > len / 2) d -= len;

    // ignore teleport-sized jumps (respawns) so they cannot bank progress
    if (Math.abs(d) < len * 0.25) this.total += d;
    this.lastS = s;

    const lap = Math.floor(this.total / len) + 1;
    this.lap = Math.max(1, lap);
  }
}

export class Race {
  constructor(path, { totalLaps = RACE.totalLaps, startBack = 0 } = {}) {
    this.path = path;
    this.totalLaps = totalLaps;
    this.startBack = startBack;
    this.state = 'vs';   // vs | countdown | racing | finished
    this.vsTimer = 1.8;
    this.countdown = 3.2;
    this.time = 0;
    this.entries = [];
    // One-shot signal for the HUD: set to the new lap number the instant the
    // player crosses the line into it (never for the final finish crossing,
    // which the finish overlay already announces), cleared once read.
    this.lapAnnounce = null;
  }

  addCar(car, { isPlayer = false, name = '' } = {}) {
    const entry = { car, isPlayer, name, progress: new Progress(this.path, this.startBack) };
    this.entries.push(entry);
    return entry;
  }

  get player() { return this.entries.find((e) => e.isPlayer); }

  /** 1-based position of an entry, by distance covered. */
  positionOf(entry) {
    const sorted = [...this.entries].sort((a, b) => b.progress.total - a.progress.total);
    return sorted.indexOf(entry) + 1;
  }

  update(dt) {
    if (this.state === 'vs') {
      this.vsTimer -= dt;
      if (this.vsTimer <= 0) this.state = 'countdown';
      return;
    }
    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.state = 'racing';
      return;
    }
    if (this.state !== 'racing') return;

    this.time += dt;
    for (const e of this.entries) {
      const prevLap = e.progress.lap;
      e.progress.update(e.car);
      if (e.isPlayer && e.progress.lap > prevLap && e.progress.lap <= this.totalLaps) {
        this.lapAnnounce = e.progress.lap;
      }
      if (!e.progress.finished && e.progress.total >= this.path.length * this.totalLaps) {
        e.progress.finished = true;
        e.progress.finishTime = this.time;
      }
    }
    if (this.player?.progress.finished) this.state = 'finished';
  }
}

/**
 * Three circles down the length of each car approximate its body well enough
 * for arcade contact, and cost far less than a polygon test.
 */
function hullCircles(car, size) {
  const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
  const w = size.w, h = size.h;
  return [
    { x: car.x + fx * h * 0.27, y: car.y + fy * h * 0.27, r: w * 0.285 },
    { x: car.x, y: car.y, r: w * 0.355 },
    { x: car.x - fx * h * 0.27, y: car.y - fy * h * 0.27, r: w * 0.305 },
  ];
}

/**
 * Steer a finished car back onto the racing line and settle it to a cruising
 * pace, so it keeps circulating after the finish instead of freezing mid-track.
 * Bypasses the car's own input-driven `update()` entirely -- this never reads
 * or touches PHYSICS.accel/turn/etc, it only reuses `moveScale` to keep the
 * world-units-per-second convention consistent with normal driving.
 */
export function autoDrivePostRace(car, path, dt, targetSpeed, laneOffset = 0) {
  const near = path.nearest(car.x, car.y);
  const lookAhead = path.offsetPoint(near.index + 10, laneOffset);
  const desired = Math.atan2(lookAhead.y - car.y, lookAhead.x - car.x);
  const diff = Math.atan2(Math.sin(desired - car.angle), Math.cos(desired - car.angle));
  car.angle += diff * Math.min(1, 2.7 * dt);

  car.speed += (targetSpeed - car.speed) * Math.min(1, 2.2 * dt);
  car.speed = Math.max(0, Math.min(targetSpeed + 40, car.speed));

  const move = car.speed * P.moveScale;
  car.x += Math.cos(car.angle) * move * dt;
  car.y += Math.sin(car.angle) * move * dt;

  const after = path.nearest(car.x, car.y);
  const roadHalf = car.roadHalf ?? near.dist;
  if (after.dist > roadHalf - 30) {
    car.x += (after.x - car.x) * Math.min(1, 2.5 * dt);
    car.y += (after.y - car.y) * Math.min(1, 2.5 * dt);
  }
}

/** Push overlapping cars apart; side rubbing is cheap, head-on costs speed. */
export function resolveContacts(cars, sizes, passes = 4) {
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const ah = hullCircles(a, sizes[i]);
        const bh = hullCircles(b, sizes[j]);

        let best = null;
        for (const ac of ah) {
          for (const bc of bh) {
            const dx = bc.x - ac.x, dy = bc.y - ac.y;
            const d = Math.hypot(dx, dy) || 0.0001;
            const overlap = ac.r + bc.r - d;
            if (overlap > 0 && (!best || overlap > best.overlap)) {
              best = { overlap, nx: dx / d, ny: dy / d };
            }
          }
        }
        if (!best) continue;

        // Player has a small contact advantage. "Push power" is expressed
        // as how much of the separation the OTHER car receives: normally
        // player 55 / rival 45, and a boosting player gets a little more.
        const aIsPlayer = a?.constructor?.name === 'PlayerCar';
        const bIsPlayer = b?.constructor?.name === 'PlayerCar';
        const aIsRival = a?.constructor?.name === 'RivalCar';
        const bIsRival = b?.constructor?.name === 'RivalCar';
        if (aIsRival && bIsPlayer) a.contactRecoveryTimer = Math.max(a.contactRecoveryTimer || 0, 0.40);
        if (bIsRival && aIsPlayer) b.contactRecoveryTimer = Math.max(b.contactRecoveryTimer || 0, 0.40);
        let aPower = aIsPlayer ? 0.55 : 0.45;
        let bPower = bIsPlayer ? 0.55 : 0.45;
        if (aIsPlayer && a.boosting) aPower += 0.10;
        if (bIsPlayer && b.boosting) bPower += 0.10;

        const totalPower = Math.max(0.001, aPower + bPower);
        const separate = best.overlap * 1.04;
        const aMove = separate * (bPower / totalPower);
        const bMove = separate * (aPower / totalPower);

        a.x -= best.nx * aMove; a.y -= best.ny * aMove;
        b.x += best.nx * bMove; b.y += best.ny * bMove;

        const ahx = Math.cos(a.angle), ahy = Math.sin(a.angle);
        const bhx = Math.cos(b.angle), bhy = Math.sin(b.angle);
        const headingDot = ahx * bhx + ahy * bhy;

        // Rear-end contact: if one car is travelling toward the other from
        // behind and has the greater speed, transfer part of that closing
        // speed forward instead of making the following car simply "lose".
        // This gives a clear shove while avoiding pinball-style launches.
        if (headingDot > 0.55) {
          const aTowardB = ahx * best.nx + ahy * best.ny;
          const bTowardA = -(bhx * best.nx + bhy * best.ny);

          if (aTowardB > 0.45 && a.speed > b.speed + 12) {
            const closing = Math.min(180, a.speed - b.speed);
            const shove = closing * 0.22 * (aPower / 0.55);
            b.speed += shove;
            b.x += ahx * closing * 0.010;
            b.y += ahy * closing * 0.010;
            a.speed -= closing * 0.035;
          } else if (bTowardA > 0.45 && b.speed > a.speed + 12) {
            const closing = Math.min(180, b.speed - a.speed);
            const shove = closing * 0.22 * (bPower / 0.55);
            a.speed += shove;
            a.x += bhx * closing * 0.010;
            a.y += bhy * closing * 0.010;
            b.speed -= closing * 0.035;
          }
        }

        // Only a genuinely nose-on / crossing hit should scrub notable
        // speed. Parallel side rubbing mainly separates the bodies laterally.
        if (headingDot < 0.35) {
          const aLoss = aIsPlayer ? 0.955 : 0.94;
          const bLoss = bIsPlayer ? 0.955 : 0.94;
          a.speed *= aLoss;
          b.speed *= bLoss;
          if (a.shake !== undefined) a.shake = Math.max(a.shake, 6);
          if (b.shake !== undefined) b.shake = Math.max(b.shake, 6);
        }
      }
    }
  }
}
