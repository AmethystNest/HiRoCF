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
    // Set once, when the player's race is over (see resultFor).
    this.result = null;
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
    if (this.player?.progress.finished) {
      this.state = 'finished';
      this.result = this.resultFor(this.player);
    }
  }

  /**
   * The finished entry's result against the field, frozen at the moment it
   * crosses the line: `won`, and `gap` -- seconds to the nearest car on the
   * other side of it. A car that finished first is timed exactly; one still
   * on the road is timed by the distance it has left at its own average
   * pace over the race, which is what "won by 2.1 s" means to a player
   * watching the rival come round the last corner.
   */
  resultFor(entry) {
    const others = this.entries.filter((e) => e !== entry);
    const won = others.every((o) => !o.progress.finished);
    const t = entry.progress.finishTime ?? this.time;
    let gap = Infinity;
    for (const o of others) {
      let g;
      if (o.progress.finished) g = t - o.progress.finishTime;
      else {
        const covered = o.progress.total + this.startBack;
        const pace = this.time > 0 ? covered / this.time : 0;
        g = pace > 0 ? (entry.progress.total - o.progress.total) / pace : Infinity;
      }
      gap = Math.min(gap, g);
    }
    return { won, time: t, gap: Number.isFinite(gap) ? gap : null };
  }
}

/** Where a body is tested against the barrier: four corners and the middle
 *  of each flank, as (along the car, across it) in half-extents. */
const BODY_POINTS = [[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 1], [0, -1]];

/**
 * How far the DRAWN body of `car` reaches past the barrier the course shows
 * (positive = through it, negative = clear by that much). Tested at the body
 * itself -- corners and flanks, at the angle the sprite is drawn at, each
 * against its own nearest centreline point and the barrier there -- rather
 * than estimated from the car's centre, because every centre-based estimate
 * tried was wrong somewhere: half-width misses a nose swung out at an angle,
 * and a skew term off the centre's tangent treats a curving wall as straight.
 *
 * `body` is { hw, hl, ox, oy }: half-width, half-length, and the body's
 * offset from the sprite's anchor, in texture axes (+x across, +y toward the
 * tail), all in world units -- see main.js's drawnBody().
 */
export function bodyPastBarrier(car, path, barrierAt, body, hint, maxDist) {
  const ang = car.angle + (car.driftVisualAngle ?? 0);
  const s = Math.sin(ang), c = Math.cos(ang);
  const hit = { over: -Infinity, x: car.x, y: car.y, nx: 0, ny: 0 };
  for (const [a, b] of BODY_POINTS) {
    const tx = body.ox + body.hw * b;
    const ty = body.oy + body.hl * a;
    const wx = car.x - tx * s - ty * c;
    const wy = car.y + tx * c - ty * s;
    const n = path.nearestLocal(wx, wy, hint, 40, maxDist);
    // Which side of the centreline this point of the body is on: a stage
    // may draw the inside of a tight bend closer in than the outside (see
    // main.js's barrierSide), and the wall has to be where it is drawn.
    const lat = (wx - n.x) * path.normals[n.index * 2] + (wy - n.y) * path.normals[n.index * 2 + 1];
    const wall = barrierAt(n.index, lat >= 0 ? 1 : -1);
    const over = n.dist - wall;
    if (over > hit.over) {
      // The contact itself: the point on the barrier level with the part of
      // the body that reached it, and the outward direction there. Sparks
      // go HERE -- on a 560-unit truck the point beside its middle can be
      // a lorry-length away from the corner actually touching.
      const d = n.dist || 1;
      const nx = (wx - n.x) / d, ny = (wy - n.y) / d;
      hit.over = over;
      hit.nx = nx;
      hit.ny = ny;
      hit.x = n.x + nx * wall;
      hit.y = n.y + ny * wall;
    }
  }
  return hit;
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
  // 10 route points at the pace this was tuned for, scaled like every
  // other distance-standing-for-time (see PHYSICS.paceScale): at today's
  // pace an unscaled 10 left the car steering at a point it reached in a
  // fraction of a second, and it ran wide of its lane onto the verge on
  // every post-race corner.
  const lookAhead = path.offsetPoint(near.index + Math.round(10 * P.paceScale), laneOffset);
  const desired = Math.atan2(lookAhead.y - car.y, lookAhead.x - car.x);
  const diff = Math.atan2(Math.sin(desired - car.angle), Math.cos(desired - car.angle));
  car.angle += diff * Math.min(1, 2.7 * dt);

  // The cruise speeds main.js passes were tuned as GROUND speed at the
  // original pace, so they come down by paceScale to stay the same ground
  // speed now: carried over unscaled, the MOVE_SCALE step made the post-
  // race lap 59% faster than it was ever set up for, and on stages 2, 3
  // and 5 the car ran wide of its lane onto the verge on every tight corner
  // -- something the old roadHalf pull below used to hide by yanking it
  // back, which is exactly what read as hitting a wall at the road edge.
  const cruise = targetSpeed / P.paceScale;
  car.speed += (cruise - car.speed) * Math.min(1, 2.2 * dt);
  car.speed = Math.max(0, Math.min(cruise + 40, car.speed));

  const move = car.speed * P.moveScale;
  car.x += Math.cos(car.angle) * move * dt;
  car.y += Math.sin(car.angle) * move * dt;

  const after = path.nearestLocal(car.x, car.y, car._routeHint, 90, (car.wallHalf ?? 500) * 4);
  car._routeHint = after.index;
  // Held off the barrier the course actually shows there (see main.js's
  // `barrier`), not the pavement edge: pulling back at roadHalf - 30 put an
  // invisible wall 30 units INSIDE the road, which after the finish read as
  // the car bouncing off nothing at the edge of the tarmac. 60 is about a
  // car's half-width, so the body, not the middle, is what stops short.
  const wall = car.barrier ? car.barrier[after.index] : (car.wallHalf ?? car.roadHalf ?? near.dist);
  if (after.dist > wall - 60) {
    car.x += (after.x - car.x) * Math.min(1, 2.5 * dt);
    car.y += (after.y - car.y) * Math.min(1, 2.5 * dt);
  }
}

