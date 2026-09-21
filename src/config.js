/**
 * Tuning values carried over verbatim from the Canvas build.
 * The implementation around them is new; these numbers are not to drift.
 */
export const PHYSICS = {
  accel: 210,
  maxSpeed: 760,
  brake: 430,
  coast: 28,
  turnLow: 2.95,
  turnHigh: 0.68,
  grassMax: 280,
  // World units travelled per unit of `speed`. This is the actual pace of
  // the game; `hudSpeedFactor` below is only the number on the dial, so the
  // two are tuned separately (the HUD still reads ~350 at full speed).
  // Applies to the rival as well -- rival.js reads the same PHYSICS object.
  // Stage 3 used to override this to 1.70 while every other stage ran 1.48,
  // which meant the same car covered ground 15% faster on one stage than
  // the others. One value for every stage now.
  //
  // 1.48 -> 1.66 -> 1.82: each step is a request for more real pace, and
  // each one has to be paid for elsewhere, because raising it alone makes
  // every corner harder without making the cars any better at them. A car
  // needs radius = speed * moveScale / turnRate, so a +9.6% moveScale is
  // a +9.6% radius at the same speed. What had to move with it: the
  // player's driftMinSpeed here and on stage 3 (or the drift breaks at the
  // apex of corners it used to hold, which is the exact bug the stage 3
  // value below was set to fix) and the AI's aim/corner-scan lookaheads in
  // rival.js, which are DISTANCES, so the same number of route points buys
  // proportionally less warning time as the world moves faster.
  moveScale: 1.82,
  driftTurnBoost: 1.42,
  driftSlip: 0.50,
  driftMinSpeed: 328,
  boostMoveScale: 1.38,
  boostDuration: 2.45,
  boostRecover: 9,

  // derived / incidental values from the same build
  launchBoostBelow: 220,
  launchBoostMul: 1.16,
  accelGapSpan: 180,
  accelScaleMin: 0.25,
  steerScaleAtTop: 0.46,
  steerScaleExp: 1.35,
  turnCurveExp: 1.55,
  boostTurnMul: 0.82,
  minSteerSpeed: 18,
  speedTargetBase: 670,
  speedTargetSpread: 90,
  speedTargetMinHold: 1.2,
  speedTargetSpreadHold: 2.4,
  wallSpeedMul: 0.62,
  // Applied every frame AFTER the first while contact is still ongoing,
  // instead of wallSpeedMul again -- a graze along the barrier is friction,
  // not a second collision every single tick. wallSpeedMul still fires once,
  // on the frame contact begins; see player.js.
  wallScrubMul: 0.995,
  // How long a contact stays "recent" for that impact/graze test. The
  // position correction pulls the car back inside the trigger distance on
  // every hit, so a car still steering into the barrier actually leaves
  // contact for a couple of frames before crossing back out -- without a
  // window bridging that gap, each re-crossing reads as a fresh impact
  // again, every 3-4 frames, which is the exact repeated-crash behaviour
  // wallScrubMul exists to fix.
  wallGraceWindow: 0.4,
  wallAngleBlend: 0.28,
  wallInset: 10,
  wallStuckTime: 0.85,
  wallStuckSpeed: 95,
  hudSpeedFactor: 0.46,
};

export const RACE = {
  totalLaps: 3,
};

/**
 * Nitro. The meter fills at PHYSICS.boostRecover and banks a charge every
 * time it tops out, up to `maxStock`; each charge is worth one full
 * PHYSICS.boostDuration burst and they can be spent back to back.
 *
 * `chainWindow` is the whole of the "don't waste a press" rule. A second
 * charge fired into a running burst EXTENDS it (boostTimer += duration)
 * rather than restarting it, so no bought time is ever thrown away -- and
 * a press while more than `chainWindow` of the current burst is still left
 * is refused outright, with the charge kept, so a panicked double-tap
 * cannot dump the stock into the road. Between them, three charges chain
 * into one unbroken 3 x boostDuration run with nothing lost, but only if
 * they are spent as each burst runs out.
 */
