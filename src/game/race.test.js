import { describe, it, expect } from 'vitest';
import { hullCircles, resolveContacts } from './race.js';

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
const TRUCK = { w: 241, h: 740 };   // stage 4's box truck (87 x 267 at worldScale 2.77)

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
