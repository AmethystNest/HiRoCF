/**
 * Background traffic on stage 4's expressway: ordinary cars cruising at
 * about 100 km/h on the dial, spread over the three lanes.
 *
 * They are there to be in the player's way. The rival -- a loaded box
 * truck -- does not go round them: it runs straight through and sends
 * them flying. The player hitting one is a real hit: a rear-end at speed
 * costs most of the closing speed, and the car it hit is shoved on ahead
 * of it, spinning.
 *
 * A car is in one of three modes.
 *  - 'road': on rails, a distance along the course and a lateral offset,
 *    at its own cruising speed. It holds back behind anything slower in
 *    front of it in its lane -- another car, a wreck, either racer -- and
 *    every so often moves over a lane (at once, if it is stuck behind
 *    something), when the lane it wants is clear round it. The lateral
 *    offset is eased across, and the car is turned into the move, so a
 *    lane change reads as one.
 *  - 'loose': just hit. A body with its own velocity and spin, sliding and
 *    bouncing off the walls, until it has stopped spinning and come down.
 *  - 'recover': the driver takes it back. Turned toward a point in the
 *    nearest lane a way up the road, it pulls away and merges back in, and
 *    once it is straight and in its lane it is put back on the rails.
 * A car well behind the player, or stuck out of sight, is taken away and
 * put back into the traffic somewhere ahead, beyond the edge of the
 * screen, as a new car (model and colour drawn again), so the density
 * round the player holds.
 *
 * Pure logic: main.js draws them (see Game#loadStage) and hands this the
 * player, the rival and their hull sizes each frame.
 */
import { PHYSICS as P } from '../config.js';
import { hullCircles } from './race.js';
import { makeContact, setContact } from './contact.js';

/** Cruising speed band, in the dial's km/h. */
const KMH_MIN = 95, KMH_MAX = 105;
/** Lane centres as a share of the road half-width (three lanes: the
 *  separators are painted at +/-1/3, see surfaces.js highwayLanes). */
const LANES = [-2 / 3, 0, 2 / 3];
/** How far ahead of the player (world units) a car is put back in, and
 *  how far behind one has to fall before it is taken out. */
const SPAWN_AHEAD = [4200, 9000];
const DESPAWN_BEHIND = 2600;
/** Nearest a car may be put in behind or ahead of another in its lane. */
const SPAWN_GAP = 900;
/** Following distance: inside this a car matches the one ahead. */
const FOLLOW_GAP = 520;
/** Seconds between a car's lane changes, and how long one takes. */
const CHANGE_EVERY = [6, 14];
const CHANGE_TIME = [2.0, 2.8];
/** Road clear of anything in the lane moved into: this far ahead, and
 *  this far behind plus a second of whatever is coming up on it faster. */
const CLEAR_AHEAD = 700, CLEAR_BEHIND = 450;
/** Recovering: how hard the driver steers (rad/s at speed) and
 *  accelerates / brakes (dial units per second). */
const RECOVER_TURN = 2.4;
const RECOVER_ACCEL = 150, RECOVER_BRAKE = 400;

/** A rival running into a car, unless its tuning says otherwise
 *  (`trafficHit`): the car's velocity forward with the rival and out to the
 *  side (shares of the rival's), spin (rad/s), lift (base + share of the
 *  rival's speed), and the share of its speed the rival keeps. */
const RIVAL_HIT = { forward: 1.15, out: [0.55, 0.9], spin: [5, 10], lift: [260, 0.12], keep: 0.97 };