export const NITRO = {
  maxStock: 3,
  // Nothing on the grid: the first charge has to be earned off the line.
  startStock: 0,
  chainWindow: 1.0,
};

/** Per-stage rival tuning, also carried over verbatim. */
export const STAGES = {
  1: {
    id: 1, name: 'STAGE 1', shortDesc: '初心者向け',
    courseName: 'コース・シンプルサーキット',
    courseDesc: '長い直線 / 緩やかなカーブ / 大コーナー',
    rivalName: '這い寄る悪魔',
    roadHalf: 300, wallHalf: 410,
    rival: { maxSpeed: 710, accel: 250, turn: 2.25, sprite: 'devilz', block: false, weave: false, raceLine: true, cornerSlow: 0.22, holdOpeningStraight: true, finalLapBoostOnly: true },
    bestKey: 'topdownRacer_stage1_best_ms',
  },
  2: {
    id: 2, name: 'STAGE 2', shortDesc: '市街地ステージ',
    courseName: 'コース・シティサーキット',
    courseDesc: '狭い街路 / つづら折り / 市街区画',
    rivalName: 'クルドカー',
    roadHalf: 230, wallHalf: 320,
    playerPhysics: { wallInset: 2 },
    wallTriggerExtra: 18,
    rival: { maxSpeed: 650, accel: 280, turn: 3.05, sprite: 'prius' },
    bestKey: 'topdownRacer_stage2_best_ms',
  },
  3: {
    id: 3, name: 'STAGE 3', shortDesc: '峠道',
    courseName: 'コース・いろは坂',
    courseDesc: 'ヘアピン8箇所 / つづら折りの登坂 / 渓谷ストレート',
    rivalName: 'ガムテープデスマッチ',
    roadHalf: 190, wallHalf: 260,
    playerPhysics: {
      // moveScale is deliberately NOT overridden here any more -- pace is
      // one value for every stage (see PHYSICS.moveScale). What stays below
      // is touge-specific handling, not speed.
      // Lowered from 435 with the switchback course, then from 400 with
      // the 1.66 -> 1.82 moveScale step. A drift latches while BRAKE and
      // steering are held above this speed and drops the moment speed
      // falls back under it -- and at 435 the slide broke exactly at the
      // apex of every hairpin. The threshold has to sit under the speed
      // the corners are actually taken at, and that speed is not a fixed
      // number: a faster moveScale means the same hairpin is held at a
      // proportionally LOWER `speed` value, so this has to come down with
      // it (400 * 1.66 / 1.82) or the same bug comes straight back. 365
      // still leaves a drift impossible to hold at walking pace.
      driftMinSpeed: 365,
      launchBoostBelow: 300,
      launchBoostMul: 1.28,
      accelScaleMin: 0.18,
      steerScaleExp: 1.18,
      turnCurveExp: 1.28,
      wallSpeedMul: 0.78,
      wallInset: 4,
    },
    // Retuned for the switchback course (see buildStage3Path). The previous
    // values were built around a layout whose tightest corner was ~520
    // radius, where nothing the AI did was ever tested: cornerSlow 0.07
    // meant it barely lifted, and noBigCurveSlow made it carry FULL speed
    // through anything its long-curve detector called a big corner -- which
    // also switched off the speed penalty in rival.js's off-road
    // containment, so a corner it could not physically hold just dragged it
    // round at 715 with no consequence. On 330-radius hairpins that reads
    // as a car being slid sideways by an invisible hand, not as a driver.
    // Now it actually brakes for the hairpin and drifts through it at a
    // speed its own steering rate can hold.
    rival: {
      maxSpeed: 715, accel: 210, turn: 3.35, sprite: 'ae86',
      drift: 0.62, driftVisualBoost: 0.5,
      block: false, cornerSlow: 0.52, raceLine: true, driftDelay: 4.0,
      cornerLookAhead: 46,   // ~1200 units: a hairpin here needs a real braking zone
      // The per-lap "big curve boost" is off on this stage. It fires on the
      // leading edge of a long corner and, while it runs, bypasses corner
      // braking entirely (speed goes to maxSpeed * 1.18) -- which on the old
      // wide sweepers was the AE86's showpiece and on a 356-radius hairpin
      // means arriving at 844 and being dragged round. The boost is saved
      // for the valley straight instead, where it is already guarded on
      // curveAhead and bigCurve both being near zero.
      finalLapBoostOnly: true,
    },
    bestKey: 'topdownRacer_stage3_best_ms',
  },
  4: {
    id: 4, name: 'STAGE 4', shortDesc: '高速道路ステージ',
    courseName: 'コース・高速ループ',
    courseDesc: '長い直線 / 高速コーナー / 最高速勝負',
    rivalName: '最大の敵は己',
    roadHalf: 360, wallHalf: 420,
    playerPhysics: { wallInset: 3, wallSpeedMul: 0.82 },
    wallTriggerExtra: 6,
    rival: {
      maxSpeed: 815, accel: 260, turn: 1.95, sprite: 'truck0164',
      // The one rival specified as slow away and fast flat out: 815
      // against the player's 760 at the top end, and a launch rate of 120
      // against the player's 244 off the line (see rival.js launchAccel).
      // A loaded box truck is the one car you can out-drag away from the
      // lights and the one you cannot out-run once it is rolling. No other
      // stage sets launchAccel, and no other rival's maxSpeed is above
      // the player's. Corner speed is held at the old 790 * (1 - 0.10)
      // = 711 by re-deriving cornerSlow from the raised maxSpeed.
      cornerSlow: 0.205, cornerLookAhead: 24, launchAccel: 120, block: false, weave: false,
      // Shuts the door on a car coming alongside, and only then -- `block`
      // stays off, because that one weaves about for as long as the rival
      // leads, which on a truck would read as a driver who cannot hold a
      // lane. 0.26 of roadHalf is about 94 world units of lean, eased in
      // over roughly a second, so you get time to see it coming and decide
      // whether to commit or lift.
      sideBlock: 0.26, sideBlockRate: 1.3,
      // A loaded box truck does not get shoved aside by a car. `mass` is
      // how much of a contact the OTHER vehicle absorbs (see
      // resolveContacts): at 9 against the player's 1 the truck takes about
      // 6% of the separation and keeps essentially all of its speed, while
      // the player is the one that bounces and scrubs off pace. No `tint`
      // here -- the others are tinted to recolour a shared car sprite, and
      // tinting this one would just stain a white truck.
      mass: 9,
    },
    bestKey: 'topdownRacer_stage4_best_ms',
  },
  5: {
    id: 5, name: 'STAGE 5', shortDesc: 'グランドサーキット',
    courseName: 'コース・グランドツアー',
    // Describes the course it actually runs. Stage 5 shares stage 4's
    // expressway loop (see STAGE_PATHS) dressed as open country, so the
    // old "CITY + TOUGE + HIGHWAY / FULL MIX" was describing a course that
    // has never existed -- it was written for a stage that, in practice,
    // was silently running stage 1's beginner circuit.
    courseDesc: '市街+トンネル+峠+高架 / 全部入り',
    rivalName: 'グリーンヘル',
    roadHalf: 240, wallHalf: 320,
    // The last rival is deliberately NOT faster or dirtier than the player.
    // It has the player's own engine -- same accel, same top speed, no
    // launch ramp -- it never drifts, and it never blocks or weaves. The
    // only thing it does better is drive: `perfectLine` puts it on a
    // precomputed out-in-out through every corner on the lap (see
    // getRacingLine in rival.js), which is worth more over a lap of this
    // course than any of the tricks the earlier rivals use. Beating it
    // means driving a better line, not out-dragging it.
    //
    // Tinted a deep racing green over its own white photo -- `tint` is a
    // straight multiply against the source pixels, so true black (the
    // hood stripe, the spoiler, the window trim, the wheels) stays black
    // regardless of the tint colour, and only the white body panels pick
    // it up. Same mechanism CAR_SIZE.player's own headlight/fascia
    // tinting above relies on, just applied to a whole rival sprite.
    rival: {
      maxSpeed: PHYSICS.maxSpeed, accel: PHYSICS.accel, turn: 2.85, sprite: 'r8',
      tint: 0x2f8a55,
      // 0.34, not 0.30: with the line taken right to the pavement edge,
      // the last 4% of corner speed is the difference between holding it
      // and running a wheel over the paint on the way out. Measured over
      // two laps -- at 0.30 the body crossed on 39 frames and reached 9
      // units past; at 0.34 it touches 240 of 240 and never crosses, for
      // the same lap time.
      cornerSlow: 0.34, cornerLookAhead: 40,
      raceLine: true, perfectLine: true, lineAim: 13,
      block: false, weave: false, drift: 0, finalLapBoostOnly: true,
    },
    bestKey: 'topdownRacer_stage5_best_ms',
  },
};

