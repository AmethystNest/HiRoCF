import { describe, it, expect } from 'vitest';
import { STAGES, PHYSICS, NITRO } from '../config.js';
import { STAGE_PATHS } from '../track/stages.js';
import { PlayerCar } from './player.js';

const DUR = PHYSICS.boostDuration;
const idle = {};

function car() {
  const p = new PlayerCar(STAGE_PATHS[1](), STAGES[1]);
  p.placeAtStart(0, 0);
  return p;
}

/** Run the car for `seconds`, counting how much of it was spent boosting. */
function run(p, seconds, dt = 1 / 120) {
  let boostingFor = 0;
  for (let t = 0; t < seconds; t += dt) {
    p.update(dt, idle);
    if (p.boosting) boostingFor += dt;
  }
  return boostingFor;
}

describe('nitro: banked charges', () => {
  it('starts on the grid with the configured stock and an empty meter', () => {
    const p = car();
    expect(p.nitroStock).toBe(NITRO.startStock);
    expect(p.nitroCharge).toBe(0);
  });

  it('spends one charge and burns for one full duration', () => {
    const p = car();
    p.nitroStock = 1;
    expect(p.tryNitro()).toBe(true);
    expect(p.nitroStock).toBe(0);
    expect(p.boosting).toBe(true);
    expect(p.boostTimer).toBeCloseTo(DUR, 6);
  });

  it('has nothing to fire on the grid until the meter has banked one', () => {
    const p = car();
    expect(p.tryNitro()).toBe(false);
    run(p, 100 / PHYSICS.boostRecover);
    expect(p.nitroStock).toBe(1);
    expect(p.tryNitro()).toBe(true);
  });

  it('refuses, and spends nothing, with no charge in hand', () => {
    const p = car();
    p.nitroStock = 0;
    expect(p.tryNitro()).toBe(false);
    expect(p.boosting).toBe(false);
    expect(p.nitroStock).toBe(0);
  });

  it('banks a charge each time the meter tops out, and caps at maxStock', () => {
    const p = car();
    p.nitroStock = 0;
    p.nitroCharge = 0;
    // long enough to fill maxStock + 2 charges over
    run(p, ((NITRO.maxStock + 2) * 100) / PHYSICS.boostRecover);
    expect(p.nitroStock).toBe(NITRO.maxStock);
    expect(p.nitroCharge).toBe(0);
  });

  it('freezes the meter while a burst is running', () => {
    const p = car();
    p.nitroStock = 1;
    p.nitroCharge = 0;
    p.tryNitro();
    run(p, DUR * 0.5);
    expect(p.nitroCharge).toBe(0);
  });
});

describe('nitro: chaining without waste', () => {
  it('refuses a press while more than the chain window is left, keeping the charge', () => {
    const p = car();
    p.nitroStock = 2;
    p.tryNitro();
    const left = p.boostTimer;
    expect(left).toBeGreaterThan(NITRO.chainWindow);
    expect(p.tryNitro()).toBe(false);
    expect(p.nitroStock).toBe(1);          // not spent
    expect(p.boostTimer).toBeCloseTo(left, 6); // and not restarted
  });

  it('extends rather than restarts inside the chain window, so no time is lost', () => {
    const p = car();
    p.nitroStock = 2;
    p.tryNitro();
    p.boostTimer = NITRO.chainWindow * 0.5;
    const left = p.boostTimer;
    expect(p.tryNitro()).toBe(true);
    expect(p.boostTimer).toBeCloseTo(left + DUR, 6);
  });

  it('three charges chain into three full durations of unbroken boost', () => {
    const p = car();
    p.nitroStock = NITRO.maxStock;
    p.tryNitro();
    let boostingFor = 0;
    let broke = false;
    const dt = 1 / 240;
    for (let t = 0; t < DUR * NITRO.maxStock + 2; t += dt) {
      // spend the next charge the moment the window opens
      if (p.nitroStock > 0 && p.boosting && p.boostTimer <= NITRO.chainWindow) p.tryNitro();
      p.update(dt, idle);
      if (p.boosting) boostingFor += dt;
      else if (boostingFor > 0) { broke = true; break; }
    }
    expect(broke).toBe(true);                        // it does end
    expect(p.nitroStock).toBe(0);                    // all three spent
    expect(boostingFor).toBeCloseTo(DUR * NITRO.maxStock, 1); // none of it wasted
  });
});
