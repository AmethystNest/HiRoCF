/**
 * Every sound in the game, synthesised with the Web Audio API rather than
 * played from audio files -- there are no source recordings to embed, and
 * generating them keeps the single-file HTML self-contained the same way
 * the car photo processing and the contactfx/boostfx particle textures do
 * (drawn once from code, not loaded).
 *
 * The AudioContext itself is NOT created here. Browsers only allow audio
 * to start from inside a synchronous user-gesture handler, and by the
 * time this module runs (after a dynamic import, after boot()'s own
 * awaits) that window has long closed. index.html creates the context at
 * the very top of the START tap handler, before anything async, and
 * hands it in here.
 *
 * @param ctx  an AudioContext, already created (and ideally already
 *             resumed) by the caller.
 */
export function buildAudio(ctx) {
  const master = ctx.createGain();
  // A compressor on the master bus, not tuned per-sound: several one-shots
  // landing on the same frame (a wall hit while the engine is loud and a
  // nitro whoosh is still ringing) would otherwise be free to sum past 1
  // and clip. Cheap insurance since nothing here was tunable by ear.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 12;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  master.connect(limiter);
  limiter.connect(ctx.destination);

  let muted = false;
  try {
    muted = localStorage.getItem('hirocf_muted') === '1';
  } catch {
    // localStorage can throw (private mode, disabled storage) -- default
    // to sound on rather than fail the whole module over a preference.
  }
  master.gain.value = muted ? 0 : 1;

  function setMuted(v) {
    muted = !!v;
    master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.03);
    try {
      localStorage.setItem('hirocf_muted', muted ? '1' : '0');
    } catch {
      /* see above */
    }
  }

  // One shared noise buffer, looped by every noise-based sound instead of
  // each generating (and GC-ing) its own -- a second of white noise is the
  // only source material a crash, a whoosh and a rumble all need; only the
  // filter on top changes what it becomes.
  const noiseBuffer = (() => {
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  })();

  /** A single oscillator note: attack, then an exponential decay to
   *  silence. `freqEnd`, if given, sweeps the pitch across the note --
   *  what turns a plain tone into a "whoosh" or a "horn" rise. `delay`
   *  schedules it in the future on the AudioContext's own clock, which
   *  is how every multi-note sound below is sequenced -- sample-accurate,
   *  and it keeps this module free of setTimeout/JS-timer jitter. */
  function tone({ freq = 440, freqEnd = null, type = 'sine', dur = 0.15, gain = 0.3, attack = 0.004, delay = 0 }) {
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** A burst of filtered noise: a crash's crunch, a whoosh's air, a
   *  rumble's grain -- the filter type/frequency is what tells them
   *  apart, not the source. */
  function noise({ dur = 0.2, gain = 0.4, filterType = 'bandpass', filterFreq = 1200, q = 0.8 }) {
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.value = filterFreq;
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // --- one-shots, in roughly the order they occur in a race ------------

  /** A light UI tick -- menu buttons only (pause, stage pick, VIEW, the
   *  result card's NEXT STAGE), never the driving pads: those fire every
   *  frame they're held, and a click on every one would be a buzz, not
   *  a tick. */
  function click() {
    tone({ freq: 900, type: 'square', dur: 0.045, gain: 0.10, attack: 0.001 });
  }

  /** One beep per countdown numeral, pitched a little higher as it counts
   *  down to zero -- `n` is the numeral just shown (3, 2, 1). */
  function countBeep(n) {
    tone({ freq: 480 + (3 - n) * 90, type: 'sine', dur: 0.13, gain: 0.30 });
  }

  /** The green light. Distinct in both pitch and shape from the count
   *  beeps -- a rising horn, not another dot. */
  function go() {
    tone({ freq: 520, freqEnd: 880, type: 'sawtooth', dur: 0.30, gain: 0.34 });
  }

  /**
   * Nitro firing. `strength` scales the player's own press (1) down for
   * the rival's (see main.js) -- the player's own nitro is a foreground
   * event, the rival's is ambience.
   */
  function whoosh(strength = 1) {
    noise({ dur: 0.40, gain: 0.24 * strength, filterType: 'bandpass', filterFreq: 1700, q: 0.6 });
    tone({ freq: 190, freqEnd: 55, type: 'sawtooth', dur: 0.38, gain: 0.16 * strength, attack: 0.01 });
  }

  /** A wall or a rival, hit hard enough to be an impact rather than a
   *  graze. `strength` is player.contact.force convention (0..1) -- see
   *  contact.js -- scaled down again for the rival's own hits. */
  function crash(strength = 1) {
    noise({ dur: 0.20, gain: 0.46 * strength, filterType: 'lowpass', filterFreq: 900, q: 0.4 });
    tone({ freq: 95, type: 'sine', dur: 0.16, gain: 0.32 * strength, attack: 0.001 });
  }

  /** A quieter, coarser variant for the ongoing scrape rather than the
   *  first hit -- called sparingly by the caller (see main.js's
   *  contactSfxAccum), not once per frame of contact. */
  function scrape(strength = 1) {
    noise({ dur: 0.10, gain: 0.14 * strength, filterType: 'bandpass', filterFreq: 2200, q: 1.4 });
  }

  /** Checkpoint lap. */
  function lapChime() {
    tone({ freq: 784, type: 'triangle', dur: 0.14, gain: 0.26 });
    tone({ freq: 1047, type: 'triangle', dur: 0.20, gain: 0.26, delay: 0.085 });
  }

  /** Final lap. A harder, more urgent double-beep than the lap chime,
   *  not a prettier version of it -- the visual banner it lines up with
   *  is red and insistent for the same reason. */
  function finalLap() {
    tone({ freq: 660, type: 'square', dur: 0.10, gain: 0.28 });
    tone({ freq: 660, type: 'square', dur: 0.10, gain: 0.28, delay: 0.14 });
  }

  /** The finish. A rising major arpeggio for a win, a falling minor one
   *  for anything else -- same grade split finishfx.js draws the
   *  celebration in. */
  function fanfare(win) {
    const notes = win ? [523, 659, 784, 1047] : [392, 349, 311];
    const type = win ? 'triangle' : 'sine';
    const gain = win ? 0.30 : 0.26;
    const step = win ? 0.10 : 0.15;
    notes.forEach((freq, i) => tone({ freq, type, dur: win ? 0.28 : 0.42, gain, delay: i * step }));
  }

  // --- engine: the one continuous sound --------------------------------
  /**
   * One running engine voice. Two slightly detuned sawtooths (a classic
   * cheap-synth trick for a fuller, less pure-tone growl than a single
   * oscillator gives) through a lowpass filter that brightens with revs,
   * so the car sounds like it is working harder as it accelerates rather
   * than just getting louder.
   *
   * `baseGain` is the voice's ceiling -- the rival's engine is built at a
   * fraction of the player's, so it reads as present without competing
   * with the car actually being driven.
   */
  function makeEngine(baseGain) {
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.detune.value = 9;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 300;
    filt.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0;
    osc1.connect(filt);
    osc2.connect(filt);
    filt.connect(g);
    g.connect(master);
    osc1.frequency.value = 55;
    osc2.frequency.value = 55;
    osc1.start();
    osc2.start();
    let stopped = false;

    return {
      /** @param speed 0..maxSpeed, @param boosting bool, @param maxSpeed PHYSICS.maxSpeed */
      update(speed, boosting, maxSpeed) {
        if (stopped) return;
        const r = Math.max(0, Math.min(1, speed / Math.max(1, maxSpeed)));
        const t = ctx.currentTime;
        const freq = 52 + r * 150 + (boosting ? 45 : 0);
        osc1.frequency.setTargetAtTime(freq, t, 0.07);
        osc2.frequency.setTargetAtTime(freq, t, 0.07);
        filt.frequency.setTargetAtTime(280 + r * 1500 + (boosting ? 700 : 0), t, 0.1);
        g.gain.setTargetAtTime(baseGain * (0.45 + 0.55 * r) * (boosting ? 1.25 : 1), t, 0.06);
      },
      /** Fully silent (grid, pause, finish) without tearing the voice
       *  down and rebuilding it -- gain to 0 is cheaper and click-free
       *  next to setTargetAtTime's own smoothing. */
      silence() {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      },
      stop() {
        stopped = true;
        try { osc1.stop(); osc2.stop(); } catch { /* already stopped */ }
      },
    };
  }

  return {
    get muted() { return muted; },
    setMuted,
    click, countBeep, go, whoosh, crash, scrape, lapChime, finalLap, fanfare,
    makeEngine,
  };
}