/**
 * Sprite draw sizes. The player size is carried over from the Canvas build;
 * rival sizes are set equal to it by request (previously each rival sprite
 * had its own smaller footprint, e.g. prius 56x88).
 */
export const CAR_SIZE = {
  player: { w: 70, h: 98 },
  devilz: { w: 74, h: 98 },
  ae86:   { w: 74, h: 98 },
  prius:  { w: 74, h: 98 },
  // Stage 4's rival is a box truck. Length is set by request at 2.5
  // player-car lengths, measured against the player's ACTUAL drawn body
  // rather than its box: the player's art fills 91% of its canvas height,
  // so its 98 draws as 89.0, and 2.5 of those is 222.5. The truck's own
  // art is cropped to its silhouette, so 222.5 is exactly what draws.
  //
  // The width is then not a free number: it is derived from the cutout's
  // own proportions (210 x 742) so the photograph is never stretched.
  //
  // Note what that costs at this length. The source render is a very
  // elongated vehicle (aspect 0.283) while the car sprites are drawn
  // deliberately chunky (the player's body is 0.755), so holding the
  // truck's aspect at 2.5 lengths puts it at 63.0 wide against the
  // player's 67.2 -- the truck ends up NARROWER than the car. Keeping it
  // at least as wide as the player while still holding the aspect would
  // need a length of 237 (2.67 car lengths).
  truck0164: { w: 222.5 * (210 / 742), h: 222.5 },
  r8: { w: 74, h: 98 },
};

