import { describe, it, expect } from 'vitest';
import { hullCircles, resolveContacts, Race } from './race.js';
import { overlapDepth } from './hull.js';

// resolveContacts decides who is who from the constructor name, so the
// stand-ins here carry the real names. Everything else it touches (x, y,
// angle, speed, contactMass, shake) is a plain field.
class PlayerCar {
  constructor(p) { Object.assign(this, { x: 0, y: 0, angle: 0, speed: 0, shake: 0 }, p); }
}
class RivalCar {
  constructor(p) { Object.assign(this, { x: 0, y: 0, angle: 0, speed: 0, contactRecoveryTimer: 0 }, p); }
}

const CAR = { w: 194, h: 271 };     // the player, in world units
const TRUCK = { w: 174, h: 616 };   // stage 4's box truck (63.0 x 222.5 at worldScale 2.77)

describe('hullCircles', () => {
  it('uses the original three circles for a car', () => {
    const c = hullCircles({ x: 0, y: 0, angle: 0 }, CAR);
    expect(c.length).toBe(3);
    expect(c[1].r).toBeCloseTo(CAR.w * 0.355, 5);
  });

  it('covers the whole length of a long vehicle', () => {
    // Three circles on a 881-long body leave its nose and tail with no
    // collision at all -- a car would drive through the front of it.
    const circles = hullCircles({ x: 0, y: 0, angle: 0 }, TRUCK);
    for (let x = -TRUCK.h / 2 + 30; x <= TRUCK.h / 2 - 30; x += 10) {
      const covered = circles.some((c) => Math.hypot(c.x - x, c.y) <= c.r);
      expect(covered).toBe(true);
    }
  });

  it('keeps its circles inside the body it stands for', () => {
    for (const size of [CAR, TRUCK]) {
      for (const c of hullCircles({ x: 0, y: 0, angle: 0 }, size)) {
        expect(Math.abs(c.x) + c.r).toBeLessThanOrEqual(size.h / 2 + 1);
        expect(c.r).toBeLessThanOrEqual(size.w / 2 + 1);
      }
    }
  });

  it('turns with the vehicle', () => {
    const c = hullCircles({ x: 0, y: 0, angle: Math.PI / 2 }, TRUCK);
    const front = c[c.length - 1];
    expect(Math.abs(front.x)).toBeLessThan(1);
    expect(Math.abs(front.y)).toBeGreaterThan(100);
  });
});

describe('resolveContacts mass', () => {
  /** side-by-side contact; returns how far each body was pushed */
  function sideHit(mass) {
    const size = mass > 1 ? TRUCK : { w: 205, h: 271 };
    const player = new PlayerCar({ x: 0, y: 0, speed: 620 });
    const rival = new RivalCar({ x: 0, y: (CAR.w + size.w) * 0.32, speed: 620, contactMass: mass });
    resolveContacts([player, rival], [CAR, size]);
    return { player: Math.hypot(player.x, player.y), rival: Math.abs(rival.y - (CAR.w + size.w) * 0.32) };
  }

  it('splits a contact between two cars the way it always did', () => {
    const { player, rival } = sideHit(1);
    // the player's own small advantage: it gives more than it takes
    expect(rival).toBeGreaterThan(player);
    expect(rival / (player + rival)).toBeCloseTo(0.55, 1);
  });

  it('barely moves a heavy vehicle', () => {
    const { player, rival } = sideHit(9);
    expect(rival / (player + rival)).toBeLessThan(0.15);
    expect(player).toBeGreaterThan(rival * 4);
  });

  it('lets a heavy vehicle shrug off a rear-end shunt', () => {
    const shunt = (mass, size) => {
      const player = new PlayerCar({ x: 0, y: 0, angle: 0, speed: 620 });
      const rival = new RivalCar({ x: CAR.h / 2 + size.h / 2 - 30, y: 0, angle: 0, speed: 430, contactMass: mass });
      resolveContacts([player, rival], [CAR, size]);
      return { gained: rival.speed - 430, lost: 620 - player.speed };
    };
    const car = shunt(1, { w: 205, h: 271 });
    const truck = shunt(9, TRUCK);
    expect(car.gained).toBeGreaterThan(20);      // a car gets punted forward
    expect(truck.gained).toBeLessThan(car.gained / 4);
    expect(truck.lost).toBeGreaterThan(car.lost);  // and the player pays for it
  });

  it('never hands a heavy vehicle a speed advantage from being hit', () => {
    const player = new PlayerCar({ x: 0, y: 0, angle: 0, speed: 760 });
    const rival = new RivalCar({ x: CAR.h / 2 + TRUCK.h / 2 - 40, y: 0, angle: 0, speed: 300, contactMass: 9 });
    resolveContacts([player, rival], [CAR, TRUCK]);
    expect(rival.speed).toBeLessThan(330);
  });
});

