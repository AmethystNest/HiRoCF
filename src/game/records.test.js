import { describe, it, expect } from 'vitest';
import { createRecords, starsFor, nextStarGap, STAR_GAPS } from './records.js';
import { rivalTuning } from '../config.js';

const IDS = [1, 2, 3, 4, 5];

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    dump: () => Object.fromEntries(m),
  };
}

describe('stars', () => {
  it('gives none for a loss and one to three for a win by margin', () => {
    expect(starsFor({ won: false, time: 90, gap: 10 })).toBe(0);
    expect(starsFor({ won: true, time: 100, gap: 0.5 })).toBe(1);
    expect(starsFor({ won: true, time: 100, gap: 100 * STAR_GAPS[0] })).toBe(2);
    expect(starsFor({ won: true, time: 100, gap: 100 * STAR_GAPS[1] })).toBe(3);
    // no gap known (no other car) is still a win
    expect(starsFor({ won: true, time: 100, gap: null })).toBe(1);
  });

  it('says how much margin the next star needs', () => {
    expect(nextStarGap({ time: 100 }, 1)).toBeCloseTo(100 * STAR_GAPS[0]);
    expect(nextStarGap({ time: 100 }, 2)).toBeCloseTo(100 * STAR_GAPS[1]);
    expect(nextStarGap({ time: 100 }, 3)).toBeNull();
  });
});

describe('records', () => {
  it('opens only stage 1 to start with, and each next stage on a win', () => {
    const r = createRecords(IDS, { storage: memoryStorage() });
    expect(IDS.map((id) => r.isUnlocked(id))).toEqual([true, false, false, false, false]);
    const lost = r.submit(1, 'normal', { won: false, time: 90, gap: 2 });
    expect(lost.unlocked).toBeNull();
    expect(r.isUnlocked(2)).toBe(false);
    const won = r.submit(1, 'normal', { won: true, time: 95, gap: 1 });
    expect(won.unlocked).toBe(2);
    expect(r.isUnlocked(2)).toBe(true);
    // winning again opens nothing new
    expect(r.submit(1, 'normal', { won: true, time: 93, gap: 1 }).unlocked).toBeNull();
  });

  it('keeps the best time and best stars per stage and difficulty', () => {
    const r = createRecords(IDS, { storage: memoryStorage() });
    const a = r.submit(1, 'normal', { won: true, time: 90.1234, gap: 5 });
    expect(a).toMatchObject({ newBest: true, best: 90123, previousBest: null, stars: 3 });
    const b = r.submit(1, 'normal', { won: true, time: 91, gap: 0.2 });
    expect(b).toMatchObject({ newBest: false, best: 90123, stars: 1, bestStars: 3 });
    const c = r.submit(1, 'normal', { won: false, time: 88, gap: 1 });
    // a lost race is still a finished one: its time counts
    expect(c).toMatchObject({ newBest: true, best: 88000, previousBest: 90123, stars: 0 });
    expect(r.get(1, 'normal')).toEqual({ best: 88000, stars: 3, cleared: true });
    expect(r.get(1, 'hard')).toEqual({ best: null, stars: 0, cleared: false });
  });

  it('persists across loads, including the difficulty chosen', () => {
    const storage = memoryStorage();
    const r = createRecords(IDS, { storage });
    for (const id of IDS) r.submit(id, 'normal', { won: true, time: 80, gap: 1.5 });
    r.difficulty = 'hard';
    const again = createRecords(IDS, { storage });
    expect(again.difficulty).toBe('hard');
    expect(again.get(1, 'normal').best).toBe(80000);
    expect(again.isUnlocked(2)).toBe(true);
  });

  it('survives storage that is missing, broken or throws', () => {
    const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    for (const storage of [null, throwing, memoryStorage({ hirocf_records_v2: '{not json' })]) {
      const r = createRecords(IDS, { storage });
      expect(r.isUnlocked(1)).toBe(true);
      expect(() => r.submit(1, 'normal', { won: true, time: 90, gap: 1 })).not.toThrow();
      expect(r.isUnlocked(2)).toBe(true);   // still counts for this visit
    }
  });

  it('ignores stored values of the wrong shape', () => {
    const storage = memoryStorage({
      hirocf_records_v2: JSON.stringify({
        difficulty: 'impossible',
        stages: { 1: { normal: { best: -5, stars: 99, cleared: 'yes' } }, 9: { normal: { best: 1 } } },
      }),
    });
    const r = createRecords(IDS, { storage });
    expect(r.difficulty).toBe('normal');
    expect(r.get(1, 'normal')).toEqual({ best: null, stars: 3, cleared: false });
    expect(r.isUnlocked(2)).toBe(false);
  });

  it('can open every stage without touching what is stored', () => {
    const storage = memoryStorage();
    const r = createRecords(IDS, { storage, unlockAll: true });
    expect(IDS.every((id) => r.isUnlocked(id))).toBe(true);
    expect(createRecords(IDS, { storage }).isUnlocked(2)).toBe(false);
  });
});

