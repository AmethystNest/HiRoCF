/**
 * Background traffic on stage 4's expressway: ordinary cars cruising at
 * about 100 km/h on the dial, one to a lane in any of the three lanes.
 *
 * They are there to be in the player's way. The rival -- a loaded box
 * truck -- does not go round them: it runs straight through and sends
 * them flying. The player hitting one is a real hit: a rear-end at speed
 * costs most of the closing speed, and the car it hit is shoved on ahead
 * of it, spinning.
 *
 * A car has two states. On the road it runs on rails, a distance along the
 * course and a lane, at its own cruising speed, holding back behind a
 * slower car in its lane. Once hit it is loose: a body with its own
 * velocity and spin that slides to a stop wherever it ends up, still in
 * the way. A car well behind the player, or loose and stopped out of
 * sight, is taken away and put back into the traffic somewhere ahead,
 * beyond the edge of the screen, so the density round the player holds.
 *
 * Pure logic: main.js draws them (see Game#buildTraffic) and hands this
 * the player, the rival and their hull sizes each frame.
 */
import { PHYSICS as P } from '../config.js';
import { hullCircles } from './race.js';
import { makeContact, setContact } from './contact.js';

/** Cruising speed band, in the dial's km/h. */
const KMH_MIN = 90, KMH_MAX = 110;
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

const toSpeed = (kmh) => kmh / P.hudSpeedFactor;

export class Traffic {
  /**
   * @param path      TrackPath
   * @param opts.count cars
   * @param opts.roadHalf the road's half-width (lane positions)
   * @param opts.size  { w, h } hull of one car, world units
   * @param opts.barrier per-index wall half-width (main.js), which a car
   *        knocked loose bounces off instead of flying through
   * @param opts.rng   () => [0, 1), for repeatable tests
   */
  constructor(path, { count = 5, roadHalf, size, barrier = null, rng = Math.random }) {
    this.path = path;
    this.barrier = barrier;
    this.roadHalf = roadHalf;
    this.size = size;
    this.rng = rng;
    this.cars = [];
    for (let i = 0; i < count; i++) {
      this.cars.push({
        id: i, loose: false, d: 0, lane: 0, lat: 0, cruise: 0, speed: 0,
        x: 0, y: 0, angle: 0, vx: 0, vy: 0, spin: 0, lift: 0, liftV: 0, still: 0,
        contact: makeContact(), _routeHint: 0, deckId: 0, zLevel: 0,
      });
    }
  }

  /** Lay the cars out ahead of the grid: `from` is the player's distance. */
  reset(from) {
    for (const c of this.cars) this.respawn(c, from, true);
  }

  laneOffset(lane) { return LANES[lane] * this.roadHalf; }