describe('race result', () => {
  // a straight "path": progress is driven by hand, so only length matters
  const path = { length: 1000 };
  const race = (playerTotal, rivalTotal, rivalFinish = null) => {
    const r = new Race(path, { totalLaps: 3, startBack: 0 });
    const p = r.addCar({}, { isPlayer: true }), o = r.addCar({});
    r.time = 60;
    Object.assign(p.progress, { total: playerTotal, finished: true, finishTime: 60 });
    Object.assign(o.progress, { total: rivalTotal, finished: rivalFinish != null, finishTime: rivalFinish });
    return r.resultFor(p);
  };

  it('times a win by the distance the rival still has, at its own pace', () => {
    // 2900 covered in 60 s is 48.3/s; 100 short is 2.07 s behind
    const res = race(3000, 2900);
    expect(res.won).toBe(true);
    expect(res.gap).toBeCloseTo(100 / (2900 / 60), 5);
  });

  it('times a loss exactly from the rival\'s own finish', () => {
    const res = race(3000, 3050, 57.5);
    expect(res.won).toBe(false);
    expect(res.gap).toBeCloseTo(2.5, 5);
  });
});

describe('the battle ends when either car finishes', () => {
  const path = { length: 1000 };
  // progress is set by hand each "frame"; update() only reads it
  function racing(playerTotal, rivalTotal) {
    const r = new Race(path, { totalLaps: 3, startBack: 0 });
    const p = r.addCar({}, { isPlayer: true }), o = r.addCar({});
    for (const e of [p, o]) e.progress.update = () => {};
    Object.assign(p.progress, { total: playerTotal });
    Object.assign(o.progress, { total: rivalTotal });
    r.state = 'racing';
    return { r, p, o };
  }

  it('keeps racing while neither is over the line', () => {
    const { r } = racing(2990, 2980);
    r.update(0.016);
    expect(r.state).toBe('racing');
    expect(r.winner).toBeNull();
  });

  it('ends the race, lost, when the rival crosses first -- the player need not finish', () => {
    const { r, p, o } = racing(2950, 3001);
    r.update(0.016);
    expect(r.state).toBe('finished');
    expect(r.winner).toBe(o);
    expect(p.progress.finished).toBe(false);
    expect(r.positionOf(p)).toBe(2);
    expect(r.result).toMatchObject({ won: false, finished: false });
  });

  it('ends the race, won, when the player crosses first', () => {
    const { r, p } = racing(3001, 2950);
    r.update(0.016);
    expect(r.state).toBe('finished');
    expect(r.winner).toBe(p);
    expect(r.result).toMatchObject({ won: true, finished: true });
  });

  it('gives a same-tick finish to the car further along', () => {
    const a = racing(3004, 3001);
    a.r.update(0.016);
    expect(a.r.winner).toBe(a.p);
    expect(a.r.result.won).toBe(true);
    const b = racing(3001, 3004);
    b.r.update(0.016);
    expect(b.r.winner).toBe(b.o);
    expect(b.r.result.won).toBe(false);
    expect(b.r.positionOf(b.p)).toBe(2);
  });

  it('stops counting once it is over', () => {
    const { r, o } = racing(2950, 3001);
    r.update(0.016);
    const t = r.time;
    r.update(0.016);
    expect(r.time).toBe(t);
    expect(r.winner).toBe(o);
  });
});