describe('difficulty', () => {
  it('leaves HARD exactly as tuned and eases only speed and acceleration for NORMAL', () => {
    const rival = { maxSpeed: 700, accel: 100, launchAccel: 50, turn: 2, cornerSlow: 0.2 };
    expect(rivalTuning(rival, 'hard')).toBe(rival);
    const normal = rivalTuning(rival, 'normal');
    expect(normal.maxSpeed).toBeLessThan(700);
    expect(normal.launchAccel).toBeLessThan(50);
    expect(normal.turn).toBe(2);
    expect(normal.cornerSlow).toBe(0.2);
    expect(rival.maxSpeed).toBe(700);   // the stage's own config is not mutated
  });

  it('keeps HARD shut until every stage is won, and says when it opens', () => {
    const r = createRecords(IDS, { storage: memoryStorage() });
    expect(r.isDifficultyUnlocked('hard')).toBe(false);
    r.difficulty = 'hard';
    expect(r.difficulty).toBe('normal');
    const opened = IDS.map((id) => r.submit(id, 'normal', { won: true, time: 90, gap: 1 }).hardUnlocked);
    expect(opened).toEqual([false, false, false, false, true]);
    r.difficulty = 'hard';
    expect(r.difficulty).toBe('hard');
    expect(createRecords(IDS, { storage: memoryStorage(), unlockAll: true }).isDifficultyUnlocked('hard')).toBe(true);
  });

  it('carries v1 records across: EASY -> NORMAL, NORMAL/HARD -> HARD', () => {
    const storage = memoryStorage({
      hirocf_records_v1: JSON.stringify({
        difficulty: 'normal',
        stages: {
          1: { easy: { best: 90000, stars: 2, cleared: true }, normal: { best: 95000, stars: 1, cleared: true },
               hard: { best: 93000, stars: 3, cleared: false } },
          2: { normal: { best: 70000, stars: 0, cleared: false } },
        },
      }),
    });
    const r = createRecords(IDS, { storage });
    expect(r.get(1, 'normal')).toEqual({ best: 90000, stars: 2, cleared: true });
    expect(r.get(1, 'hard')).toEqual({ best: 93000, stars: 3, cleared: true });
    expect(r.get(2, 'hard').best).toBe(70000);
    expect(r.isUnlocked(2)).toBe(true);
    expect(r.difficulty).toBe('normal');
  });

  it('carries on from the first stage not yet won', () => {
    const r = createRecords(IDS, { storage: memoryStorage() });
    expect(r.frontier()).toBe(1);
    r.submit(1, 'normal', { won: true, time: 90, gap: 1 });
    r.submit(2, 'normal', { won: true, time: 90, gap: 1 });
    expect(r.frontier()).toBe(3);
    for (const id of IDS) r.submit(id, 'normal', { won: true, time: 90, gap: 1 });
    expect(r.frontier()).toBe(5);
  });
});
