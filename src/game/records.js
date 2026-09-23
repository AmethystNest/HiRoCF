/**
 * What a player has done, kept between visits: best race time and stars per
 * stage and difficulty, which stages are open, and the difficulty last
 * chosen.
 *
 * The reasons to come back to a racer are a time to beat, a rating to
 * improve and something still locked -- DustRacing2D's records, star
 * ratings and track unlocking, which is what this follows. None of its code:
 * the design only (it is GPLv3).
 *
 * Storage is the browser's localStorage, which can be missing, full, or
 * throw on every access (Safari private mode, storage disabled, a sandboxed
 * frame). Every access is guarded and the game plays exactly the same
 * without it; nothing is kept for the next visit, that is all. What is read
 * back is validated field by field -- it is the user's own storage, but a
 * corrupt or hand-edited value must not be able to break the stage list.
 */

import { DIFFICULTY, STAGES } from '../config.js';

const KEY = 'hirocf_records_v1';

export const DIFFICULTIES = Object.keys(DIFFICULTY);

/**
 * Stars for a finished race: one for the win, a second for winning by
 * STAR_GAPS[0] of the race time, a third by STAR_GAPS[1]. A share of the
 * race rather than fixed seconds, so the long stages (a 3.5-minute race on
 * stage 5) ask for the same dominance as the short ones (1.5 minutes on
 * stage 1): 1.5% is ~1.3 s on stage 1 and ~3 s on stage 5.
 */
export const STAR_GAPS = [0.015, 0.04];

export function starsFor({ won, time, gap }) {
  if (!won) return 0;
  const share = time > 0 && gap != null ? gap / time : 0;
  if (share >= STAR_GAPS[1]) return 3;
  if (share >= STAR_GAPS[0]) return 2;
  return 1;
}

/** Seconds of margin the next star needs, or null at three. */
export function nextStarGap({ time }, stars) {
  if (stars >= 3 || !(time > 0)) return null;
  if (stars <= 0) return 0;
  return STAR_GAPS[stars - 1] * time;
}

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function clean(raw, stageIds) {
  const out = { difficulty: 'normal', stages: {} };
  if (!raw || typeof raw !== 'object') return out;
  if (DIFFICULTIES.includes(raw.difficulty)) out.difficulty = raw.difficulty;
  for (const id of stageIds) {
    const src = raw.stages?.[id];
    if (!src || typeof src !== 'object') continue;
    const st = {};
    for (const d of DIFFICULTIES) {
      const r = src[d];
      if (!r || typeof r !== 'object') continue;
      const best = Number.isFinite(r.best) && r.best > 0 ? Math.round(r.best) : null;
      const stars = Number.isInteger(r.stars) ? Math.max(0, Math.min(3, r.stars)) : 0;
      st[d] = { best, stars, cleared: r.cleared === true };
    }
    out.stages[id] = st;
  }
  return out;
}

/**
 * @param {number[]} stageIds  in play order; a stage opens when the one
 *                             before it has been won on any difficulty
 * @param {object} [opts] storage: a Storage-like object (tests pass one);
 *                        unlockAll: every stage open, stored progress
 *                        untouched (for checking a late stage directly)
 */
export function createRecords(
  stageIds = Object.keys(STAGES).map(Number).sort((a, b) => a - b),
  { storage = defaultStorage(), unlockAll = false } = {},
) {
  let data;
  try {
    data = clean(JSON.parse(storage?.getItem(KEY) ?? 'null'), stageIds);
  } catch {
    data = clean(null, stageIds);
  }
  const save = () => {
    try { storage?.setItem(KEY, JSON.stringify(data)); } catch { /* not kept; plays the same */ }
  };
  const rec = (id, d) => data.stages[id]?.[d] ?? { best: null, stars: 0, cleared: false };

  return {
    get difficulty() { return data.difficulty; },
    set difficulty(d) {
      if (!DIFFICULTIES.includes(d) || d === data.difficulty) return;
      data.difficulty = d;
      save();
    },
    /** Best race time (ms), stars and cleared flag for a stage. */
    get(id, d = data.difficulty) { return { ...rec(id, d) }; },
    /** Won on any difficulty. */
    cleared(id) { return DIFFICULTIES.some((d) => rec(id, d).cleared); },
    isUnlocked(id) {
      const i = stageIds.indexOf(id);
      if (i < 0) return false;
      return unlockAll || i === 0 || this.cleared(stageIds[i - 1]);
    },
    /**
     * Record a finished race. Returns what changed, for the result card:
     * the stars earned, whether the time is a new best (and the one it
     * beat), and the stage this win opened, if any.
     */
    submit(id, d, result) {
      const stars = starsFor(result);
      const before = rec(id, d);
      // floored, as the clock on screen is, so the two never disagree by 1 ms
      const ms = Math.floor(result.time * 1000);
      const newBest = ms > 0 && (before.best == null || ms < before.best);
      const i = stageIds.indexOf(id);
      const next = i >= 0 && i < stageIds.length - 1 ? stageIds[i + 1] : null;
      const wasOpen = next != null && this.isUnlocked(next);
      data.stages[id] = {
        ...(data.stages[id] || {}),
        [d]: {
          best: newBest ? ms : before.best,
          stars: Math.max(before.stars, stars),
          cleared: before.cleared || result.won,
        },
      };
      save();
      return {
        stars,
        bestStars: data.stages[id][d].stars,
        newBest,
        best: data.stages[id][d].best,
        previousBest: before.best,
        unlocked: next != null && !wasOpen && this.isUnlocked(next) ? next : null,
      };
    },
  };
}
