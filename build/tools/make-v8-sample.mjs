/**
 * Builds src/audio/v8sample.js from a recording of a V8 pulling through a
 * gear at full throttle -- the source for the player's sampled engine
 * (see makeSampledV8Engine in src/audio/sfx.js). Run with:
 *
 *   node build/tools/make-v8-sample.mjs <recording.mp3> <from s> <to s>
 *
 * The recording itself is NOT in the repository; only the processed
 * segment this writes is. The DSP runs in headless Chromium (decodeAudio-
 * Data does the MP3 decode, the same decoder class the game ships against),
 * so this needs the Playwright install the dev notes describe.
 *
 * What it does:
 *  1. Decodes, sums to mono, cuts [from, to].
 *  2. Tracks engine speed from the harmonic spacing of the spectrum: a
 *     four-stroke repeats every two revolutions, so its partials sit on
 *     multiples of rpm/120 (see makeV8Engine's notes). The spacing is found
 *     by comparing log-magnitude ON each candidate's harmonics against
 *     half-way BETWEEN them, which rejects the half-spacing octave error a
 *     plain comb falls into. A cubic fit smooths the track.
 *  3. Places a pitch mark at the start of every engine cycle: integrates
 *     the fitted rate for a first guess, then snaps each mark to where the
 *     cycle best matches the one before it (normalised cross-correlation,
 *     on a low-passed copy so the match is on the firing pattern rather
 *     than on hiss). Grains cut between these marks are phase-aligned with
 *     each other, which is what lets the engine voice overlap-add them
 *     without comb-filtering.
 *  4. Resamples 44.1 -> 22.05 kHz (windowed-sinc low-pass at 10 kHz; the
 *     segment carries nothing above 11 kHz within 55 dB of its peak) and
 *     writes 16-bit PCM, base64, with the marks and the rpm at each.
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';

const [src, fromS, toS] = process.argv.slice(2);
if (!src) { console.error('usage: make-v8-sample.mjs <recording.mp3> <from s> <to s>'); process.exit(1); }
const b64 = fs.readFileSync(src).toString('base64');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.goto('about:blank');
const out = await page.evaluate(async ({ b64, from, to }) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const buf = await ctx.decodeAudioData(bin.buffer);
  const sr = buf.sampleRate, nch = buf.numberOfChannels;
  const a = Math.round(from * sr), b = Math.round(to * sr), n = b - a;
  const x = new Float32Array(n);
  for (let c = 0; c < nch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) x[i] += d[a + i] / nch; }

  function fft(re, im) {
    const N = re.length;
    for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= N; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < N; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  // 2. spacing track, 25 ms hop, 0.05 Hz steps around the coarse best
  const NFFT = 8192, HOP = Math.round(sr * 0.025), binHz = sr / NFFT;
  const T = [], F = [];
  for (let s = 0; s + NFFT <= n; s += HOP) {
    const re = new Float32Array(NFFT), im = new Float32Array(NFFT);
    for (let i = 0; i < NFFT; i++) re[i] = x[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / NFFT));
    fft(re, im);
    const lm = new Float32Array(NFFT / 2);
    for (let k = 0; k < NFFT / 2; k++) lm[k] = Math.log(1e-6 + Math.hypot(re[k], im[k]));
    const at = (f) => { const p = f / binHz, k = Math.floor(p), u = p - k; return lm[k] * (1 - u) + lm[k + 1] * u; };
    const score = (f) => { let on = 0, off = 0, c = 0;
      for (let k = 1; k <= 20; k++) { if ((k + 0.5) * f > 1400) break; on += at(k * f); off += at((k + 0.5) * f); c++; }
      return (on - off) / c; };
    let best = -1e9, bf = 0;
    for (let f = 20; f <= 70; f += 0.25) { const s2 = score(f); if (s2 > best) { best = s2; bf = f; } }
    for (let f = bf - 0.3; f <= bf + 0.3; f += 0.02) { const s2 = score(f); if (s2 > best) { best = s2; bf = f; } }
    T.push((s + NFFT / 2) / sr); F.push(bf);
  }
  // cubic least squares f0(t)
  const P = 4, A = Array.from({ length: P }, () => new Float64Array(P + 1));
  const tm = T[T.length - 1];
  for (let i = 0; i < T.length; i++) { const u = T[i] / tm; const pw = [1, u, u * u, u * u * u];
    for (let r = 0; r < P; r++) { for (let c = 0; c < P; c++) A[r][c] += pw[r] * pw[c]; A[r][P] += pw[r] * F[i]; } }
  for (let c = 0; c < P; c++) { let p = c; for (let r = c + 1; r < P; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < P; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= P; k++) A[r][k] -= f * A[c][k]; } }
  const coef = A.map((row, i) => row[P] / row[i]);
  const f0 = (t) => { const u = t / tm; return coef[0] + coef[1] * u + coef[2] * u * u + coef[3] * u * u * u; };
  let resid = 0; for (let i = 0; i < T.length; i++) resid += (F[i] - f0(T[i])) ** 2; resid = Math.sqrt(resid / T.length);

  // 3. pitch marks on a low-passed copy (one-pole x2 at ~900 Hz)
  const lp = new Float32Array(n); { const al = 1 - Math.exp(-2 * Math.PI * 900 / sr); let y1 = 0, y2 = 0;
    for (let i = 0; i < n; i++) { y1 += al * (x[i] - y1); y2 += al * (y1 - y2); lp[i] = y2; } }
  const ncc = (p, q, L) => { let s = 0, e1 = 0, e2 = 0; for (let i = 0; i < L; i++) { const u = lp[p + i], v = lp[q + i]; s += u * v; e1 += u * u; e2 += v * v; } return s / Math.sqrt(e1 * e2 + 1e-12); };
  const marks = [Math.round(0.05 * sr)], corr = [];
  for (;;) {
    const m = marks[marks.length - 1];
    const per = sr / f0(m / sr);
    const L = Math.round(per);
    if (m + 2.3 * per + L >= n) break;
    let best = -2, bq = Math.round(m + per);
    for (let q = Math.round(m + 0.9 * per); q <= Math.round(m + 1.1 * per); q++) { const c = ncc(m, q, L); if (c > best) { best = c; bq = q; } }
    marks.push(bq); corr.push(best);
  }
  const rpm = marks.map((m, j) => { const lo = Math.max(0, j - 3), hi = Math.min(marks.length - 1, j + 3); return 120 * sr * (hi - lo) / (marks[hi] - marks[lo]); });

  // 4. resample to 22050 (factor 2): windowed sinc, cutoff 10 kHz
  const TAPS = 63, fc = 10000 / sr, h = new Float32Array(TAPS); let hs = 0;
  for (let i = 0; i < TAPS; i++) { const k = i - (TAPS - 1) / 2; const s0 = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
    const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (TAPS - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (TAPS - 1)); h[i] = s0 * w; hs += h[i]; }
  const m2 = Math.floor(n / 2), y = new Int16Array(m2);
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]));
  const norm = 0.95 / peak;
  for (let i = 0; i < m2; i++) { let s = 0; for (let k = 0; k < TAPS; k++) { const j = 2 * i + k - (TAPS - 1) / 2; if (j >= 0 && j < n) s += x[j] * h[k]; }
    y[i] = Math.max(-32767, Math.min(32767, Math.round(s / hs * norm * 32767))); }
  let bin2 = ''; const bytes = new Uint8Array(y.buffer); for (let i = 0; i < bytes.length; i += 0x8000) bin2 += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return {
    rate: sr / 2, pcm: btoa(bin2), marks: marks.map((m) => Math.round(m / 2)), rpm: rpm.map((r) => Math.round(r)),
    stats: { secs: n / sr, residHz: resid, cycles: marks.length - 1, corrMin: Math.min(...corr), corrMedian: corr.slice().sort((p, q) => p - q)[corr.length >> 1], rpmFrom: Math.round(rpm[0]), rpmTo: Math.round(rpm[rpm.length - 1]), gain: norm },
  };
}, { b64, from: +fromS, to: +toS });
await browser.close();
console.log(JSON.stringify(out.stats));
const file = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../src/audio/v8sample.js');
fs.writeFileSync(file, `/**
 * GENERATED by build/tools/make-v8-sample.mjs -- do not edit by hand.
 *
 * ${out.stats.secs.toFixed(2)} s of a V8 at full throttle, climbing ${out.stats.rpmFrom} -> ${out.stats.rpmTo} rpm in one gear,
 * mono 16-bit PCM at ${out.rate} Hz (little-endian, base64). \`marks\` are the sample
 * index of the start of each engine cycle (two crank revolutions), \`rpm\`
 * the engine speed there. Used by makeSampledV8Engine in sfx.js.
 */
export const V8_SAMPLE = {
  rate: ${out.rate},
  marks: [${out.marks.join(',')}],
  rpm: [${out.rpm.join(',')}],
  pcm: '${out.pcm}',
};
`);
console.log('wrote', file, (fs.statSync(file).size / 1024).toFixed(0), 'KB');