/**
 * Same box, different amount of it actually used: every car's own source
 * photo has different padding/perspective, so stretching them all into an
 * identical CAR_SIZE box does not make them look the same size. Measured
 * from each PNG's own alpha bounding box (fraction of the canvas the car's
 * pixels actually cover) -- player/devilz/ae86 all land close together
 * (~0.46-0.56 wide, ~0.84-0.92 tall); prius's photo has the car filling
 * almost the entire frame (0.98 / 0.99), which is what made it read as
 * visibly bigger than the player despite an identical CAR_SIZE.
 *
 * w/h scale independently (not a single uniform factor) so the corrected
 * car can match the player's own proportions, not just its area -- the
 * player's photo itself is notably narrower and longer relative to its box
 * than prius's, so matching by feel means narrowing prius more than it
 * lengthens. {w:1,h:1} = no correction.
 */
export const CAR_VISUAL_SCALE = {
  prius: { w: 0.57, h: 0.91 },
  // Stage 5's boss. Its photo is cropped to the car, so unlike the others
  // almost none of the box is padding and an uncorrected 74x98 would draw
  // it half again the size of everything else. Solved from the measured
  // bodies rather than by eye: every car's drawn body lands between 34x82
  // and 41x88, so this one is put at 40x88 -- the wide end, which is what
  // a mid-engined car should read as next to the saloons.
  r8: { w: 0.55, h: 0.91 },
};

/** How long a drift tyre-mark point stays visible before fading out. */
export const DRIFT_MARK_LIFE = 1.3;