describe('resolveContacts with hulls cut from the drawn cars', () => {
  const rect = (w, h) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  const SIZE = { w: 70, h: 120, poly: rect(70, 120) };

  it('leaves no overlap after a rear-end and hands the front car speed', () => {
    const p = new PlayerCar({ x: 0, y: 0, speed: 650 });
    const r = new RivalCar({ x: 118, y: 0, speed: 400 });
    resolveContacts([p, r], [SIZE, SIZE], 1 / 60);
    expect(overlapDepth(p, SIZE, r, SIZE)).toBeLessThan(0.5);
    expect(r.speed).toBeGreaterThan(400);
    expect(p.speed).toBeLessThan(650);
  });

  it('touches when the bodies touch, not before', () => {
    const p = new PlayerCar({ x: 0, y: 0, speed: 300 });
    const r = new RivalCar({ x: 122, y: 0, speed: 300 });
    resolveContacts([p, r], [SIZE, SIZE], 1 / 60);
    expect(p.carImpact).toBeFalsy();
    expect(p.x).toBe(0);
  });

  it('turns a car hit off its middle, by the side the hit is on, and not one hit dead centre', () => {
    const hitAt = (offset) => {
      const p = new PlayerCar({ x: 0, y: offset, speed: 650 });
      const r = new RivalCar({ x: 118, y: 0, speed: 400 });
      resolveContacts([p, r], [SIZE, SIZE], 1 / 60);
      return r.yawKick;
    };
    const right = hitAt(25), left = hitAt(-25), centre = hitAt(0);
    expect(right).toBeLessThan(-0.05);          // tail pushed on its right: the nose swings left
    expect(left).toBeGreaterThan(0.05);
    expect(right).toBeCloseTo(-left, 6);
    expect(Math.abs(centre)).toBeLessThan(0.01);
  });

  it('never turns a car by more than its cap', () => {
    const p = new PlayerCar({ x: 0, y: 30, speed: 900 });
    const r = new RivalCar({ x: 90, y: 0, angle: Math.PI / 2, speed: 900 });
    resolveContacts([p, r], [SIZE, SIZE], 1 / 60);
    expect(Math.abs(p.yawKick ?? 0)).toBeGreaterThan(0);
    expect(Math.abs(p.yawKick)).toBeLessThanOrEqual(2.5);
    expect(Math.abs(r.yawKick)).toBeLessThanOrEqual(2.5);
  });

  it('turns the player by 60% of what the same hit turns a rival', () => {
    const kickOf = (car) => {
      const other = new RivalCar({ x: 118, y: 0, speed: 400 });
      resolveContacts([car, other], [SIZE, SIZE], 1 / 60);
      return car.yawKick;
    };
    const asPlayer = kickOf(new PlayerCar({ x: 0, y: 25, speed: 650 }));
    const asRival = kickOf(new RivalCar({ x: 0, y: 25, speed: 650 }));
    expect(Math.abs(asRival)).toBeGreaterThan(0.05);
    expect(asPlayer / asRival).toBeCloseTo(0.6, 3);
  });

  it('gives no turn to cars that are moving apart', () => {
    const p = new PlayerCar({ x: 0, y: 0, speed: 300 });
    const r = new RivalCar({ x: 118, y: 20, speed: 500 });   // overlapping, but pulling away
    resolveContacts([p, r], [SIZE, SIZE], 1 / 60);
    expect(r.yawKick ?? 0).toBe(0);
    expect(p.yawKick ?? 0).toBe(0);
  });

  it('turns a contact only once, however many frames it lasts', () => {
    const p = new PlayerCar({ x: 0, y: 25, speed: 650 });
    const r = new RivalCar({ x: 118, y: 0, speed: 400 });
    resolveContacts([p, r], [SIZE, SIZE], 1 / 60);
    const first = r.yawKick;
    resolveContacts([p, r], [SIZE, SIZE], 1 / 60);
    resolveContacts([p, r], [SIZE, SIZE], 1 / 60);
    expect(r.yawKick).toBeCloseTo(first, 6);
  });
});