/** Share of the way to a shared speed a rear-end takes both cars. */
const SHUNT_SHARE = 0.4;

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

  const shunted = new Set();
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
        // A rear-end shove may carry a car past its own top speed -- that
        // is what being rear-ended does -- but not without limit. For
        // stage 4's truck (contactMass 9 against the player's 1) `aPower`
        // and `bHit` together are worth up to 875 of speed in ONE contact,
        // and above maxSpeed there is nothing pulling the car back down
        // but `coast` at 28/s, so repeated hits ratcheted the player to
        // 1336 internal on a measured stage 4 run -- 76% over its own top
        // speed, and with the pace step above that reads 615 on a dial
        // that goes to 350. 1.18 is the same over-speed ceiling the
        // rivals' own boost uses, so a hit is still clearly felt.
        const overSpeedCap = (car) => (car.maxSpeed ?? P.maxSpeed) * 1.18;
        // ...and never past the car doing the pushing: a shove can bring a
        // car up to the speed of what hit it, not beyond. Stage 4's truck,
        // rear-ending the player at 700, sent it off at 770-900 -- faster
        // than the truck and past its own top speed -- because the shove
        // scales with the truck's mass and repeats every frame they touch.
        const pushedCap = (car, by) => Math.max(car.speed, by.speed);
        if (headingDot > 0.55) {
          const aTowardB = ahx * best.nx + ahy * best.ny;
          const bTowardA = -(bhx * best.nx + bhy * best.ny);

          // A rear-end is a momentum exchange, once per contact however many
          // separation passes or frames it lasts: both cars go SHUNT_SHARE of
          // the way to the speed they would share if they stuck together,
          // weighted by mass (the rest is what the crumpling absorbs). Was a
          // shove scaled by the pusher's mass and re-applied on every pass
          // and every frame of contact, which let stage 4's truck drag the
          // player up to its own speed and past it in a fraction of a second.
          const shunt = (pusher, pushed, pm, qm, hx, hy, hitOnPushed) => {
            const key = i * 64 + j;
            if (shunted.has(key)) return;
            shunted.add(key);
            // the first frame of a contact only: held together, the pair are
            // one pushing on the other, which separation already deals with
            if ((pusher._carContactCooldown ?? 0) > 0 || (pushed._carContactCooldown ?? 0) > 0) return;
            const closing = Math.min(180, pusher.speed - pushed.speed);
            const vc = (pm * pusher.speed + qm * pushed.speed) / (pm + qm);
            pushed.speed = Math.min(pushed.speed + (vc - pushed.speed) * SHUNT_SHARE, pushedCap(pushed, pusher), overSpeedCap(pushed));
            pusher.speed += (vc - pusher.speed) * SHUNT_SHARE;
            pushed.x += hx * closing * 0.010 * hitOnPushed;
            pushed.y += hy * closing * 0.010 * hitOnPushed;
          };
          if (aTowardB > 0.45 && a.speed > b.speed + 12) shunt(a, b, am, bm, ahx, ahy, bHit);
          else if (bTowardA > 0.45 && b.speed > a.speed + 12) shunt(b, a, bm, am, bhx, bhy, aHit);
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
    if (impact) car.carImpact = true;
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
