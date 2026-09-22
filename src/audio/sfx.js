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
import { V8_SAMPLE } from './v8sample.js';
import { SQUEAL_SAMPLE } from './squealsample.js';

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
  // Last stage before the output, shared with the music bus below: a
  // safety limiter only, well above where either side sits on its own, so
  // it touches nothing but the odd peak where music and a crash coincide
  // -- the two summed straight into the output could otherwise clip.
  const out = ctx.createDynamicsCompressor();
  out.threshold.value = -4;
  out.knee.value = 4;
  out.ratio.value = 12;
  out.attack.value = 0.002;
  out.release.value = 0.1;
  out.connect(ctx.destination);
  limiter.connect(out);

  let muted = false;
  try {
    muted = localStorage.getItem('hirocf_muted') === '1';
  } catch {
    // localStorage can throw (private mode, disabled storage) -- default
    // to sound on rather than fail the whole module over a preference.
  }
  master.gain.value = muted ? 0 : 1;
  // Music has its own bus straight to the output, not through `master`:
  // the limiter there is set for the game's own sounds, and hot, already
  // mastered music through it would pump the engine up and down with the
  // beat. The mute switch covers both.
  const music = ctx.createGain();
  music.gain.value = muted ? 0 : 1;
  music.connect(out);

  function setMuted(v) {
    muted = !!v;
    master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.03);
    music.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.03);
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

  // --- one-shot toolkit ------------------------------------------------
  /**
   * A shared room for the one-shots: a convolution reverb on a generated
   * impulse (stereo, decorrelated noise under a 0.5 s exponential decay
   * that darkens as it goes), fed by a per-sound send. A dry beep is what
   * made the old cues sound like a toy -- every arcade cabinet's are
   * mixed into a space. Built once; the IR is 1.6 s.
   */
  const reverb = ctx.createConvolver();
  reverb.buffer = (() => {
    const sr = ctx.sampleRate, n = Math.round(1.6 * sr);
    const buf = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        // one-pole low-pass whose cutoff falls with time: bright early
        // reflections, dull tail
        const k = 0.9 * Math.exp(-t / 0.35) + 0.05;
        lp += k * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-t / 0.5) * (t < 0.012 ? t / 0.012 : 1);
      }
    }
    return buf;
  })();
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.55;
  reverb.connect(reverbReturn);
  reverbReturn.connect(master);

  /**
   * Level trim for whichever one-shot is being built (see `trimmed`): each
   * cue is designed at full size and then set into the mix here, so its
   * layers keep their balance with each other. Every node a cue makes is
   * created synchronously inside its own call, so a module-level value
   * read by outlet() is enough.
   */
  let cueLevel = 1;
  function trimmed(db, fn) {
    return (...args) => {
      cueLevel = Math.pow(10, db / 20);
      try { fn(...args); } finally { cueLevel = 1; }
    };
  }

  /** Output stage for one sound: dry to the master, `send` of it to the
   *  room, panned. Returns the node to connect the sound into. */
  function outlet({ pan = 0, send = 0 } = {}) {
    const inp = ctx.createGain();
    inp.gain.value = cueLevel;
    let tail = inp;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      inp.connect(p);
      tail = p;
    }
    tail.connect(master);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      tail.connect(s);
      s.connect(reverb);
    }
    return inp;
  }

  /**
   * One synth voice: `waves` oscillators (type, detune in cents, pan) at
   * `freq`, an optional pitch drop from `freq * pitchFrom` over `pitchTime`
   * (the "tick" at the front of an arcade bleep), a low-pass that opens to
   * `cutoff` and falls back to `cutoffEnd`, and an attack/hold/decay
   * envelope. Everything scheduled on the context clock from `delay`.
   */
  function synth({
    freq, delay = 0, gain = 0.2, attack = 0.004, hold = 0.05, decay = 0.25,
    waves = [['sawtooth', 0, 0]], cutoff = 4000, cutoffEnd = 800, q = 1,
    pitchFrom = 1, pitchTime = 0.03, glideTo = null, send = 0.2,
  }) {
    const t0 = ctx.currentTime + delay;
    const end = t0 + attack + hold + decay;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = q;
    f.frequency.setValueAtTime(cutoff, t0);
    f.frequency.setTargetAtTime(cutoffEnd, t0 + attack, (hold + decay) / 3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.setValueAtTime(gain, t0 + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    f.connect(g);
    g.connect(outlet({ send }));
    for (const [type, cents, pan] of waves) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = cents;
      o.frequency.setValueAtTime(freq * pitchFrom, t0);
      if (pitchFrom !== 1) o.frequency.exponentialRampToValueAtTime(freq, t0 + pitchTime);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, end);
      let node = o;
      if (pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        o.connect(p);
        node = p;
      }
      node.connect(f);
      o.start(t0);
      o.stop(end + 0.05);
    }
  }

  /** Seven-voice supersaw spread across the stereo field: the thick,
   *  bright stab every arcade racer's cues are made of. */
  const SUPERSAW = [
    ['sawtooth', 0, 0], ['sawtooth', -11, -0.5], ['sawtooth', 11, 0.5],
    ['sawtooth', -23, -0.85], ['sawtooth', 23, 0.85], ['square', -6, -0.25], ['square', 6, 0.25],
  ];

  /** Sub drop: a sine falling an octave or two, the "boom" under a hit. */
  function boom({ from = 120, to = 40, dur = 0.45, gain = 0.4, delay = 0 }) {
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(from, t0);
    o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(outlet());
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  /** Filtered noise with its filter swept from `f0` to `f1`: whooshes,
   *  risers, air, debris, cymbal wash. */
  function sweep({ f0 = 800, f1 = 4000, type = 'bandpass', q = 1, dur = 0.4, gain = 0.2, attack = 0.01, delay = 0, send = 0.2, pan = 0 }) {
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer; src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g);
    g.connect(outlet({ send, pan }));
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.05);
  }

  /** FM bell: sine carrier, sine modulator at a non-integer ratio whose
   *  index decays faster than the note -- the metallic strike dies first,
   *  the tone rings on, which is what a bell does. */
  function bell({ freq, delay = 0, gain = 0.2, dur = 0.9, ratio = 3.5, index = 3, send = 0.45, pan = 0 }) {
    const t0 = ctx.currentTime + delay;
    const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = freq;
    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = freq * ratio;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(freq * index, t0);
    mg.gain.exponentialRampToValueAtTime(freq * 0.05, t0 + dur * 0.5);
    mod.connect(mg); mg.connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    car.connect(g);
    g.connect(outlet({ send, pan }));
    car.start(t0); mod.start(t0);
    car.stop(t0 + dur + 0.05); mod.stop(t0 + dur + 0.05);
  }

  /** Metal: a handful of inharmonic partials struck together and ringing
   *  down fast -- a panel taking a hit rather than a drum. */
  function clank({ base = 480, gain = 0.12, dur = 0.28, delay = 0, send = 0.15 }) {
    const ratios = [1, 2.31, 3.87, 5.43, 7.19];
    ratios.forEach((r, i) => {
      const t0 = ctx.currentTime + delay;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * r * (0.97 + Math.random() * 0.06);
      const g = ctx.createGain();
      const d = dur / (1 + i * 0.35);
      g.gain.setValueAtTime(gain / (1 + i * 0.5), t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g);
      g.connect(outlet({ send, pan: (i % 2 ? 0.3 : -0.3) }));
      o.start(t0);
      o.stop(t0 + d + 0.05);
    });
  }

  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  // --- one-shots, in roughly the order they occur in a race ------------

  /** A light UI tick -- menu buttons only (pause, stage pick, VIEW, the
   *  result card's NEXT STAGE), never the driving pads: those fire every
   *  frame they're held, and a click on every one would be a buzz, not
   *  a tick. A short glassy blip with a hair of air on it. */
  function click() {
    synth({ freq: 2093, pitchFrom: 1.5, pitchTime: 0.012, waves: [['triangle', 0, 0]], gain: 0.10, attack: 0.001, hold: 0.004, decay: 0.05, cutoff: 9000, cutoffEnd: 5000, send: 0.12 });
    sweep({ f0: 7000, f1: 5000, type: 'highpass', q: 0.7, dur: 0.03, gain: 0.05, attack: 0.001, send: 0 });
  }

  /**
   * One per countdown numeral (3, 2, 1): the same note each time -- the
   * arcade convention, so GO's jump an octave up is the event -- as a
   * supersaw stab with a pitch tick at the front, an octave-down square
   * underneath for weight, a filter that snaps shut, and room behind it.
   */
  const COUNT_NOTE = 76;   // E5
  function countBeep() {
    const f = hz(COUNT_NOTE);
    synth({ freq: f, waves: SUPERSAW, gain: 0.075, attack: 0.003, hold: 0.09, decay: 0.28, cutoff: 7500, cutoffEnd: 1400, q: 2, pitchFrom: 1.06, pitchTime: 0.02, send: 0.35 });
    synth({ freq: f / 2, waves: [['square', 0, 0]], gain: 0.10, attack: 0.003, hold: 0.08, decay: 0.2, cutoff: 2500, cutoffEnd: 600, send: 0.1 });
    boom({ from: 160, to: 55, dur: 0.18, gain: 0.22 });
  }

  /**
   * GO: the octave above the count, as a full chord (root, fifth, octave)
   * held and opened up, over a sub drop and a rising air sweep, with a
   * long tail in the room. Heard as the release of the three beeps before
   * it rather than as a fourth.
   */
  function go() {
    const r = COUNT_NOTE + 12;
    [0, 7, 12].forEach((iv, i) => synth({
      freq: hz(r + iv), waves: SUPERSAW, gain: 0.055 - i * 0.008, attack: 0.004, hold: 0.32, decay: 0.75,
      cutoff: 9000, cutoffEnd: 2200, q: 1.5, pitchFrom: 1.03, pitchTime: 0.03, send: 0.5,
    }));
    synth({ freq: hz(r - 24), waves: [['sawtooth', 0, -0.2], ['sawtooth', 8, 0.2]], gain: 0.10, attack: 0.004, hold: 0.3, decay: 0.6, cutoff: 1800, cutoffEnd: 300, send: 0.2 });
    boom({ from: 150, to: 38, dur: 0.7, gain: 0.45 });
    sweep({ f0: 600, f1: 7000, type: 'bandpass', q: 0.9, dur: 0.55, gain: 0.12, attack: 0.02, send: 0.4 });
  }

  /**
   * Nitro firing. `strength` scales the player's own press (1) down for
   * the rival's (see main.js) -- the player's own nitro is a foreground
   * event, the rival's is ambience. A pressurised hiss sweeping up (the
   * valve), a low thump (the charge hitting), and a filtered rumble that
   * rolls off with it (the flame).
   */
  function whoosh(strength = 1) {
    sweep({ f0: 350, f1: 4200, type: 'bandpass', q: 1.3, dur: 0.5, gain: 0.26 * strength, attack: 0.015, send: 0.18 });
    sweep({ f0: 9000, f1: 3000, type: 'highpass', q: 0.7, dur: 0.22, gain: 0.08 * strength, attack: 0.004, send: 0.1 });
    boom({ from: 110, to: 42, dur: 0.35, gain: 0.3 * strength });
    synth({ freq: 55, glideTo: 38, waves: [['sawtooth', 0, -0.3], ['sawtooth', 13, 0.3]], gain: 0.12 * strength, attack: 0.02, hold: 0.12, decay: 0.45, cutoff: 900, cutoffEnd: 180, send: 0.1 });
  }

  /** A wall or a rival, hit hard enough to be an impact rather than a
   *  graze. `strength` is player.contact.force convention (0..1) -- see
   *  contact.js -- scaled down again for the rival's own hits. A sub
   *  thump for the mass, a low-passed crunch for the body, a ring of
   *  bent metal and a spray of high debris on top. */
  function crash(strength = 1) {
    const s = Math.max(0.05, strength);
    boom({ from: 95, to: 32, dur: 0.3, gain: 0.42 * s });
    sweep({ f0: 2600, f1: 350, type: 'lowpass', q: 0.6, dur: 0.28, gain: 0.42 * s, attack: 0.002, send: 0.15 });
    clank({ base: 380 + Math.random() * 180, gain: 0.07 * s, dur: 0.32, send: 0.18 });
    sweep({ f0: 6500, f1: 3500, type: 'highpass', q: 0.8, dur: 0.16, gain: 0.10 * s, attack: 0.001, delay: 0.012, send: 0.1 });
  }

  /** A quieter, coarser variant for the ongoing scrape rather than the
   *  first hit -- called sparingly by the caller (see main.js's
   *  contactSfxAccum), not once per frame of contact. Metal on concrete:
   *  noise through a few narrow, inharmonic bands, which is what gives a
   *  grind its screech instead of a hiss. */
  function scrape(strength = 1) {
    const jitter = 0.9 + Math.random() * 0.2;
    [1900, 3150, 4700].forEach((f, i) => sweep({
      f0: f * jitter, f1: f * jitter * 0.93, type: 'bandpass', q: 9, dur: 0.13, gain: (0.16 - i * 0.03) * strength, attack: 0.004, send: 0.08, pan: i - 1 ? 0.2 : -0.2,
    }));
    sweep({ f0: 1200, f1: 600, type: 'lowpass', q: 0.5, dur: 0.1, gain: 0.08 * strength, attack: 0.003, send: 0 });
  }

  /** Checkpoint lap: two bell strikes a fourth apart, bright and quick,
   *  ringing on in the room -- a pass, not an alarm. */
  function lapChime() {
    bell({ freq: hz(83), gain: 0.16, dur: 0.8, pan: -0.15 });                 // B5
    bell({ freq: hz(88), gain: 0.17, dur: 1.1, delay: 0.09, pan: 0.15 });     // E6
    synth({ freq: hz(64), waves: SUPERSAW, gain: 0.035, attack: 0.005, hold: 0.06, decay: 0.3, cutoff: 5000, cutoffEnd: 900, send: 0.3, delay: 0.09 });
  }

  /** Final lap. Harder and more urgent than the lap chime, not a
   *  prettier version of it -- the visual banner it lines up with is red
   *  and insistent for the same reason: two minor-chord stabs, a boom
   *  under the first, and a riser into the second. */
  function finalLap() {
    const stab = (delay, root) => [0, 3, 7].forEach((iv) => synth({
      freq: hz(root + iv), waves: SUPERSAW, gain: 0.05, attack: 0.003, hold: 0.09, decay: 0.3,
      cutoff: 8000, cutoffEnd: 1500, q: 2, pitchFrom: 1.04, pitchTime: 0.02, send: 0.35, delay,
    }));
    stab(0, 69);      // A minor
    stab(0.2, 69);
    synth({ freq: hz(45), waves: [['square', 0, 0]], gain: 0.10, attack: 0.003, hold: 0.3, decay: 0.3, cutoff: 1200, cutoffEnd: 300, send: 0.1 });
    boom({ from: 140, to: 40, dur: 0.4, gain: 0.35 });
    sweep({ f0: 800, f1: 6000, type: 'bandpass', q: 1.2, dur: 0.22, gain: 0.08, attack: 0.15, send: 0.3 });
  }

  /** The finish. For a win, a rising supersaw arpeggio that lands on a
   *  held major chord with a cymbal-like wash and a boom; for anything
   *  else, a slow falling minor pad -- same grade split finishfx.js draws
   *  the celebration in. */
  function fanfare(win) {
    if (win) {
      const root = 64;   // E4
      [0, 4, 7, 12].forEach((iv, i) => synth({
        freq: hz(root + 12 + iv), waves: SUPERSAW, gain: 0.05, attack: 0.003, hold: 0.05, decay: 0.22,
        cutoff: 7000, cutoffEnd: 1800, q: 1.5, send: 0.35, delay: i * 0.09,
      }));
      const land = 0.38;
      [0, 4, 7, 12, 16].forEach((iv) => synth({
        freq: hz(root + iv), waves: SUPERSAW, gain: 0.04, attack: 0.01, hold: 0.7, decay: 1.2,
        cutoff: 6500, cutoffEnd: 1600, q: 1.2, send: 0.5, delay: land,
      }));
      synth({ freq: hz(root - 24), waves: [['sawtooth', 0, 0], ['sawtooth', 9, 0]], gain: 0.10, attack: 0.01, hold: 0.7, decay: 1.0, cutoff: 1500, cutoffEnd: 250, send: 0.2, delay: land });
      boom({ from: 130, to: 36, dur: 0.8, gain: 0.42, delay: land });
      sweep({ f0: 9000, f1: 5000, type: 'highpass', q: 0.6, dur: 1.6, gain: 0.07, attack: 0.005, delay: land, send: 0.4 });
      bell({ freq: hz(root + 28), gain: 0.08, dur: 1.4, delay: land, send: 0.6 });
    } else {
      const root = 52;   // E3, minor
      [[0, 0], [3, 0.12], [7, 0.24]].forEach(([iv, d]) => synth({
        freq: hz(root + 12 + iv), glideTo: hz(root + 11 + iv), waves: SUPERSAW, gain: 0.04, attack: 0.08, hold: 0.5, decay: 1.1,
        cutoff: 2600, cutoffEnd: 500, q: 1, send: 0.5, delay: d,
      }));
      synth({ freq: hz(root - 12), waves: [['sawtooth', 0, 0]], gain: 0.09, attack: 0.05, hold: 0.5, decay: 1.0, cutoff: 700, cutoffEnd: 150, send: 0.2 });
      boom({ from: 80, to: 30, dur: 0.9, gain: 0.3 });
    }
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
   *   resonance. That is the 150 Hz peaking filter, and it is what makes
   *   whichever order happens to land on it dominate -- exactly what the
   *   reference does, where order 2 leads at 3,000 rpm and order 1 leads
   *   at 6,900 rpm without the engine changing.
   *
   * - Above that it falls about 6 dB per octave to 2.5 kHz and then
   *   steeply: the source slope, the second shelf at 300 Hz and the
   *   low-pass together. Roughly half the total energy is broadband
   *   rather than tonal (measured tonal share 0.42-0.65), which is the
   *   noise layer.
   *
   * Fitted by coordinate descent against the recording's own octave-band
   * shape at 4,100 / 5,800 / 6,700 rpm; the residual is 2.3-3.5 dB per
   * band, against 8+ dB for the sawtooth pair this replaced.
   */
  const V8_SLOPE = 0.5;        // source falls as order^-0.5 before filtering
  const V8_HALF_ORDER = 0.65;  // half orders, relative to the integer ones
  const V8_IDLE_RPM = 850;
  const V8_REDLINE_RPM = 7000;
  /**
   * Fraction of the car's top speed each of the 8 gears runs out at. These
   * started as the real RC F ratio set (top in gear g = 8th's ratio over
   * g's), but with the game's near-linear launch (13.5% of top speed per
   * second at full throttle, measured) that put a shift every 0.75-0.9 s
   * from 1.1 s onwards -- the first one heard as far too early. Laid out
   * for the game instead: upshifts at about 1.6 / 2.7 / 3.8 / 4.9 / 6.2 s
   * from standstill, with the steps closing from 1.61 to 1.09 up the box
   * the way a real one's do, so each upshift lands 4,600-6,500 rpm.
   */
  const V8_GEAR_TOP = [0.22, 0.355, 0.49, 0.62, 0.735, 0.835, 0.92, 1];
  /** Torque cut on an upshift: how long, and how far the note drops. */
  const V8_SHIFT_TIME = 0.11;
  const V8_SHIFT_DUCK = 0.42;

  /**
   * Throttle blip on a downshift: the ECU (or a driver heel-and-toeing)
   * opens the throttle for an instant with the clutch open, so the engine
   * flares past the lower gear's rpm and settles back as the clutch bites
   * -- the "bwaa" between braking and turn-in. Shape: V8_BLIP_RISE up,
   * then an exponential fall of V8_BLIP_FALL; V8_BLIP_OVERSHOOT is how far
   * past the new gear's rpm the flare goes (capped at the limiter).
   */
  const V8_BLIP_RISE = 0.045;
  const V8_BLIP_FALL = 0.09;
  const V8_BLIP_OVERSHOOT = 0.14;
  /** Extra level at the blip's peak: an open throttle with no load on it. */
  const V8_BLIP_GAIN = 0.35;

  /**
   * The 8-speed box and rpm model both V8 voices share: one step per call
   * (at 60 fps nothing can cross two gears in a frame), 0.93 hysteresis on
   * the way back down so it does not hunt on a shift point, a torque cut
   * of V8_SHIFT_TIME on every upshift and a throttle blip on every
   * downshift. `blip` (0..1) is that blip's envelope; each voice applies it
   * as full throttle and extra level for its own sound.
   */
  function makeGearbox() {
    let gear = 0;
    let shiftUntil = 0;
    let blipAt = -1;
    return {
      step(speed, maxSpeed, boosting, t) {
        const sf = Math.max(0, Math.min(1, speed / Math.max(1, maxSpeed)));
        if (gear < V8_GEAR_TOP.length - 1 && sf > V8_GEAR_TOP[gear]) { gear++; shiftUntil = t + V8_SHIFT_TIME; }
        else if (gear > 0 && sf < V8_GEAR_TOP[gear - 1] * 0.93) { gear--; blipAt = t; }
        const since = blipAt < 0 ? Infinity : t - blipAt;
        const blip = since < V8_BLIP_RISE ? since / V8_BLIP_RISE
          : since < V8_BLIP_RISE + 6 * V8_BLIP_FALL ? Math.exp(-(since - V8_BLIP_RISE) / V8_BLIP_FALL) : 0;
        const rpm = Math.min(
          V8_REDLINE_RPM,
          (V8_IDLE_RPM + (V8_REDLINE_RPM - V8_IDLE_RPM) * Math.min(1, sf / V8_GEAR_TOP[gear]))
            * (1 + V8_BLIP_OVERSHOOT * blip),
        ) * (boosting ? 1.04 : 1);
        return { sf, rpm, shifting: t < shiftUntil, blip };
      },
    };
  }

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

  /**
   * The idle note. The full order stack above repeats once every two crank
   * turns, which at 850 rpm is 7 Hz -- slow enough to be heard as separate
   * beats rather than a pitch, and it came out as a single-cylinder
   * putt-putt (envelope modulated 0.8 deep at 7 and 14 Hz). A warm V8 at
   * idle is a steady hum on its firing frequency, 8 cylinders over two
   * turns = order 4 = 57 Hz at 850 rpm, so the idle wave carries only that
   * order and its multiples, with the same fall-off. Its own repeat is the
   * firing frequency itself, heard as pitch, not as beats. A trace of
   * order 2 keeps it from being a plain buzz without bringing the beat back.
   */
  /** The idle wave's level against the full one. A PeriodicWave is
   *  normalised to its peak, and one that is nearly a single sinusoid
   *  carries far more RMS per peak than the full stack does -- unscaled it
   *  measured 9.5 dB over the old idle. This puts it about 3 dB over,
   *  which at 57 Hz, where the ear is least sensitive, is a similar
   *  loudness with more weight. */
  const V8_IDLE_WAVE_LEVEL = 0.47;
  let v8IdleWaveCache = null;
  function v8IdleWave() {
    if (v8IdleWaveCache) return v8IdleWaveCache;
    const N = 2 * 24 + 1;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    for (let k = 1; k < N; k++) {
      const order = k / 2;
      if (order % 4 === 0) imag[k] = Math.pow(order / 4, -0.8);
      else if (order === 2) imag[k] = 0.1;
    }
    v8IdleWaveCache = ctx.createPeriodicWave(real, imag);
    return v8IdleWaveCache;
  }
  /** Rpm band the idle wave hands over to the full V8 one across. */
  const V8_IDLE_WAVE_TO = 1400;
  const V8_FULL_WAVE_FROM = 2600;

  /** @param baseGain same contract as makeEngine's. */
  function makeV8Engine(baseGain) {
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(v8Wave());
    osc.frequency.value = V8_IDLE_RPM / 120;
    const idleOsc = ctx.createOscillator();
    idleOsc.setPeriodicWave(v8IdleWave());
    idleOsc.frequency.value = V8_IDLE_RPM / 120;
    const fullMix = ctx.createGain();
    fullMix.gain.value = 0;
    const idleMix = ctx.createGain();
    idleMix.gain.value = V8_IDLE_WAVE_LEVEL;

    // 48, not 75: the recording carries its 40-80 Hz octave only 8.4-8.9 dB
    // under its peak and cutting at 75 left this 2-5 dB short of that, so
    // the bottom end was both thinner than the reference and thinner than
    // asked for. It still cuts, because the half order is 7 Hz at idle and
    // 29 Hz at the limiter -- inaudible either way, and nothing but wasted
    // headroom on a phone speaker.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 48; hp.Q.value = 0.7;
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf'; low.frequency.value = 120; low.gain.value = 5;
    const body = ctx.createBiquadFilter();
    body.type = 'peaking'; body.frequency.value = 150; body.Q.value = 0.7; body.gain.value = 7;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking'; mid.frequency.value = 300; mid.Q.value = 0.8; mid.gain.value = 3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
    const toneGain = ctx.createGain();
    toneGain.gain.value = 0;
    osc.connect(fullMix); idleOsc.connect(idleMix); fullMix.connect(hp); idleMix.connect(hp); hp.connect(low); low.connect(body); body.connect(mid); mid.connect(lp); lp.connect(toneGain);

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
    idleOsc.start();
    noise.start();

    const box = makeGearbox();
    let stopped = false;
    let wobble = 0;
    let onThrottle = 1;

    return {
      /**
       * @param speed     0..maxSpeed
       * @param boosting  nitro burning
       * @param maxSpeed  PHYSICS.maxSpeed
       * @param throttle  1 on power, 0 on the brake. An engine on overrun
       *                  is quieter and duller than the same engine at the
       *                  same rpm pulling, and nothing else in here can
       *                  tell the two apart: rpm is derived from road
       *                  speed, which barely moves in the instant the
       *                  driver lifts.
       * @param level     0..1 overall multiplier (the sampled voice fades
       *                  this one in and out; see makeSampledV8Engine).
       */
      update(speed, boosting, maxSpeed, throttle = 1, level = 1) {
        if (stopped) return;
        const t = ctx.currentTime;
        const { sf, rpm, shifting, blip } = box.step(speed, maxSpeed, boosting, t);
        // Through the cut the note has to fall as fast as the clutch opens,
        // or the drop reads as the engine bogging rather than as a shift.
        // Same for a blip: it is over in a quarter of a second, and a slow
        // glide would smear it into a gentle swell.
        const glide = shifting || blip > 0 ? 0.025 : 0.05;

        // Combustion is never perfectly even, and a PeriodicWave is: held
        // at an exact frequency this reads as a siren rather than an
        // engine. A slow random walk of a few cents is what a real one
        // wanders by, and it is the cheapest realism in here -- no extra
        // nodes, just the detune the oscillator already has.
        wobble = wobble * 0.86 + (Math.random() - 0.5) * 0.4;
        osc.detune.setTargetAtTime(wobble * 22, t, 0.03);
        osc.frequency.setTargetAtTime(rpm / 120, t, glide);
        // The idle wave drifts half as far: a settled idle is steadier than
        // an engine under load, and it is steadiness that was asked for.
        idleOsc.detune.setTargetAtTime(wobble * 11, t, 0.03);
        idleOsc.frequency.setTargetAtTime(rpm / 120, t, glide);
        const full = Math.max(0, Math.min(1, (rpm - V8_IDLE_WAVE_TO) / (V8_FULL_WAVE_FROM - V8_IDLE_WAVE_TO)));
        fullMix.gain.setTargetAtTime(Math.sqrt(full), t, 0.05);
        idleMix.gain.setTargetAtTime(V8_IDLE_WAVE_LEVEL * Math.sqrt(1 - full), t, 0.05);

        // Eased rather than switched: a driver's foot is not a gate, and a
        // hard step in level on every brake tap is more obviously fake
        // than no overrun at all.
        onThrottle += (throttle - onThrottle) * 0.18;
        // A blip is the throttle wide open for an instant, whatever the
        // pedal says -- that is the whole of it -- so it bypasses the easing.
        const thr = Math.max(onThrottle, blip);
        const load = (0.35 + 0.65 * sf) * (0.55 + 0.45 * thr) * (1 + V8_BLIP_GAIN * blip);
        const duck = shifting ? V8_SHIFT_DUCK : 1;
        lp.frequency.setTargetAtTime(
          (700 + rpm * 0.08 + (boosting ? 500 : 0)) * (0.62 + 0.38 * thr), t, blip > 0 ? 0.03 : 0.08,
        );
        nf.frequency.setTargetAtTime(800 + rpm * 0.10, t, 0.08);
        toneGain.gain.setTargetAtTime(baseGain * load * duck * (boosting ? 1.2 : 1) * level, t, glide);
        // 0.10 of the tone, which is where the fit put it: the recording's
        // energy above 5 kHz sits 34 dB under its peak, and a noise layer
        // any louder than this buries that roll-off in hiss. Its own small
        // wander keeps the induction from sitting as a steady hiss behind
        // an engine that is moving.
        noiseGain.gain.setTargetAtTime(
          baseGain * 0.10 * load * duck * (1 + wobble * 0.25) * level, t, 0.06,
        );
      },
      silence() {
        const t = ctx.currentTime;
        toneGain.gain.setTargetAtTime(0, t, 0.08);
        noiseGain.gain.setTargetAtTime(0, t, 0.08);
      },
      stop() {
        stopped = true;
        try { osc.stop(); idleOsc.stop(); noise.stop(); } catch { /* already stopped */ }
      },
    };
  }

  // --- the player's engine, played from a recording --------------------
  /**
   * Rpm range the sampled voice plays from the recording itself. Inside it
   * every grain is the real engine at (almost) the same speed, pitch-
   * corrected by at most a few percent; outside it the nearest end of the
   * recording is re-pitched, which holds up to about +25% (the 7,000 rpm
   * limiter from a 5,780 rpm top) but not the four-fold drop to idle, so
   * below SAMPLE_FADE_LOW the synthesised V8 takes over, crossfaded.
   */
  const SAMPLE_FADE_LOW = 2200;
  /** Recording's level against the synthesised voice's, re-measured with
   *  the EQ below in: this puts the two at about the same RMS, so the
   *  crossfade between them is level and nothing else in the mix moves. */
  const SAMPLE_LEVEL = 1.2;
  /** EQ on the recording (see makeSampledV8Engine's `weight`): a broad
   *  lift centred in the 50-160 Hz body of the note, and a small dip where
   *  the lift's shoulder would otherwise make 200-400 Hz boxy. */
  const SAMPLE_WEIGHT_HZ = 100;
  const SAMPLE_WEIGHT_Q = 1.0;
  const SAMPLE_WEIGHT_DB = 6.5;
  const SAMPLE_BOXY_HZ = 320;
  const SAMPLE_BOXY_DB = -2.5;
  const SAMPLE_FADE_HIGH = 3000;
  /** How far ahead grains are queued, s: enough to ride out a frame that
   *  takes 100 ms (measured in-game at 15 fps under software rendering the
   *  grain stream stayed continuous), short enough that rpm still tracks
   *  the throttle without an audible lag. */
  const SAMPLE_LOOKAHEAD = 0.12;
  /**
   * Which cycles a held rpm may draw from: any within +/-SAMPLE_TOL of it
   * (re-pitched by at most that much, which does not audibly move the
   * sound's character), and at least SAMPLE_MIN_SPAN of them. The walk
   * plays SAMPLE_RUN consecutive cycles -- real, continuous engine -- then
   * jumps to a random cycle in that range; every jump lands on a cycle
   * boundary, so it is seamless. Without the spread, a car held at its top
   * speed (the recording's top end, clamped) replayed the same half-dozen
   * cycles, 70 ms of engine, for as long as the straight lasted.
   */
  const SAMPLE_TOL = 0.03;
  const SAMPLE_MIN_SPAN = 24;
  const SAMPLE_RUN = 8;

  let sampleGrains = null;
  /**
   * The recording cut into two-cycle grains, one per pitch mark: grain j
   * runs from mark j to mark j+2 under a Hann window, so it is centred on
   * mark j+1 and two neighbours overlap by exactly one engine cycle, which
   * a pair of Hann halves sums back to unity. Because every grain starts on
   * a cycle boundary (see make-v8-sample.mjs), any two of them overlap in
   * phase -- which is what lets grains from different parts of the
   * recording be laid end to end without comb-filtering. Built once.
   */
  function v8Grains() {
    if (sampleGrains) return sampleGrains;
    const S = V8_SAMPLE;
    const bin = atob(S.pcm);
    const pcm = new Float32Array(bin.length >> 1);
    for (let i = 0; i < pcm.length; i++) {
      const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      pcm[i] = (v > 32767 ? v - 65536 : v) / 32768;
    }
    const grains = [];
    for (let j = 0; j + 2 < S.marks.length; j++) {
      const a = S.marks[j], len = S.marks[j + 2] - a;
      const buf = ctx.createBuffer(1, len, S.rate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = pcm[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len));
      // One engine cycle of this grain, in seconds at its own speed -- the
      // hop between grains when it is played back unshifted.
      grains.push({ buf, rpm: S.rpm[j + 1], cycle: len / 2 / S.rate });
    }
    sampleGrains = grains;
    return grains;
  }

  /**
   * The player's engine, from a recording of a real-sounding V8 at full
   * throttle rather than synthesised: the recording is cut into engine
   * cycles (v8Grains), and every cycle the car needs is played from the
   * part of the recording where the engine was at that same speed, nudged
   * the last few percent in pitch. It is the recording's own sound -- its
   * firing pattern, exhaust and intake -- not an imitation of it; the
   * voice only chooses WHICH part of it plays and when.
   *
   * Same interface and same gearbox as makeV8Engine, which it keeps for
   * what the recording does not contain: below ~2,200 rpm (idle and the
   * first instant of a launch) the synthesised V8 plays instead, faded
   * across 2,200-3,000. Off the throttle the recording (full throttle
   * throughout) is dulled and dropped, the same overrun treatment the
   * synthesised voice gives itself.
   */
  function makeSampledV8Engine(baseGain) {
    const grains = v8Grains();
    const srcMin = grains[0].rpm;
    const srcMax = grains[grains.length - 1].rpm;
    // The recording is played in its own register: the game's rev range
    // (idle to the 7,000 limiter) maps onto idle to the top of the
    // recording (5,777). Played at the game's own rpm instead, the RC F's
    // close-ratio box kept it at 4,100-7,000 -- most of the time above the
    // recording, re-pitched up by as much as 21%, which is what made it
    // thinner and lighter than the source: at equal rpm the voice and the
    // recording measure within 1-2 dB per band, so the difference was never
    // in the grains, it was in the pitch they were being asked for.
    const toSoundRpm = (rpm) => V8_IDLE_RPM + (rpm - V8_IDLE_RPM) * (srcMax - V8_IDLE_RPM) / (V8_REDLINE_RPM - V8_IDLE_RPM);
    const synth = makeV8Engine(baseGain);
    const box = makeGearbox();

    const bus = ctx.createGain();
    bus.gain.value = 0;
    // Weight, put back. Over a full-throttle run the game spends far longer
    // near the top of each gear than the recording's steady climb does, so
    // the long-term balance came out lighter than the source: 50-100 Hz
    // 5.3 dB and 100-200 Hz 2.2 dB under it, everything above 200 Hz 2-3 dB
    // over. SAMPLE_LOW_SHELF_* are fitted to close that.
    const weight = ctx.createBiquadFilter();
    weight.type = 'peaking'; weight.frequency.value = SAMPLE_WEIGHT_HZ; weight.Q.value = SAMPLE_WEIGHT_Q; weight.gain.value = SAMPLE_WEIGHT_DB;
    const boxy = ctx.createBiquadFilter();
    boxy.type = 'peaking'; boxy.frequency.value = SAMPLE_BOXY_HZ; boxy.Q.value = 1.0; boxy.gain.value = SAMPLE_BOXY_DB;
    const overrun = ctx.createBiquadFilter();
    overrun.type = 'lowpass'; overrun.frequency.value = 11000; overrun.Q.value = 0.5;
    bus.connect(weight);
    weight.connect(boxy);
    boxy.connect(overrun);
    overrun.connect(master);

    let stopped = false;
    let nextAt = 0;         // ctx time the next grain starts
    let cursor = 0;         // grain index the walk is on
    let run = 0;            // consecutive cycles played since the last jump
    let rpmNow = V8_IDLE_RPM;
    let lastT = 0;
    let onThrottle = 1;

    /** First grain at or above `rpm` (binary search; grains rise with j). */
    function grainFor(rpm) {
      let lo = 0, hi = grains.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (grains[mid].rpm < rpm) lo = mid + 1; else hi = mid; }
      return lo;
    }

    return {
      /** Same contract as makeV8Engine's update. */
      update(speed, boosting, maxSpeed, throttle = 1) {
        if (stopped) return;
        const t = ctx.currentTime;
        const dt = lastT ? Math.min(0.1, Math.max(0, t - lastT)) : 0;
        lastT = t;
        const { sf, rpm, shifting, blip } = box.step(speed, maxSpeed, boosting, t);
        // The same glide the synthesised voice gives its pitch: quick through
        // a shift, so the drop reads as a clutch opening, not a bog.
        const tau = shifting || blip > 0 ? 0.025 : 0.05;
        rpmNow += (toSoundRpm(rpm) - rpmNow) * (dt > 0 ? 1 - Math.exp(-dt / tau) : 1);

        const mix = Math.max(0, Math.min(1, (rpmNow - SAMPLE_FADE_LOW) / (SAMPLE_FADE_HIGH - SAMPLE_FADE_LOW)));
        synth.update(speed, boosting, maxSpeed, throttle, Math.sqrt(1 - mix));

        onThrottle += (throttle - onThrottle) * 0.18;
        // The blip, as in makeV8Engine: wide open for an instant. The
        // recording is full throttle throughout, so this is simply the
        // overrun treatment lifted for the blip's length.
        const thr = Math.max(onThrottle, blip);
        const load = (0.55 + 0.45 * sf) * (0.55 + 0.45 * thr) * (1 + V8_BLIP_GAIN * blip);
        const duck = shifting ? V8_SHIFT_DUCK : 1;
        bus.gain.setTargetAtTime(
          baseGain * SAMPLE_LEVEL * load * duck * (boosting ? 1.15 : 1) * Math.sqrt(mix), t, shifting || blip > 0 ? 0.025 : 0.05,
        );
        overrun.frequency.setTargetAtTime(1300 + 9700 * thr ** 2, t, blip > 0 ? 0.02 : 0.08);

        if (mix <= 0) { nextAt = 0; return; }
        // Queue grains up to the lookahead. A stalled frame (tab switch,
        // GC) leaves nextAt in the past; restart just ahead of now rather
        // than firing a burst of late grains at once.
        if (nextAt < t) nextAt = t + 0.005;
        const target = Math.max(srcMin, Math.min(srcMax, rpmNow));
        let lo = grainFor(target * (1 - SAMPLE_TOL));
        let hi = Math.min(grains.length - 1, grainFor(target * (1 + SAMPLE_TOL)));
        if (hi - lo < SAMPLE_MIN_SPAN) {
          const mid = (lo + hi) >> 1;
          lo = Math.max(0, Math.min(grains.length - 1 - SAMPLE_MIN_SPAN, mid - (SAMPLE_MIN_SPAN >> 1)));
          hi = lo + SAMPLE_MIN_SPAN;
        }
        while (nextAt < t + SAMPLE_LOOKAHEAD) {
          if (cursor < lo || cursor > hi || run >= SAMPLE_RUN) {
            cursor = lo + Math.floor(Math.random() * (hi - lo + 1));
            run = 0;
          }
          run++;
          const g = grains[cursor];
          const rate = rpmNow / g.rpm;
          const src = ctx.createBufferSource();
          src.buffer = g.buf;
          src.playbackRate.value = rate;
          src.connect(bus);
          src.start(nextAt);
          nextAt += g.cycle / rate;
          cursor++;
        }
      },
      silence() {
        const t = ctx.currentTime;
        bus.gain.setTargetAtTime(0, t, 0.05);
        synth.silence();
        nextAt = 0;
        lastT = 0;
      },
      stop() {
        stopped = true;
        synth.stop();
      },
    };
  }

  /**
   * The rival's gearbox: five speeds, so across a run from the grid to its
   * top speed it is heard shifting four times, the way a car pulling away
   * ahead of you is. Top speed per gear follows from the ratios exactly as
   * for the V8 box (last ratio over this one); the steps (1.64, 1.47, 1.36,
   * 1.29) land each upshift at 4,300-5,200 rpm off a 6,500 limiter.
   */
  const RIVAL_GEAR_RATIOS = [3.6, 2.2, 1.5, 1.1, 0.85];
  const RIVAL_GEAR_TOP = RIVAL_GEAR_RATIOS.map((r) => RIVAL_GEAR_RATIOS[RIVAL_GEAR_RATIOS.length - 1] / r);
  const RIVAL_IDLE_RPM = 800;
  const RIVAL_REDLINE_RPM = 6500;
  const RIVAL_SHIFT_TIME = 0.12;
  const RIVAL_SHIFT_DUCK = 0.5;
  /**
   * Weight under the rival's note, asked for. Moving, its two sawtooths put
   * nothing below their fundamental (120-195 Hz through most of each gear)
   * -- measured, the 63-125 Hz octave was empty -- so: a sine an octave
   * under them (the engine's half order, as a four-stroke really has it)
   * at RIVAL_SUB_LEVEL of one sawtooth, and a low shelf lifting what is
   * already there below 200 Hz. Kept to "a little more", as asked: with
   * the sub at 0.9 and the shelf at +5 dB the voice came out 6-8 dB louder
   * overall, nearly all of it under 125 Hz; these put it 3-4 dB up. A
   * high-pass at 40 Hz drops the sub at idle (22 Hz), which no speaker
   * plays and would only have eaten headroom.
   */
  const RIVAL_SUB_LEVEL = 0.5;
  const RIVAL_LOW_SHELF_HZ = 200;
  const RIVAL_LOW_SHELF_DB = 3;

  function makeEngine(baseGain) {
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.detune.value = 9;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    const subGain = ctx.createGain();
    subGain.gain.value = RIVAL_SUB_LEVEL;
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf'; low.frequency.value = RIVAL_LOW_SHELF_HZ; low.gain.value = RIVAL_LOW_SHELF_DB;
    const rumbleCut = ctx.createBiquadFilter();
    rumbleCut.type = 'highpass'; rumbleCut.frequency.value = 40; rumbleCut.Q.value = 0.7;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 300;
    filt.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0;
    osc1.connect(filt);
    osc2.connect(filt);
    sub.connect(subGain);
    subGain.connect(filt);
    filt.connect(low);
    low.connect(rumbleCut);
    rumbleCut.connect(g);
    g.connect(master);
    osc1.frequency.value = 55;
    osc2.frequency.value = 55;
    sub.frequency.value = 27.5;
    osc1.start();
    osc2.start();
    sub.start();
    let stopped = false;
    let gear = 0;
    let shiftUntil = 0;

    return {
      /**
       * @param speed 0..maxSpeed, @param boosting bool
       * @param maxSpeed the car's own top speed (rival.maxSpeed): the box
       *              is laid out against it, so fifth runs out where the
       *              car does.
       * @param level 0..1 multiplier on top of everything else -- how far
       *              away this car is from the listener (see main.js's
       *              distanceLevel); 1 is right alongside.
       */
      update(speed, boosting, maxSpeed, level = 1) {
        if (stopped) return;
        const r = Math.max(0, Math.min(1, speed / Math.max(1, maxSpeed)));
        const t = ctx.currentTime;
        // One step per call, 0.93 hysteresis on the way down so it does not
        // hunt on a shift point -- the same rules as the V8 box.
        const last = RIVAL_GEAR_TOP.length - 1;
        if (gear < last && r > RIVAL_GEAR_TOP[gear]) { gear++; shiftUntil = t + RIVAL_SHIFT_TIME; }
        else if (gear > 0 && r < RIVAL_GEAR_TOP[gear - 1] * 0.93) gear--;
        const shifting = t < shiftUntil;
        const inGear = Math.min(1, r / RIVAL_GEAR_TOP[gear]);
        const rpm = RIVAL_IDLE_RPM + (RIVAL_REDLINE_RPM - RIVAL_IDLE_RPM) * inGear;
        // Same 45-195 Hz span the ungeared voice swept once from standstill
        // to top speed, now swept once per gear.
        const freq = 45 + (150 * (rpm - RIVAL_IDLE_RPM)) / (RIVAL_REDLINE_RPM - RIVAL_IDLE_RPM) + (boosting ? 30 : 0);
        // Quick through the cut, so the drop reads as a shift, not a bog.
        const glide = shifting ? 0.025 : 0.06;
        osc1.frequency.setTargetAtTime(freq, t, glide);
        osc2.frequency.setTargetAtTime(freq, t, glide);
        sub.frequency.setTargetAtTime(freq / 2, t, glide);
        filt.frequency.setTargetAtTime(280 + 1100 * inGear + 400 * r + (boosting ? 700 : 0), t, 0.08);
        const duck = shifting ? RIVAL_SHIFT_DUCK : 1;
        g.gain.setTargetAtTime(
          baseGain * (0.45 + 0.55 * r) * (boosting ? 1.25 : 1) * duck * level, t, shifting ? 0.025 : 0.06,
        );
      },
      /** Fully silent (grid, pause, finish) without tearing the voice
       *  down and rebuilding it -- gain to 0 is cheaper and click-free
       *  next to setTargetAtTime's own smoothing. */
      silence() {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      },
      stop() {
        stopped = true;
        try { osc1.stop(); osc2.stop(); sub.stop(); } catch { /* already stopped */ }
      },
    };
  }

  // --- tyre squeal: the other continuous sound -------------------------
  /**
   * Tyre squeal, played from a recording (squealsample.js) the way the
   * recording itself goes: every slide starts at the recording's own bite
   * and runs on through it, and once it reaches the clean, tonal part
   * (SQUEAL_SAMPLE.sustain onwards) it stays there for as long as the slide
   * lasts. That part is only half a second long, so it is re-entered at
   * irregular points rather than looped end to start -- a fixed loop that
   * short is heard as a rhythm.
   *
   * Mechanics: two-hop Hann grains read straight off the recording, each
   * starting half a grain after the last, which reconstructs it exactly
   * while the walk is contiguous. A squeal is close to a pure tone, so a
   * jump anywhere else in it only crossfades cleanly if the two sides are
   * in phase: every jump target is chosen (from a few random candidates,
   * each slid a little either way) by how well its first half-grain
   * correlates with the half-grain it will overlap. The first version of
   * this voice cut 0.12 s grains from random points of the recording's
   * noisy front half, with no alignment, and measured nothing like it: the
   * tone smeared across 1.4-1.8 kHz and stood 30-35 dB over the noise
   * floor, against the recording's 40-50.
   */
  const SQUEAL_GRAIN = 0.16;
  /** Chance per grain, inside the tonal part, of re-entering it elsewhere. */
  const SQUEAL_JUMP = 0.3;
  /**
   * Largest playback-rate change from one grain to the next. Two grains
   * overlap for half a grain, and if they run at different rates a tone
   * near 2 kHz slides out of phase across that overlap and cancels: a
   * 0.5% step (what a per-grain random wander gave) is most of a cycle,
   * and it measured as 6-7 dB holes the recording does not have. 0.15%
   * keeps the drift under a tenth of a cycle; the recording's own pitch
   * wobble is left to supply the unsteadiness.
   */
  const SQUEAL_RATE_STEP = 0.0015;
  /** Recording's level against the synthesised squeal's: measured, this
   *  puts full slip at the same RMS it has always had in the mix. */
  const SQUEAL_SAMPLE_LEVEL = 0.72;
  let squealCache = null;
  function squealSource() {
    if (squealCache) return squealCache;
    const S = SQUEAL_SAMPLE;
    const bin = atob(S.pcm);
    const pcm = new Float32Array(bin.length >> 1);
    for (let i = 0; i < pcm.length; i++) {
      const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      pcm[i] = (v > 32767 ? v - 65536 : v) / 32768;
    }
    const buf = ctx.createBuffer(1, pcm.length, S.rate);
    buf.getChannelData(0).set(pcm);
    const hann = new Float32Array(129);
    for (let i = 0; i < hann.length; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (hann.length - 1));
    squealCache = { pcm, buf, hann, rate: S.rate, sustain: Math.round(S.sustain * S.rate) };
    return squealCache;
  }

  /**
   * Where to re-enter the tonal part so the join is in phase: `ref` is the
   * sample the walk would have read next, i.e. the start of the half-grain
   * the new grain's first half is going to overlap.
   */
  function squealJoin(src, ref, grainLen) {
    const { pcm, sustain } = src;
    const half = grainLen >> 1;
    const hi = pcm.length - grainLen - 1;
    const corr = (t, step) => {
      let c = 0, e = 0, r = 0;
      for (let i = 0; i < half; i += step) {
        const v = pcm[t + i], w = pcm[ref + i];
        c += w * v; e += v * v; r += w * w;
      }
      return c / Math.sqrt(e * r + 1e-12);
    };
    let best = sustain, bestC = -Infinity;
    for (let k = 0; k < 12; k++) {
      const c0 = sustain + Math.floor(Math.random() * (hi - sustain));
      for (let d = -40; d <= 40; d += 2) {
        const t = Math.max(sustain, Math.min(hi, c0 + d));
        const c = corr(t, 4);
        if (c > bestC) { bestC = c; best = t; }
      }
    }
    // refine to the sample
    let fine = best, fineC = -Infinity;
    for (let d = -2; d <= 2; d++) {
      const t = Math.max(sustain, Math.min(hi, best + d));
      const c = corr(t, 1);
      if (c > fineC) { fineC = c; fine = t; }
    }
    return fine;
  }

  /**
   * `baseGain` is the voice's ceiling at full slip, same contract as the
   * engines'.
   */
  function makeSqueal(baseGain) {
    const src = squealSource();
    const grainLen = Math.round(SQUEAL_GRAIN * src.rate);
    const hop = grainLen >> 1;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(master);

    let stopped = false;
    let nextAt = 0;
    let rate = 1;
    let pos = 0;           // recording sample the next grain starts at
    let quietSince = -1;   // ctx time slip last fell to 0; grains run on
                           // through the release, then stop being queued
    return {
      /**
       * @param slip   0..1, how far past the grip the tyres are (see
       *               main.js's tyreSlip).
       * @param level  0..1 distance multiplier, as for the engines.
       */
      update(slip, level = 1) {
        if (stopped) return;
        const t = ctx.currentTime;
        const s = Math.max(0, Math.min(1, slip));
        const target = baseGain * SQUEAL_SAMPLE_LEVEL * s * s * level;
        // Faster in than out: a squeal starts the instant the tyre lets go
        // and tails off as it hooks back up.
        out.gain.setTargetAtTime(target, t, target > out.gain.value ? 0.035 : 0.12);

        if (target > 0) quietSince = -1;
        else if (quietSince < 0) quietSince = t;
        if (quietSince >= 0 && t - quietSince > 0.6) { nextAt = 0; return; }

        // 1.5-1.7x the recording: its tone at 1.36 kHz lands at 2.0-2.3
        // kHz, rising with slip. (Asked for three times: higher.)
        const want = 1.5 + 0.2 * s;
        // A new slide starts from the recording's bite, at its own pitch.
        if (nextAt === 0) { pos = 0; rate = want; }
        if (nextAt < t) nextAt = t + 0.005;
        while (nextAt < t + SAMPLE_LOOKAHEAD) {
          rate += Math.max(-SQUEAL_RATE_STEP, Math.min(SQUEAL_RATE_STEP, want / rate - 1)) * rate;
          const dur = grainLen / src.rate / rate;
          const node = ctx.createBufferSource();
          node.buffer = src.buf;
          node.playbackRate.value = rate;
          const win = ctx.createGain();
          win.gain.value = 0;
          win.gain.setValueCurveAtTime(src.hann, nextAt, dur);
          node.connect(win);
          win.connect(out);
          node.start(nextAt, pos / src.rate, grainLen / src.rate);
          nextAt += dur / 2;
          const next = pos + hop;
          const inTone = pos >= src.sustain;
          if (next + grainLen >= src.pcm.length || (inTone && Math.random() < SQUEAL_JUMP)) {
            pos = squealJoin(src, next, grainLen);
          } else {
            pos = next;
          }
        }
      },
      silence() {
        out.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
        quietSince = ctx.currentTime;
      },
      stop() {
        stopped = true;
      },
    };
  }

  // Where each cue sits in the mix, measured as the loudest 100 ms against
  // the synthesised cues these replaced: the start and finish cues and the
  // lap calls 3-8 dB up on those (they were too small to carry, and now
  // play over music), nitro and impacts only 4-5 dB up, since they fire
  // over and over in a race and must not wear.
  return {
    get muted() { return muted; },
    setMuted,
    music,
    click,
    countBeep: trimmed(-4.5, countBeep),
    go: trimmed(-4.5, go),
    whoosh: trimmed(-5, whoosh),
    crash: trimmed(-4, crash),
    scrape,
    lapChime: trimmed(-2, lapChime),
    finalLap: trimmed(-3.5, finalLap),
    fanfare: (win) => trimmed(win ? -6 : 0, fanfare)(win),
    makeEngine, makeV8Engine, makeSampledV8Engine, makeSqueal,
  };
}
