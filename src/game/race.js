/**
 * Race progression: lap counting, standings, finish detection, and the
 * car-to-car contact resolution.
 *
 * Progress is tracked as distance travelled along the centreline rather than
 * by crossing a trigger line, so a car cannot skip a lap by cutting a corner
 * or bouncing over the start line sideways.
 */
import { RACE, PHYSICS as P } from '../config.js';
import { setContact } from './contact.js';

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
    this._hint = null;
    this.finished = false;
    this.finishTime = null;
  }

  /** Call once per frame with the car's current world position. */
  update(car) {
    // Progress-local lookup. On a course that crosses over itself, both
    // decks share an XY, so a global search can report the crossing's OTHER
    // pass -- a huge jump in `s`, which the teleport guard below then
    // discards, silently freezing lap progress at the crossing. The car's
    // own rolling hint (PlayerCar/RivalCar keep one) is preferred so that
    // progress and the car's own route agree; anything without one falls
    // back to this Progress's own hint.
    const hint = car._routeHint ?? this._hint;
    const near = this.path.nearestLocal(car.x, car.y, hint, 90, (car.wallHalf ?? 500) * 4);
    this._hint = near.index;
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
export function hullCircles(car, size) {
  // The angle the car is DRAWN at, not the one it is travelling at. A
  // sliding car is drawn yawed off its heading by driftVisualAngle (see
  // main.js, where both sprites take `angle + driftVisualAngle`), and a
  // body this long swings a lot of width out when it does: stage 3's rival
  // reaches 29 degrees of yaw and holds some for two thirds of the lap,
  // which puts its drawn flank up to twice as far out as a hull built on
  // the heading alone reaches. Contact then lands with the two cars
  // visibly overlapping. Turning the hull with the sprite keeps the two
  // in agreement whatever the car is doing.
  const drawn = car.angle + (car.driftVisualAngle ?? 0);
  const fx = Math.cos(drawn), fy = Math.sin(drawn);
  const w = size.w, h = size.h;

  // Where the car actually sits inside its own photo. The sprite is
  // anchored at the middle of its canvas, so a body that is not centred in
  // its frame is DRAWN off the position it collides at -- and the error
  // flips sign between the two flanks, so one side buries and the other
  // leaves daylight. `ox`/`oy` (see CAR_HULL_OFFSET) move the hull onto the
  // drawn body; they are texture-space, so they go through the same axes
  // the sprite's own rotation gives it: +x across the car, +y toward its
  // tail. Absent (a photo whose car is centred) they are 0 and this is the
  // car's own position, exactly as before.
  const ox = size.ox ?? 0, oy = size.oy ?? 0;
  const cx = car.x - ox * fy - oy * fx;
  const cy = car.y + ox * fx - oy * fy;

  // Three circles cover a car, whose body is only about 1.4 times longer
  // than it is wide. They do not cover a truck: at 3.5 times longer the
  // outermost circles reach 0.27h + 0.285w from the centre, which leaves
  // the front and rear of the vehicle with no collision at all -- a car
  // would drive through the nose of it. Anything appreciably longer than
  // it is wide gets a row of circles instead, spaced so they overlap.
  if (h < w * 2) {
    return [
      { x: cx + fx * h * 0.27, y: cy + fy * h * 0.27, r: w * 0.285 },
      { x: cx, y: cy, r: w * 0.355 },
      { x: cx - fx * h * 0.27, y: cy - fy * h * 0.27, r: w * 0.305 },
    ];
  }
  const r = w * 0.35;
  const reach = h / 2 - r;                 // end caps sit exactly at the ends
  const count = Math.max(3, Math.ceil((reach * 2) / (r * 1.25)) + 1);
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;   // -1 .. +1
    out.push({ x: cx + fx * reach * t, y: cy + fy * reach * t, r });
  }
  return out;
}

/**
 * Steer a finished car back onto the racing line and settle it to a cruising
 * pace, so it keeps circulating after the finish instead of freezing mid-track.
 * Bypasses the car's own input-driven `update()` entirely -- this never reads
 * or touches PHYSICS.accel/turn/etc, it only reuses `moveScale` to keep the
 * world-units-per-second convention consistent with normal driving.
 */
export function autoDrivePostRace(car, path, dt, targetSpeed, laneOffset = 0) {
  // Route lookups here follow the car's own rolling hint for the same
  // reason the live driving code does -- a crossing would otherwise hand
  // this the other deck and drive the car off across the course.
  const near = path.nearestLocal(car.x, car.y, car._routeHint, 90, (car.wallHalf ?? 500) * 4);
  car._routeHint = near.index;
  const lookAhead = path.offsetPoint(near.index + 10, laneOffset);
  const desired = Math.atan2(lookAhead.y - car.y, lookAhead.x - car.x);
  const diff = Math.atan2(Math.sin(desired - car.angle), Math.cos(desired - car.angle));
  car.angle += diff * Math.min(1, 2.7 * dt);

  car.speed += (targetSpeed - car.speed) * Math.min(1, 2.2 * dt);
  car.speed = Math.max(0, Math.min(targetSpeed + 40, car.speed));

  const move = car.speed * P.moveScale;
  car.x += Math.cos(car.angle) * move * dt;
  car.y += Math.sin(car.angle) * move * dt;

  const after = path.nearestLocal(car.x, car.y, car._routeHint, 90, (car.wallHalf ?? 500) * 4);
  car._routeHint = after.index;
  const roadHalf = car.roadHalf ?? near.dist;
  if (after.dist > roadHalf - 30) {
    car.x += (after.x - car.x) * Math.min(1, 2.5 * dt);
    car.y += (after.y - car.y) * Math.min(1, 2.5 * dt);
  }
}

