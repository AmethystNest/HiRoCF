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
  /**
   * The player's engine: a 5.0 V8 through an 8-speed box, built to match a
   * reference recording of one (a GT7 capture of an RC F pulling from 140
   * km/h) rather than tuned by ear. Nothing of the recording is shipped --
   * it was analysed, and these are the numbers that came out of it.
   *
   * What the analysis said, and what each part of this is for:
   *
   * - A four-stroke repeats once every TWO crank revolutions, so its real
   *   fundamental is the HALF order, rpm/120, and every half order is a
   *   true harmonic of it. The reference shows that plainly: at 3,360 rpm
   *   its 1.5 order stands at 0.89 of the strongest partial and its 2.5 at
   *   0.40. That off-beat half-order family IS the cross-plane V8 burble,
   *   and it is the one thing a sawtooth (integer orders only, which is
   *   what the rival still runs) cannot produce at all. The oscillator
   *   below therefore runs at rpm/120 with a PeriodicWave whose harmonic
   *   index k is order k/2 -- one node for the whole order stack.
   *
   * - Its spectrum peaks in 80-160 Hz at every engine speed, which cannot
   *   be a harmonic (those move with rpm) and is the exhaust/body
   *   resonance. That is the 135 Hz peaking filter, and it is what makes
   *   whichever order happens to land on it dominate -- exactly what the
   *   reference does, where order 2 leads at 3,000 rpm and order 1 leads
   *   at 6,900 rpm without the engine changing.
   *
   * - Above that it falls about 6 dB per octave to 2.5 kHz and then
   *   steeply: the source slope, the second shelf at 350 Hz and the
   *   low-pass together. Roughly half the total energy is broadband
   *   rather than tonal (measured tonal share 0.42-0.65), which is the
   *   noise layer.
   *
   * Fitted by coordinate descent against the recording's own octave-band
   * shape at 4,100 / 5,800 / 6,700 rpm; the residual is 2.3-3.5 dB per
   * band, against 8+ dB for the sawtooth pair this replaced.
   */
  const V8_SLOPE = 0.6;        // source falls as order^-0.6 before filtering
  const V8_HALF_ORDER = 0.65;  // half orders, relative to the integer ones
  const V8_IDLE_RPM = 850;
  const V8_REDLINE_RPM = 7000;
  /**
   * Top speed of each of the 8 gears, as a fraction of PHYSICS.maxSpeed.
   * The steps narrow as they climb (1.67, 1.40, 1.31, 1.26, 1.22, 1.20,
   * 1.18), which is both what a real box does and what the reference
   * measures: its three clean upshifts drop 7,020 -> 5,910, 6,900 ->
   * 5,640 and 7,020 -> 5,970 rpm, i.e. ratios of 1.19, 1.22 and 1.18.
   * Landing rpm here comes out 5,720-5,950 for the same shifts.
   */
  const V8_GEAR_TOP = [0.15, 0.25, 0.35, 0.46, 0.58, 0.71, 0.85, 1.0];
  /** Torque cut on an upshift: how long, and how far the note drops. */
  const V8_SHIFT_TIME = 0.11;
  const V8_SHIFT_DUCK = 0.42;

  let v8WaveCache = null;
  function v8Wave() {
    if (v8WaveCache) return v8WaveCache;
    const N = 2 * 24 + 1;                 // orders up to the 12th, in halves
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    for (let k = 1; k < N; k++) {
      const order = k / 2;
      let a = Math.pow(order, -V8_SLOPE);
      if (!Number.isInteger(order)) a *= V8_HALF_ORDER;
      if (order === 1) a *= 1.15;         // crank order, the one that carries
      if (order === 4) a *= 1.8;          // firing order of a V8: 8 cyl / 2
      imag[k] = a;
    }
    v8WaveCache = ctx.createPeriodicWave(real, imag);
    return v8WaveCache;
  }

  /** @param baseGain same contract as makeEngine's. */
  function makeV8Engine(baseGain) {
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(v8Wave());
    osc.frequency.value = V8_IDLE_RPM / 120;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 75; hp.Q.value = 0.7;
    const body = ctx.createBiquadFilter();
    body.type = 'peaking'; body.frequency.value = 135; body.Q.value = 0.7; body.gain.value = 7;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = 350; mid.Q.value = 0.8; mid.gain.value = 3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
    const toneGain = ctx.createGain();
    toneGain.gain.value = 0;
    osc.connect(hp); hp.connect(body); body.connect(mid); mid.connect(lp); lp.connect(toneGain);

    // Induction/turbulence: the half of the energy that is not tonal.
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer; noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(nf); nf.connect(noiseGain);

    toneGain.connect(master);
    noiseGain.connect(master);
    osc.start();
    noise.start();

    let gear = 0;
    let shiftUntil = 0;
    let stopped = false;

    return {
      /** Same signature as makeEngine's: speed 0..maxSpeed, nitro flag. */
      update(speed, boosting, maxSpeed) {
        if (stopped) return;
        const t = ctx.currentTime;
        const sf = Math.max(0, Math.min(1, speed / Math.max(1, maxSpeed)));

        // One step per call: at 60fps nothing can cross two gears in a frame,
        // and the 0.93 on the way back down is the hysteresis that stops it
        // hunting when the car sits exactly on a shift point.
        if (gear < 7 && sf > V8_GEAR_TOP[gear]) { gear++; shiftUntil = t + V8_SHIFT_TIME; }
        else if (gear > 0 && sf < V8_GEAR_TOP[gear - 1] * 0.93) gear--;

        const rpm = Math.min(
          V8_REDLINE_RPM,
          V8_IDLE_RPM + (V8_REDLINE_RPM - V8_IDLE_RPM) * Math.min(1, sf / V8_GEAR_TOP[gear]),
        ) * (boosting ? 1.04 : 1);
        const shifting = t < shiftUntil;
        // Through the cut the note has to fall as fast as the clutch opens,
        // or the drop reads as the engine bogging rather than as a shift.
        const glide = shifting ? 0.025 : 0.05;

        osc.frequency.setTargetAtTime(rpm / 120, t, glide);
        const load = 0.35 + 0.65 * sf;
        lp.frequency.setTargetAtTime(500 + rpm * 0.10 + (boosting ? 500 : 0), t, 0.08);
        nf.frequency.setTargetAtTime(800 + rpm * 0.10, t, 0.08);
        const duck = shifting ? V8_SHIFT_DUCK : 1;
        toneGain.gain.setTargetAtTime(baseGain * load * duck * (boosting ? 1.2 : 1), t, glide);
        // 0.10 of the tone, which is where the fit put it: the recording's
        // energy above 5 kHz sits 34 dB under its peak, and a noise layer
        // any louder than this buries that roll-off in hiss.
        noiseGain.gain.setTargetAtTime(baseGain * 0.10 * load * duck, t, 0.06);
      },
      silence() {
        const t = ctx.currentTime;
        toneGain.gain.setTargetAtTime(0, t, 0.08);
        noiseGain.gain.setTargetAtTime(0, t, 0.08);
      },
      stop() {
        stopped = true;
        try { osc.stop(); noise.stop(); } catch { /* already stopped */ }
      },
    };
  }

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
    makeEngine, makeV8Engine,
  };
}
