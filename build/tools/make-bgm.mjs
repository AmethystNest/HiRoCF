/**
 * Prepares stage BGM for embedding: decodes each recording (in headless
 * Chromium, the same decoder the game will meet), matches their loudness,
 * and re-encodes to 96 kbps stereo MP3 with lamejs, writing
 * assets/bgm/stage<N>.mp3. Run with:
 *
 *   node build/tools/make-bgm.mjs 1=<file.mp3> 2=<file.mp3> ...
 *
 * Size is the constraint: the tracks are base64'd into the single-file
 * build, and at 128 kbps five of them took it to 37 MB -- past the 30 MB a
 * file can be sent at. Hence 96 kbps, and tracks longer than MAX_SECS cut
 * there under a FADE_SECS fade (a race is over in a few minutes, so the
 * cut is never reached in play; lowering the bitrate further would be
 * heard all the time instead).
 *
 * Loudness is an EBU R128-style integrated measure (K-weighting, 400 ms
 * blocks, -70 LUFS absolute and -10 LU relative gates). Every track is
 * brought DOWN to the quietest one's loudness -- never up, so nothing is
 * pushed into clipping -- so switching stages never jumps the music level.
 *
 * assets/bgm/ is git-ignored: the tracks are commercial recordings and are
 * not redistributed with this repository. build/standalone.mjs embeds
 * whatever is there at build time, and the game runs without it.
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const jobs = process.argv.slice(2).map((a) => { const i = a.indexOf('='); return { stage: +a.slice(0, i), file: a.slice(i + 1) }; });
if (!jobs.length || jobs.some((j) => !j.stage || !fs.existsSync(j.file))) {
  console.error('usage: make-bgm.mjs <stage>=<file.mp3> ...'); process.exit(1);
}
const KBPS = 96;
const MAX_SECS = 300;
const FADE_SECS = 4;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.goto('about:blank');
await page.addScriptTag({ path: path.join(root, 'node_modules/lamejs/lame.min.js') });

// pass 1: loudness of each
const measured = [];
for (const j of jobs) {
  const b64 = fs.readFileSync(j.file).toString('base64');
  const m = await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const buf = await new OfflineAudioContext(2, 44100, 44100).decodeAudioData(bin.buffer);
    window.__buf = buf;
    const sr = buf.sampleRate;
    const oc = new OfflineAudioContext(buf.numberOfChannels, buf.length, sr);
    const s = oc.createBufferSource(); s.buffer = buf;
    const shelf = oc.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 1681; shelf.gain.value = 4;
    const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
    s.connect(shelf); shelf.connect(hp); hp.connect(oc.destination); s.start();
    const k = await oc.startRendering();
    const B = Math.round(0.4 * sr), H = Math.round(0.1 * sr), blocks = [];
    const ch = []; for (let c = 0; c < k.numberOfChannels; c++) ch.push(k.getChannelData(c));
    for (let a = 0; a + B <= k.length; a += H) {
      let e = 0; for (const d of ch) for (let i = a; i < a + B; i++) e += d[i] * d[i];
      blocks.push(e / B);
    }
    const L = (z) => -0.691 + 10 * Math.log10(z);
    let g = blocks.filter((z) => L(z) > -70);
    const rel = L(g.reduce((p, c) => p + c, 0) / g.length) - 10;
    g = g.filter((z) => L(z) > rel);
    let peak = 0; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
    return { lufs: L(g.reduce((p, c) => p + c, 0) / g.length), secs: buf.duration, peak, channels: buf.numberOfChannels, rate: sr };
  }, b64);
  measured.push({ ...j, ...m, b64 });
  console.log(`stage ${j.stage}: ${m.secs.toFixed(1)} s, ${m.lufs.toFixed(1)} LUFS, peak ${(20 * Math.log10(m.peak)).toFixed(1)} dBFS, ${m.channels} ch ${m.rate} Hz`);
}
const target = Math.min(...measured.map((m) => m.lufs));

// pass 2: gain and encode
const manifest = {};
for (const m of measured) {
  const gainDb = target - m.lufs;
  const mp3b64 = await page.evaluate(async ({ b64, gain, kbps, maxSecs, fadeSecs }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    let buf = await new OfflineAudioContext(2, 44100, 44100).decodeAudioData(bin.buffer);
    if (buf.sampleRate !== 44100) {
      const oc = new OfflineAudioContext(2, Math.ceil(buf.duration * 44100), 44100);
      const s = oc.createBufferSource(); s.buffer = buf; s.connect(oc.destination); s.start();
      buf = await oc.startRendering();
    }
    const frames = Math.min(buf.length, Math.round(maxSecs * 44100));
    const fadeFrom = frames < buf.length ? frames - Math.round(fadeSecs * 44100) : frames;
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const toI16 = (d) => {
      const o = new Int16Array(frames);
      for (let i = 0; i < frames; i++) {
        const f = i < fadeFrom ? 1 : Math.cos(((i - fadeFrom) / (frames - fadeFrom)) * Math.PI / 2);
        o[i] = Math.max(-32768, Math.min(32767, Math.round(d[i] * gain * f * 32767)));
      }
      return o;
    };
    const li = toI16(L), ri = toI16(R);
    const enc = new lamejs.Mp3Encoder(2, 44100, kbps);
    const parts = []; const N = 1152;
    for (let i = 0; i < li.length; i += N) { const b = enc.encodeBuffer(li.subarray(i, i + N), ri.subarray(i, i + N)); if (b.length) parts.push(new Uint8Array(b)); }
    const f = enc.flush(); if (f.length) parts.push(new Uint8Array(f));
    let n = 0; for (const p of parts) n += p.length;
    const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
    return btoa(s);
  }, { b64: m.b64, gain: Math.pow(10, gainDb / 20), kbps: KBPS, maxSecs: MAX_SECS, fadeSecs: FADE_SECS });
  const outFile = path.join(root, `assets/bgm/stage${m.stage}.mp3`);
  fs.writeFileSync(outFile, Buffer.from(mp3b64, 'base64'));
  manifest[m.stage] = { source: path.basename(m.file), secs: +Math.min(m.secs, MAX_SECS).toFixed(2), sourceSecs: +m.secs.toFixed(2), lufs: +(m.lufs + gainDb).toFixed(1), gainDb: +gainDb.toFixed(1), kbps: KBPS };
  console.log(`wrote ${path.relative(root, outFile)} ${(fs.statSync(outFile).size / 1048576).toFixed(2)} MB, gain ${gainDb.toFixed(1)} dB`);
}
fs.writeFileSync(path.join(root, 'assets/bgm/manifest.json'), JSON.stringify(manifest, null, 2));
await browser.close();
