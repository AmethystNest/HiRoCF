/**
 * Stage background music.
 *
 * Where the tracks come from: build/standalone.mjs embeds each prepared
 * track (assets/bgm/stage<N>.mp3, see build/tools/make-bgm.mjs) as a
 * <script type="application/octet-stream" id="bgm-<N>"> holding its
 * base64, which the browser keeps as inert text. The dev page and the
 * PWA build (build/pwa.mjs), served over http(s), have no such element and
 * play assets/bgm/stage<N>.mp3 directly instead. A stage with neither (any build made without the
 * local tracks) is simply silent -- nothing here names which stages have
 * music.
 *
 * Why an <audio> element and not decodeAudioData: a five-minute stereo
 * track decoded is ~100 MB of float PCM, which an iPhone should not be
 * asked to hold for background music; the element streams-decodes it.
 * It is routed through Web Audio (createMediaElementSource) anyway,
 * because iOS ignores HTMLMediaElement.volume entirely -- a GainNode is
 * the only way to set, fade or mute the music there.
 *
 * Why the element is handed in: iOS only lets an element play() from a
 * script if that element has once been played from inside a user gesture.
 * index.html creates it, and plays a silent clip on it, synchronously
 * inside the START tap -- the same reason it creates the AudioContext
 * there -- and every later gesture that loads a stage calls prime() to
 * keep it that way.
 */

/** Music level against the game sound. The tracks are mastered hot (-8
 *  LUFS after make-bgm.mjs evens them out), which on its own would bury
 *  the engine. At 0.3 a track's body measured -23 dBFS RMS in game against
 *  the player's engine at -13 to -15, under it far enough to be lost on a
 *  phone speaker; 0.45 put it about -19.5, which played as too loud
 *  across the board. 0.32 (-3 dB) puts it about -22.5. */
const BGM_LEVEL = 0.32;
const FADE_IN = 0.35;

export function makeBgm(ctx, bus, el) {
  const audio = el || new Audio();
  audio.loop = true;
  audio.preload = 'auto';
  let node = null;
  try {
    node = ctx.createMediaElementSource(audio);
  } catch {
    // Already attached (a second makeBgm on the same element) or no
    // support: leave the element playing straight out, level unmanaged.
  }
  const gain = ctx.createGain();
  gain.gain.value = 0;
  if (node) { node.connect(gain); gain.connect(bus); }

  let url = null;       // current source (blob: URL we own, or a path)
  let ownsUrl = false;
  let stage = null;
  let active = false;   // started for this race and not yet finished
  let stopTimer = 0;

  // Embedded tracks decoded so far, by stage. Each is decoded once: the
  // blob URL is kept for the next visit to that stage and the base64 text
  // is dropped from the page -- ~4.5 MB of string per track that a phone
  // would otherwise hold for the whole session, and a 3.5 MB decode (a
  // visible hitch on a phone) repeated on every stage load.
  const embedded = new Map();
  function sourceFor(stageId) {
    if (embedded.has(stageId)) return { url: embedded.get(stageId), owned: false };
    const tag = typeof document !== 'undefined' ? document.getElementById(`bgm-${stageId}`) : null;
    if (tag) {
      const bin = atob(tag.textContent.trim());
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
      embedded.set(stageId, url);
      tag.textContent = '';
      return { url, owned: false };
    }
    // A page built without music says so (build/pwa.mjs without
    // --with-bgm), rather than have every stage ask the server for a track
    // it knows is not there.
    if (typeof location !== 'undefined' && /^https?:/.test(location.protocol)
        && !document.querySelector('script[type="application/octet-stream"][id^="bgm-"]')
        && !document.querySelector('meta[name="hirocf-bgm"][content="none"]')) {
      return { url: `assets/bgm/stage${stageId}.mp3`, owned: false };
    }
    return null;
  }

  function ramp(to, tau) {
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.setTargetAtTime(to, t, tau);
  }

  return {
    /** Point the player at a stage's track (or at nothing), stopped. */
    load(stageId) {
      clearTimeout(stopTimer);
      active = false;
      ramp(0, 0.03);
      audio.pause();
      if (stageId === stage) { try { audio.currentTime = 0; } catch { /* not loaded yet */ } return; }
      if (ownsUrl && url) URL.revokeObjectURL(url);
      const src = sourceFor(stageId);
      stage = stageId;
      url = src?.url ?? null;
      ownsUrl = !!src?.owned;
      if (url) { audio.src = url; audio.load(); } else { audio.removeAttribute('src'); audio.load(); }
    },
    get hasTrack() { return !!url; },
    get active() { return active; },
    /**
     * Call from inside a user gesture: plays and immediately pauses the
     * (silent, gain at 0) element so iOS will let start() play it later
     * from the race clock rather than from a tap.
     */
    prime() {
      if (!url || active) return;
      const p = audio.play();
      if (p && p.then) p.then(() => { if (!active) audio.pause(); }, () => {});
      else if (!active) audio.pause();
    },
    /** Race start: from the top, faded in quickly. */
    start() {
      if (!url) return;
      clearTimeout(stopTimer);
      active = true;
      try { audio.currentTime = 0; } catch { /* not loaded yet: it starts at 0 anyway */ }
      ramp(BGM_LEVEL, FADE_IN / 3);
      const p = audio.play();
      if (p && p.catch) p.catch(() => {});
    },
    /** Pause card / page hidden. */
    pause() {
      audio.pause();
    },
    resume() {
      if (!active || !url) return;
      const p = audio.play();
      if (p && p.catch) p.catch(() => {});
    },
    /** Race over: fade out over roughly `secs`, then stop. */
    fadeOut(secs = 2.5) {
      if (!active) return;
      active = false;
      ramp(0, secs / 4);
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => { if (!active) audio.pause(); }, secs * 1000);
    },
    /** For tests/diagnostics. */
    get element() { return audio; },
    get level() { return gain.gain.value; },
  };
}