/** Push overlapping cars apart; side rubbing is cheap, head-on costs speed. */
export function resolveContacts(cars, sizes, dt = 1 / 60, passes = 4) {
  // Per-car "was this one touched during this call" flag, for the impact
  // rising edge below -- a car-car hit needs the same fresh-vs-continuing
  // split as the wall does (see player.js's wallImpact/wallGraceWindow):
  // the separation this loop applies pulls two overlapping cars just
  // clear of each other every pass, so a player still steering into the
  // rival leaves raw contact for a moment before the next overlap, and
  // without a grace window each re-touch would fire as a brand new impact.
  const touched = new Array(cars.length).fill(false);
  const contactAt = new Array(cars.length).fill(null);

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
              // The touch point sits on the line between the two circle
              // centres, ac.r along it -- that is where the panels are
              // actually rubbing, and where the sparks belong.
              best = {
                overlap,
                nx: dx / d,
                ny: dy / d,
                x: ac.x + (dx / d) * ac.r,
                y: ac.y + (dy / d) * ac.r,
              };
            }
          }
        }
        if (!best) continue;
        touched[i] = true;
        touched[j] = true;
        contactAt[i] = best;
        contactAt[j] = best;

        // Player has a small contact advantage. "Push power" is expressed
        // as how much of the separation the OTHER car receives: normally
        // player 55 / rival 45, and a boosting player gets a little more.
        const aIsPlayer = a?.constructor?.name === 'PlayerCar';
        const bIsPlayer = b?.constructor?.name === 'PlayerCar';
        const aIsRival = a?.constructor?.name === 'RivalCar';
        const bIsRival = b?.constructor?.name === 'RivalCar';
        if (aIsRival && bIsPlayer) a.contactRecoveryTimer = Math.max(a.contactRecoveryTimer || 0, 0.40);
        if (bIsRival && aIsPlayer) b.contactRecoveryTimer = Math.max(b.contactRecoveryTimer || 0, 0.40);
        // `contactMass` scales that push power, so a heavy vehicle both
        // takes less of the separation and gives up less speed. A car
        // leaves it at 1 and behaves exactly as before; stage 4's box
        // truck sets 9, which is what makes it not get shoved aside.
        const am = Math.max(0.2, a.contactMass ?? 1);
        const bm = Math.max(0.2, b.contactMass ?? 1);
        let aPower = (aIsPlayer ? 0.55 : 0.45) * am;
        let bPower = (bIsPlayer ? 0.55 : 0.45) * bm;
        if (aIsPlayer && a.boosting) aPower += 0.10 * am;
        if (bIsPlayer && b.boosting) bPower += 0.10 * bm;
        // how much harder a hit lands on each of them, capped so a very
        // heavy rival still cannot delete the player's whole lap in one
        const aHit = Math.min(3, bm / am);
        const bHit = Math.min(3, am / bm);

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
            // the shove a rear-ending car delivers is shared out by mass:
            // running into a truck pushes the truck barely at all and
            // costs the car most of the closing speed
            const shove = closing * 0.22 * (aPower / 0.55) * bHit;
            b.speed += shove;
            b.x += ahx * closing * 0.010 * bHit;
            b.y += ahy * closing * 0.010 * bHit;
            a.speed -= closing * 0.035 * aHit;
          } else if (bTowardA > 0.45 && b.speed > a.speed + 12) {
            const closing = Math.min(180, b.speed - a.speed);
            const shove = closing * 0.22 * (bPower / 0.55) * aHit;
            a.speed += shove;
            a.x += bhx * closing * 0.010 * aHit;
            a.y += bhy * closing * 0.010 * aHit;
            b.speed -= closing * 0.035 * bHit;
          }
        }

        // Only a genuinely nose-on / crossing hit should scrub notable
        // speed. Parallel side rubbing mainly separates the bodies laterally.
        if (headingDot < 0.35) {
          const aLoss = aIsPlayer ? 0.955 : 0.94;
          const bLoss = bIsPlayer ? 0.955 : 0.94;
          a.speed *= 1 - (1 - aLoss) * aHit;
          b.speed *= 1 - (1 - bLoss) * bHit;
          if (a.shake !== undefined) a.shake = Math.max(a.shake, 6 * aHit);
          if (b.shake !== undefined) b.shake = Math.max(b.shake, 6 * bHit);
        }
      }
    }
  }

  // Same impact/graze split as the wall: a touch within P.wallGraceWindow
  // of this car's last one is the SAME ongoing contact (car.carImpact
  // stays false), not a fresh one.
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    if (!car) continue;
    car._carContactCooldown = Math.max(0, (car._carContactCooldown ?? 0) - dt);
    if (!touched[i]) continue;
    const impact = car._carContactCooldown <= 0;
    car._carContactCooldown = P.wallGraceWindow;
    const hit = contactAt[i];
    // `best.nx/ny` runs from the pair's lower index to its higher one, so
    // it already points from this car into what it hit for the first of
    // them and has to be flipped for the second -- contact.js expects it
    // that way round. (With more than two cars this keeps only the last
    // pair a car was in; there are two, so there is one pair.)
    const flip = i === 0 ? 1 : -1;
    setContact(car.contact, {
      impact,
      x: hit.x,
      y: hit.y,
      nx: hit.nx * flip,
      ny: hit.ny * flip,
      force: Math.min(1, Math.abs(car.speed ?? 0) / P.maxSpeed),
    });
  }
}