const toSpeed = (kmh) => kmh / P.hudSpeedFactor;
const smooth = (t) => t * t * (3 - 2 * t);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Traffic {
  /**
   * @param path      TrackPath
   * @param opts.count cars
   * @param opts.roadHalf the road's half-width (lane positions)
   * @param opts.kinds { name: { hull: {w, h}, halfW, weight } }: the car
   *        models, each with its collision hull, its drawn half-width (for
   *        the walls) and how common it is
   * @param opts.paints colours, one drawn at random per car (only handed
   *        back to the renderer)
   * @param opts.barrier per-index wall half-width (main.js), which a car
   *        knocked loose bounces off instead of flying through
   * @param opts.rng   () => [0, 1), for repeatable tests
   */
  constructor(path, { count = 5, roadHalf, kinds, paints = [0xffffff], barrier = null, rng = Math.random }) {
    this.path = path;
    this.barrier = barrier;
    this.roadHalf = roadHalf;
    this.kinds = kinds;
    this.kindNames = Object.keys(kinds);
    this.paints = paints;
    this.rng = rng;
    this.cars = [];
    for (let i = 0; i < count; i++) {
      this.cars.push({
        id: i, mode: 'road', loose: false, d: 0, lane: 0, lat: 0, cruise: 0, speed: 0,
        latFrom: 0, latTo: 0, latT: 1, latDur: 1, nextChange: 0,
        kind: this.kindNames[0], paint: paints[0], hull: null, halfW: 0,
        x: 0, y: 0, angle: 0, vx: 0, vy: 0, spin: 0, lift: 0, liftV: 0, still: 0, modeT: 0,
        contact: makeContact(), _routeHint: 0, deckId: 0, zLevel: 0,
      });
    }
  }

  /** Lay the cars out ahead of the grid: `from` is the player's distance. */
  reset(from) {
    for (const c of this.cars) this.respawn(c, from, true);
  }

  laneOffset(lane) { return LANES[lane] * this.roadHalf; }

  /** Lane width in world units. */
  get laneWidth() { return this.roadHalf * (2 / 3); }

  /** The lane whose centre is nearest a lateral offset. */
  laneAt(lat) {
    let best = 0;
    for (let i = 1; i < LANES.length; i++) {
      if (Math.abs(this.laneOffset(i) - lat) < Math.abs(this.laneOffset(best) - lat)) best = i;
    }
    return best;
  }

  pickKind() {
    let total = 0;
    for (const k of this.kindNames) total += this.kinds[k].weight ?? 1;
    let r = this.rng() * total;
    for (const k of this.kindNames) {
      r -= this.kinds[k].weight ?? 1;
      if (r < 0) return k;
    }
    return this.kindNames[0];
  }

  /** Put `c` back on the road somewhere ahead of distance `from`, as a
   *  new car. */
  respawn(c, from, initial = false) {
    const L = this.path.length;
    for (let tries = 0; tries < 20; tries++) {
      const ahead = initial
        ? 2600 + this.rng() * 16000
        : SPAWN_AHEAD[0] + this.rng() * (SPAWN_AHEAD[1] - SPAWN_AHEAD[0]);
      const d = (((from + ahead) % L) + L) % L;
      const lane = Math.floor(this.rng() * LANES.length);
      const lat = this.laneOffset(lane);
      const clear = this.cars.every((o) => o === c || Math.abs(o.lat - lat) > this.laneWidth * 0.75
        || Math.abs(this.gap(d, o.d)) > SPAWN_GAP);
      if (!clear && tries < 19) continue;
      const kind = this.pickKind();
      Object.assign(c, {
        mode: 'road', loose: false, d, lane, lat, latFrom: lat, latTo: lat, latT: 1, latDur: 1,
        nextChange: 3 + this.rng() * 10,
        cruise: toSpeed(KMH_MIN + this.rng() * (KMH_MAX - KMH_MIN)),
        kind, hull: this.kinds[kind].hull, halfW: this.kinds[kind].halfW,
        paint: this.paints[Math.floor(this.rng() * this.paints.length)],
        vx: 0, vy: 0, spin: 0, lift: 0, liftV: 0, still: 0, modeT: 0,
      });
      c.speed = c.cruise;
      this.place(c, 0);
      return;
    }
  }

  /** Signed distance from `a` forward to `b` round the lap. */
  gap(a, b) {
    const L = this.path.length;
    let g = (b - a) % L;
    if (g > L / 2) g -= L;
    if (g < -L / 2) g += L;
    return g;
  }

  /** Position a car on the rails. `latV` (world units/s) is how fast it is
   *  moving across: the car is drawn turned into the move. */
  place(c, latV) {
    const s = this.path.sample(c.d);
    const k = s.index;
    const nx = this.path.normals[k * 2], ny = this.path.normals[k * 2 + 1];
    c.x = s.x + nx * c.lat;
    c.y = s.y + ny * c.lat;
    const v = c.speed * P.moveScale;
    c.angle = latV ? Math.atan2(Math.sin(s.angle) * v + ny * latV, Math.cos(s.angle) * v + nx * latV) : s.angle;
    c._routeHint = k;
  }

  /** Knock `c` loose with a velocity (world units/s) and spin (rad/s). */
  launch(c, vx, vy, spin, lift = 0) {
    c.mode = 'loose';
    c.loose = true;
    c.modeT = 0;
    c.vx = vx; c.vy = vy; c.spin = spin;
    c.liftV = Math.max(c.liftV, lift);
    c.still = 0;
  }

  /** Start easing `c` over to lateral offset `to`. */
  steerTo(c, to, dur) {
    c.latFrom = c.lat; c.latTo = to; c.latT = 0; c.latDur = dur;
    c.lane = this.laneAt(to);
  }

  /**
   * Everything that can be in a car's way, as { ref, d, lat, v }: its
   * distance and lateral offset on the course and its forward speed (dial
   * units). The racers are located on the course once per frame.
   */
  obstacles(racers) {
    const out = [];
    for (const c of this.cars) {
      const v = c.mode === 'road' ? c.speed
        : Math.max(0, (c.vx * Math.cos(this.path.tangents[c._routeHint]) + c.vy * Math.sin(this.path.tangents[c._routeHint])) / P.moveScale);
      out.push({ ref: c, d: c.d, lat: c.lat, v });
    }
    for (const r of racers) {
      if (!r) continue;
      const near = this.path.nearestLocal(r.x, r.y, r._routeHint, 60);
      const k = near.index;
      const lat = (r.x - near.x) * this.path.normals[k * 2] + (r.y - near.y) * this.path.normals[k * 2 + 1];
      out.push({ ref: r, d: near.distance, lat, v: Math.max(0, (r.speed ?? 0) * Math.cos((r.angle ?? 0) - this.path.tangents[k])) });
    }
    return out;
  }

  /** Slowest speed `c` may hold at (d, lat) without running into whatever
   *  is ahead of it there. */
  limit(c, d, lat, obs, target) {
    const w = this.laneWidth * 0.75;
    for (const o of obs) {
      if (o.ref === c || Math.abs(o.lat - lat) > w) continue;
      const g = this.gap(d, o.d);
      if (g > 0 && g < FOLLOW_GAP) target = Math.min(target, o.v * (g / FOLLOW_GAP));
    }
    return target;
  }

  /** Is the lane at `lat` clear round distance `d` for `c` to move into? */
  clearFor(c, d, lat, obs) {
    const w = this.laneWidth * 0.75;
    for (const o of obs) {
      if (o.ref === c || Math.abs(o.lat - lat) > w) continue;
      const g = this.gap(d, o.d);
      const behind = CLEAR_BEHIND + Math.max(0, o.v - c.speed) * P.moveScale;
      if (g < CLEAR_AHEAD && g > -behind) return false;
    }
    return true;
  }

  /**
   * @param dt
   * @param player PlayerCar, with `progressDistance` (distance along the
   *        lap) set by the caller
   * @param rival  RivalCar
   * @param hulls  { player, rival } hull sizes (world units)
   * @param view   world-unit radius the camera can see round the player
   * @param sameDeck (a, b) => bool: can these two touch (see main.js)
   * @returns events: [{ type: 'player' | 'rival', car, force }]
   */
  update(dt, { player, rival, hulls, view, sameDeck = () => true, collide = true }) {
    const events = [];
    const ms = P.moveScale;
    const pd = player.progressDistance ?? 0;
    const obs = this.obstacles([player, rival]);

    // --- on the road: cruise, keep station, now and then change lanes
    for (const c of this.cars) {
      if (c.mode !== 'road') continue;
      const target = this.limit(c, c.d, c.lat, obs, c.cruise);
      const blocked = target < c.cruise * 0.8;
      c.nextChange -= dt * (blocked ? 5 : 1);
      if (c.nextChange <= 0 && c.latT >= 1) {
        c.nextChange = CHANGE_EVERY[0] + this.rng() * (CHANGE_EVERY[1] - CHANGE_EVERY[0]);
        const lane = this.laneAt(c.lat);
        const options = [lane - 1, lane + 1].filter((l) => l >= 0 && l < LANES.length
          && this.clearFor(c, c.d, this.laneOffset(l), obs));
        if (options.length) {
          const to = options[Math.floor(this.rng() * options.length)];
          this.steerTo(c, this.laneOffset(to), CHANGE_TIME[0] + this.rng() * (CHANGE_TIME[1] - CHANGE_TIME[0]));
        }
      }
      c.speed += (target - c.speed) * Math.min(1, dt * 2.5);
      c.d = (c.d + c.speed * ms * dt) % this.path.length;
      let latV = 0;
      if (c.latT < 1) {
        const before = c.lat;
        // slower across when slower along: a car crawling behind a hold-up
        // eases over rather than turning sideways
        c.latT = Math.min(1, c.latT + (dt / c.latDur) * Math.min(1, Math.max(0.3, c.speed / c.cruise)));
        c.lat = c.latFrom + (c.latTo - c.latFrom) * smooth(c.latT);
        latV = (c.lat - before) / dt;
      }
      this.place(c, latV);
    }

    // --- loose (slide, spin, settle) and recovering (drive back in)
    for (const c of this.cars) {
      if (c.mode === 'road') continue;
      c.modeT += dt;
      const near = this.path.nearestLocal(c.x, c.y, c._routeHint, 60);
      c._routeHint = near.index;
      const k = near.index, nx = this.path.normals[k * 2], ny = this.path.normals[k * 2 + 1];
      c.d = near.distance;
      c.lat = (c.x - near.x) * nx + (c.y - near.y) * ny;

      if (c.mode === 'loose') {
        c.angle += c.spin * dt;
        const f = Math.exp(-dt * 1.6);
        c.vx *= f; c.vy *= f; c.spin *= Math.exp(-dt * 1.9);
        c.liftV -= 900 * dt; c.lift = Math.max(0, c.lift + c.liftV * dt);
        if (c.lift === 0) c.liftV = Math.max(0, c.liftV);
        // down and no longer spinning: the driver has it again
        if (c.lift === 0 && Math.abs(c.spin) < 1.6 && c.modeT > 0.6) {
          c.mode = 'recover';
          c.modeT = 0;
          c.spin = 0;
          c.lane = this.laneAt(c.lat);
          c.speed = Math.max(0, (c.vx * Math.cos(c.angle) + c.vy * Math.sin(c.angle)) / ms);
        }
      } else {
        this.recover(c, dt, near, obs);
        if (c.mode === 'road') continue;
      }
      c.x += c.vx * dt; c.y += c.vy * dt;
      // the concrete wall: pushed back inside it, and the part of its
      // velocity that was going into the wall mostly lost
      if (this.barrier) {
        const lat = (c.x - near.x) * nx + (c.y - near.y) * ny;
        const lim = this.barrier[k] - c.halfW;
        if (Math.abs(lat) > lim) {
          const sgn = Math.sign(lat), back = Math.abs(lat) - lim;
          c.x -= nx * sgn * back; c.y -= ny * sgn * back;
          const vn = (c.vx * nx + c.vy * ny) * sgn;
          if (vn > 0) { c.vx -= nx * sgn * vn * 1.35; c.vy -= ny * sgn * vn * 1.35; c.spin *= 0.7; }
        }
      }
      const moving = Math.hypot(c.vx, c.vy) / ms;
      if (c.mode === 'loose') c.speed = moving;
      c.still = moving < 20 ? c.still + dt : 0;
    }

    // --- contacts
    if (collide) {
      for (const c of this.cars) {
        if (sameDeck(player, c)) this.hitPlayer(c, player, hulls.player, events);
        if (rival && sameDeck(rival, c)) this.hitRival(c, rival, hulls.rival, events);
      }
    }

    // --- recycle: fallen behind, or stuck out of sight
    for (const c of this.cars) {
      const g = this.gap(pd, c.d);
      const seen = Math.hypot(c.x - player.x, c.y - player.y) < view;
      const stuck = (c.mode === 'loose' && c.still > 1.2) || (c.mode === 'recover' && c.modeT > 12);
      if ((g < -DESPAWN_BEHIND && !seen) || (stuck && !seen) || (c.mode !== 'road' && g < -DESPAWN_BEHIND * 2)) {
        this.respawn(c, pd);
      }
    }
    return events;
  }

  /**
   * One step of a recovering car: steered at a point in its lane up the
   * road, speed brought up to its cruise (held down while it is still
   * pointing the wrong way, and behind anything in front of it), its
   * velocity pulled round onto its heading by the tyres. Straight and in
   * its lane, it goes back on the rails.
   */
  recover(c, dt, near, obs) {
    const ms = P.moveScale;
    const laneLat = this.laneOffset(c.lane);
    const fw = c.speed * ms;
    const aim = this.path.sample(near.distance + 220 + fw * 0.3);
    const ak = aim.index;
    const tx = aim.x + this.path.normals[ak * 2] * laneLat;
    const ty = aim.y + this.path.normals[ak * 2 + 1] * laneLat;
    // aimed from where it is about to be: the tyres bring its velocity
    // round onto its heading with a lag, and steering from where it is now
    // swings it past the lane
    const err = wrapAngle(Math.atan2(ty - (c.y + c.vy * 0.3), tx - (c.x + c.vx * 0.3)) - c.angle);
    // a car can only turn as fast as it is rolling; at a crawl it still
    // gets round, just slowly
    const rate = RECOVER_TURN * Math.min(1, 0.3 + fw / 400);
    c.angle += Math.max(-rate * dt, Math.min(rate * dt, err));
    let target = Math.abs(err) > 1 ? c.cruise * 0.25 : c.cruise * (1 - 0.5 * Math.abs(err));
    target = this.limit(c, c.d, c.lat, obs, target);
    c.speed += Math.max(-RECOVER_BRAKE * dt, Math.min(RECOVER_ACCEL * dt, target - c.speed));
    c.speed = Math.max(0, c.speed);
    const grip = 1 - Math.exp(-dt * 4);
    c.vx += (Math.cos(c.angle) * c.speed * ms - c.vx) * grip;
    c.vy += (Math.sin(c.angle) * c.speed * ms - c.vy) * grip;
    // near its lane and pointing down it: on the rails again, easing out
    // whatever is left of the lateral error (steering at a point ahead
    // cuts a bend's inside, so on a curve it settles a little off-centre
    // rather than on it)
    const along = wrapAngle(c.angle - this.path.tangents[near.index]);
    const slip = Math.hypot(c.vx, c.vy) - c.speed * ms;
    if (Math.abs(c.lat - laneLat) < this.laneWidth * 0.3 && Math.abs(along) < 0.15 && Math.abs(slip) < 60 && c.speed > c.cruise * 0.5) {
      c.mode = 'road';
      c.loose = false;
      c.modeT = 0;
      c.vx = 0; c.vy = 0;
      c.nextChange = Math.max(c.nextChange, 4);
      this.steerTo(c, laneLat, 1 + Math.abs(c.lat - laneLat) / 40);
      this.place(c, 0);
    }
  }

  /**
   * A way through the traffic for a car the game drives itself (the
   * player, after the finish): which lateral offset to make for, and how
   * fast it may go. `want` is kept while the road ahead of it is clear;
   * otherwise the nearest lane that is clear ahead -- and clear alongside
   * in every lane crossed to reach it -- is taken; boxed in, it stays and
   * is slowed to whatever is in front of it.
   *
   * @param car   { x, y, speed, _routeHint }
   * @param want  lateral offset it is holding now
   * @param halfW its half-width, world units
   * @param others more things to keep clear of (the rival), each
   *        { x, y, speed, angle, _routeHint, halfW }
   * @returns { lat, speed }: speed in dial units, Infinity if unlimited
   */
  planPass(car, want, halfW, others = []) {
    const ms = P.moveScale;
    const near = this.path.nearestLocal(car.x, car.y, car._routeHint, 60);
    const k = near.index;
    const d = near.distance;
    const lat = (car.x - near.x) * this.path.normals[k * 2] + (car.y - near.y) * this.path.normals[k * 2 + 1];
    const obs = this.obstacles(others);
    // nearest thing in the way at offset L, from just behind to `ahead`
    const block = (L, ahead) => {
      let g = Infinity, v = 0;
      for (const o of obs) {
        if (Math.abs(o.lat - L) > (o.ref.halfW ?? 60) + halfW + 30) continue;
        const og = this.gap(d, o.d);
        if (og > -200 && og < ahead && og < g) { g = og; v = o.v; }
      }
      return { g, v };
    };
    // slowed to follow whatever is in front of it, `g` ahead going `v`:
    // closing on it from well back, matching it at 220, and stopped short
    // of it inside 150 (about the two bodies' half-lengths and a gap)
    const follow = ({ g, v }) => {
      if (g === Infinity) return Infinity;
      if (g > 220) return v + (g - 220) / (ms * 1.2);
      return v * Math.max(0, (g - 150) / 70);
    };
    const reach = 250 + car.speed * ms * 1.8;
    // Whatever is ahead where the car IS, not only where it is going: part
    // way across into another lane it can still run up the back of a car
    // in the lane it is leaving or crossing.
    const now = follow(block(lat, reach));
    const here = block(want, reach);
    if (here.g === Infinity) return { lat: want, speed: now };
    const lanes = LANES.map((_, i) => this.laneOffset(i));
    const options = lanes.filter((L) => Math.abs(L - want) > 1).sort((a, b) => Math.abs(a - lat) - Math.abs(b - lat));
    for (const L of options) {
      if (block(L, reach).g !== Infinity) continue;
      const crossed = lanes.filter((M) => (M - lat) * (M - L) < 0);
      if (crossed.every((M) => block(M, 350).g === Infinity)) return { lat: L, speed: now };
    }
    return { lat: want, speed: Math.min(now, follow(here)) };
  }

  /** Deepest overlap between two hulls, or null. */
  static overlap(a, sa, b, sb) {
    let best = null;
    for (const ac of hullCircles(a, sa)) {
      for (const bc of hullCircles(b, sb)) {
        const dx = bc.x - ac.x, dy = bc.y - ac.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        const o = ac.r + bc.r - d;
        if (o > 0 && (!best || o > best.o)) best = { o, nx: dx / d, ny: dy / d, x: ac.x + (dx / d) * ac.r, y: ac.y + (dy / d) * ac.r };
      }
    }
    return best;
  }

  /**
   * The player and a car. Separation is shared (the player takes 40%),
   * the car is shoved along the player's travel and set spinning, and the
   * player pays for the speed it carried into it: most of the closing
   * speed on a rear-end, a smaller scrub on a glancing one.
   */
  hitPlayer(c, p, pSize, events) {
    const hit = Traffic.overlap(p, pSize, c, c.hull);
    if (!hit) return;
    const ms = P.moveScale;
    const sep = hit.o * 1.04;
    p.x -= hit.nx * sep * 0.4; p.y -= hit.ny * sep * 0.4;
    c.x += hit.nx * sep * 0.6; c.y += hit.ny * sep * 0.6;
    const hx = Math.cos(p.angle), hy = Math.sin(p.angle);
    const cv = c.mode !== 'road' ? { x: c.vx, y: c.vy } : { x: Math.cos(c.angle) * c.speed * ms, y: Math.sin(c.angle) * c.speed * ms };
    const pv = p.speed * ms;
    // closing speed along the contact normal, world units/s
    const closing = (hx * pv - cv.x) * hit.nx + (hy * pv - cv.y) * hit.ny;
    const fresh = (c._hitCool ?? 0) <= 0;
    c._hitCool = 0.25;
    if (closing > 0) {
      const into = Math.max(0, hx * hit.nx + hy * hit.ny);   // 1 = straight into it
      const lose = closing / ms * (0.42 + 0.42 * into);
      p.speed = Math.max(0, p.speed - lose);
      const push = closing * 0.75;
      const side = (this.rng() - 0.5) * 2;
      this.launch(c, cv.x + hit.nx * push, cv.y + hit.ny * push, side * (1.5 + closing / 400), closing > 700 ? closing * 0.12 : 0);
      if (p.shake !== undefined) p.shake = Math.max(p.shake, Math.min(10, 3 + closing / 120));
    }
    const force = Math.min(1, Math.max(0, closing) / (P.maxSpeed * ms * 0.5));
    setContact(p.contact, { impact: fresh, x: hit.x, y: hit.y, nx: hit.nx, ny: hit.ny, force });
    setContact(c.contact, { impact: fresh, x: hit.x, y: hit.y, nx: -hit.nx, ny: -hit.ny, force });
    if (fresh) events.push({ type: 'player', car: c, force });
  }

  /** The rival plows through: the car goes flying, the rival barely notices. */
  hitRival(c, r, rSize, events) {
    const hit = Traffic.overlap(r, rSize, c, c.hull);
    if (!hit) return;
    const ms = P.moveScale;
    c.x += hit.nx * hit.o * 1.04; c.y += hit.ny * hit.o * 1.04;
    const fresh = (c._rivalCool ?? 0) <= 0;
    c._rivalCool = 0.4;
    if (!fresh) return;
    const hx = Math.cos(r.angle), hy = Math.sin(r.angle);
    const rv = r.speed * ms;
    // thrown forward with the truck and out to the side it was struck on;
    // how hard, and what it costs the truck, is the stage's (RIVAL_HIT)
    const k = { ...RIVAL_HIT, ...(r.trafficHit ?? {}) };
    const out = k.out[0] + this.rng() * (k.out[1] - k.out[0]);
    const vx = hx * rv * k.forward + hit.nx * rv * out;
    const vy = hy * rv * k.forward + hit.ny * rv * out;
    const spin = (this.rng() < 0.5 ? -1 : 1) * (k.spin[0] + this.rng() * (k.spin[1] - k.spin[0]));
    this.launch(c, vx, vy, spin, k.lift[0] + rv * k.lift[1]);
    r.speed *= k.keep;
    const force = Math.min(1, rv / (P.maxSpeed * ms));
    setContact(c.contact, { impact: true, x: hit.x, y: hit.y, nx: -hit.nx, ny: -hit.ny, force });
    events.push({ type: 'rival', car: c, force });
  }

  /** Per-frame cooldowns (call once a frame, before update). */
  tick(dt) {
    for (const c of this.cars) {
      c._hitCool = Math.max(0, (c._hitCool ?? 0) - dt);
      c._rivalCool = Math.max(0, (c._rivalCool ?? 0) - dt);
    }
  }
}
