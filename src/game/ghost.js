/**
 * The best-run ghost: the player's own best lap of a stage, replayed beside
 * the next attempt as a see-through car.
 *
 * A run is recorded as the car's position and heading every 1/GHOST_HZ
 * second of race time, packed as 16-bit integers (a 3-minute race is ~20 KB,
 * ~27 KB as text) and kept in localStorage per stage and difficulty -- next
 * to, and as unreliable as, the records (records.js): when storage is
 * missing, full or refuses, there is simply no ghost.
 *
 * Playback reads it back at any time t by interpolating between samples, so
 * it does not depend on the frame rate it was recorded or is played at.
 */

export const GHOST_HZ = 30;
const POS_SCALE = 4;            // stored in units of 4 world units
const ANGLE_SCALE = 5000;       // stored in units of 1/5000 rad (heading wrapped to +-pi)
const KEY = 'hirocf_ghost_v1';

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));

/** Collects a run: call sample(t, car) every update while racing. */
export class GhostRecorder {
  constructor() { this.reset(); }

  reset() {
    this.x = []; this.y = []; this.a = [];
    this.next = 0;              // index of the sample due next
    this.prev = null;           // the car at the previous call: { t, x, y, a }
  }

  /**
   * `t` is race time (s). Each sample is the car's state AT its own moment
   * (i / GHOST_HZ), found between this frame and the last -- not the state of
   * whichever frame happened to come first after it, which at racing speed
   * is tens of units off and would make the ghost run a little behind.
   */
  sample(t, car) {
    const cur = { t, x: car.x, y: car.y, a: wrapAngle(car.angle) };
    const prev = this.prev ?? cur;
    while (this.next / GHOST_HZ <= t + 1e-9) {
      const at = this.next / GHOST_HZ;
      const k = t > prev.t ? Math.max(0, Math.min(1, (at - prev.t) / (t - prev.t))) : 1;
      this.x.push(prev.x + (cur.x - prev.x) * k);
      this.y.push(prev.y + (cur.y - prev.y) * k);
      this.a.push(wrapAngle(prev.a + wrapAngle(cur.a - prev.a) * k));
      this.next++;
    }
    this.prev = cur;
  }

  get length() { return this.x.length; }
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return globalThis.btoa(s);
}

function fromBase64(text) {
  const s = globalThis.atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A recorder (or any {x, y, a} arrays) as text, with the run's time in ms. */
export function encodeGhost(rec, timeMs) {
  const n = rec.x.length;
  const ints = new Int16Array(n * 3);
  for (let i = 0; i < n; i++) {
    ints[i * 3] = clamp16(rec.x[i] / POS_SCALE);
    ints[i * 3 + 1] = clamp16(rec.y[i] / POS_SCALE);
    ints[i * 3 + 2] = clamp16(rec.a[i] * ANGLE_SCALE);
  }
  return JSON.stringify({ v: 1, hz: GHOST_HZ, n, t: Math.round(timeMs), d: toBase64(new Uint8Array(ints.buffer)) });
}

/** The reverse; null for anything that is not a ghost this version wrote. */
export function decodeGhost(text) {
  try {
    const o = JSON.parse(text);
    if (!o || o.v !== 1 || !Number.isInteger(o.n) || o.n < 2 || !Number.isFinite(o.hz) || o.hz <= 0 || typeof o.d !== 'string') return null;
    const bytes = fromBase64(o.d);
    if (bytes.length !== o.n * 6) return null;
    const ints = new Int16Array(bytes.buffer, bytes.byteOffset, o.n * 3);
    const x = new Float32Array(o.n), y = new Float32Array(o.n), a = new Float32Array(o.n);
    for (let i = 0; i < o.n; i++) {
      x[i] = ints[i * 3] * POS_SCALE;
      y[i] = ints[i * 3 + 1] * POS_SCALE;
      a[i] = ints[i * 3 + 2] / ANGLE_SCALE;
    }
    return { hz: o.hz, n: o.n, timeMs: o.t, x, y, a, duration: (o.n - 1) / o.hz };
  } catch {
    return null;
  }
}

/**
 * Where the ghost is at race time `t`: { x, y, angle }, or null once its run
 * has ended (a ghost that stopped at the line would sit on it for the rest
 * of the race).
 */
export function ghostAt(g, t) {
  if (!g || t < 0 || t > g.duration) return null;
  const f = t * g.hz;
  const i = Math.min(g.n - 2, Math.floor(f));
  const k = f - i;
  let da = g.a[i + 1] - g.a[i];
  da = wrapAngle(da);
  return {
    x: g.x[i] + (g.x[i + 1] - g.x[i]) * k,
    y: g.y[i] + (g.y[i + 1] - g.y[i]) * k,
    angle: g.a[i] + da * k,
  };
}

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

const keyFor = (stageId, difficulty) => `${KEY}_${stageId}_${difficulty}`;

/** Keep a run as the stage's ghost. Returns whether it was stored. */
export function saveGhost(stageId, difficulty, rec, timeMs, store = storage()) {
  if (!store || rec.x.length < 2) return false;
  try {
    store.setItem(keyFor(stageId, difficulty), encodeGhost(rec, timeMs));
    return true;
  } catch {
    return false;                // full or refused: no ghost, the race goes on
  }
}

/** The stage's stored ghost, or null. */
export function loadGhost(stageId, difficulty, store = storage()) {
  if (!store) return null;
  try {
    const text = store.getItem(keyFor(stageId, difficulty));
    return text ? decodeGhost(text) : null;
  } catch {
    return null;
  }
}