  /** Put `c` back on the road somewhere ahead of distance `from`. */
  respawn(c, from, initial = false) {
    const L = this.path.length;
    for (let tries = 0; tries < 20; tries++) {
      const ahead = initial
        ? 2600 + this.rng() * 16000
        : SPAWN_AHEAD[0] + this.rng() * (SPAWN_AHEAD[1] - SPAWN_AHEAD[0]);
      const d = (((from + ahead) % L) + L) % L;
      const lane = Math.floor(this.rng() * LANES.length);
      const clear = this.cars.every((o) => o === c || o.loose || o.lane !== lane
        || Math.abs(this.gap(d, o.d)) > SPAWN_GAP);
      if (!clear && tries < 19) continue;
      Object.assign(c, {
        loose: false, d, lane, lat: this.laneOffset(lane),
        cruise: toSpeed(KMH_MIN + this.rng() * (KMH_MAX - KMH_MIN)),
        vx: 0, vy: 0, spin: 0, lift: 0, liftV: 0, still: 0,
      });
      c.speed = c.cruise;
      this.place(c);
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

  place(c) {
    const s = this.path.sample(c.d);
    const k = s.index;
    c.x = s.x + this.path.normals[k * 2] * c.lat;
    c.y = s.y + this.path.normals[k * 2 + 1] * c.lat;
    c.angle = s.angle;
    c._routeHint = k;
  }

  /** Knock `c` loose with a velocity (world units/s) and spin (rad/s). */
  launch(c, vx, vy, spin, lift = 0) {
    c.loose = true;
    c.vx = vx; c.vy = vy; c.spin = spin;
    c.liftV = Math.max(c.liftV, lift);
    c.still = 0;
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

    // --- on the road: cruise, keep station behind a slower car in lane
    const onRoad = this.cars.filter((c) => !c.loose);
    for (const c of onRoad) {
      let target = c.cruise;
      for (const o of onRoad) {
        if (o === c || o.lane !== c.lane) continue;
        const g = this.gap(c.d, o.d);
        if (g > 0 && g < FOLLOW_GAP) target = Math.min(target, o.speed * (g / FOLLOW_GAP));
      }
      c.speed += (target - c.speed) * Math.min(1, dt * 2.5);
      c.d = (c.d + c.speed * ms * dt) % this.path.length;
      this.place(c);
    }

    // --- loose: slide, spin, settle
    for (const c of this.cars) {
      if (!c.loose) continue;
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.angle += c.spin * dt;
      const f = Math.exp(-dt * 1.6);
      c.vx *= f; c.vy *= f; c.spin *= Math.exp(-dt * 1.9);
      c.liftV -= 900 * dt; c.lift = Math.max(0, c.lift + c.liftV * dt);
      if (c.lift === 0) c.liftV = Math.max(0, c.liftV);
      const near = this.path.nearestLocal(c.x, c.y, c._routeHint, 60);
      c._routeHint = near.index;
      // the concrete wall: pushed back inside it, and the part of its
      // velocity that was going into the wall mostly lost
      if (this.barrier) {
        const k = near.index, nx = this.path.normals[k * 2], ny = this.path.normals[k * 2 + 1];
        const lat = (c.x - near.x) * nx + (c.y - near.y) * ny;
        const lim = this.barrier[k] - this.size.w * 0.5;
        if (Math.abs(lat) > lim) {
          const sgn = Math.sign(lat), back = Math.abs(lat) - lim;
          c.x -= nx * sgn * back; c.y -= ny * sgn * back;
          const vn = (c.vx * nx + c.vy * ny) * sgn;
          if (vn > 0) { c.vx -= nx * sgn * vn * 1.35; c.vy -= ny * sgn * vn * 1.35; c.spin *= 0.7; }
        }
      }
      c.speed = Math.hypot(c.vx, c.vy) / ms;
      c.still = c.speed < 20 ? c.still + dt : 0;
    }

    // --- contacts
    if (collide) {
      for (const c of this.cars) {
        if (sameDeck(player, c)) this.hitPlayer(c, player, hulls.player, events);
        if (rival && sameDeck(rival, c)) this.hitRival(c, rival, hulls.rival, events);
      }
    }

    // --- recycle: fallen behind, or loose and parked out of sight
    for (const c of this.cars) {
      const g = this.gap(pd, c.loose ? c._routeHint * this.path.spacing : c.d);
      const seen = Math.hypot(c.x - player.x, c.y - player.y) < view;
      if ((g < -DESPAWN_BEHIND && !seen) || (c.loose && c.still > 1.2 && !seen) || (c.loose && g < -DESPAWN_BEHIND * 2)) {
        this.respawn(c, pd);
      }
    }
    return events;
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
    const hit = Traffic.overlap(p, pSize, c, this.size);
    if (!hit) return;
    const ms = P.moveScale;
    const sep = hit.o * 1.04;
    p.x -= hit.nx * sep * 0.4; p.y -= hit.ny * sep * 0.4;
    c.x += hit.nx * sep * 0.6; c.y += hit.ny * sep * 0.6;
    const hx = Math.cos(p.angle), hy = Math.sin(p.angle);
    const cv = c.loose ? { x: c.vx, y: c.vy } : { x: Math.cos(c.angle) * c.speed * ms, y: Math.sin(c.angle) * c.speed * ms };
    const pv = p.speed * ms;
    // closing speed along the contact normal, world units/s
    const closing = (hx * pv - cv.x) * hit.nx + (hy * pv - cv.y) * hit.ny;
    const fresh = (c._hitCool ?? 0) <= 0;
    c._hitCool = 0.25;
    if (closing > 0) {
      const into = Math.max(0, hx * hit.nx + hy * hit.ny);   // 1 = straight into it
      const lose = closing / ms * (0.35 + 0.35 * into);
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
    const hit = Traffic.overlap(r, rSize, c, this.size);
    if (!hit) return;
    const ms = P.moveScale;
    c.x += hit.nx * hit.o * 1.04; c.y += hit.ny * hit.o * 1.04;
    const fresh = (c._rivalCool ?? 0) <= 0;
    c._rivalCool = 0.4;
    if (!fresh) return;
    const hx = Math.cos(r.angle), hy = Math.sin(r.angle);
    const rv = r.speed * ms;
    // thrown forward with the truck and out to the side it was struck on
    const out = 0.55 + this.rng() * 0.35;
    const vx = hx * rv * 1.15 + hit.nx * rv * out;
    const vy = hy * rv * 1.15 + hit.ny * rv * out;
    const spin = (this.rng() < 0.5 ? -1 : 1) * (5 + this.rng() * 5);
    this.launch(c, vx, vy, spin, 260 + rv * 0.12);
    r.speed *= 0.97;
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
