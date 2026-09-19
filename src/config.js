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
  moveScale: 1.66,
  driftTurnBoost: 1.42,
  driftSlip: 0.50,
  driftMinSpeed: 360,
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
  wallAngleBlend: 0.28,
  wallInset: 10,
  wallStuckTime: 0.85,
  wallStuckSpeed: 95,
  hudSpeedFactor: 0.46,
};

export const RACE = {
  totalLaps: 3,
};

/** Per-stage rival tuning, also carried over verbatim. */
export const STAGES = {
  1: {
    id: 1, name: 'STAGE 1', shortDesc: 'BEGINNER STAGE',
    courseName: 'COURSE · SIMPLE CIRCUIT',
    courseDesc: 'LONG STRAIGHTS / GENTLE CURVES / BIG CORNER',
    rivalName: '悪魔のアイツ',
    roadHalf: 300, wallHalf: 410,
    rival: { maxSpeed: 710, accel: 250, turn: 2.25, sprite: 'devilz', block: false, weave: false, raceLine: true, cornerSlow: 0.22, holdOpeningStraight: true, finalLapBoostOnly: true },
    bestKey: 'topdownRacer_stage1_best_ms',
  },
  2: {
    id: 2, name: 'STAGE 2', shortDesc: 'CITY STAGE',
    courseName: 'COURSE · CITY CIRCUIT',
    courseDesc: 'TIGHT STREETS / SWITCHBACKS / CITY BLOCKS',
    rivalName: 'クルドカー',
    roadHalf: 230, wallHalf: 320,
    playerPhysics: { wallInset: 2 },
    wallTriggerExtra: 18,
    rival: { maxSpeed: 650, accel: 280, turn: 3.05, sprite: 'prius' },
    bestKey: 'topdownRacer_stage2_best_ms',
  },
  3: {
    id: 3, name: 'STAGE 3', shortDesc: 'MOUNTAIN PASS',
    courseName: 'COURSE · IROHA SWITCHBACKS',
    courseDesc: '8 HAIRPINS / SWITCHBACK CLIMB / VALLEY STRAIGHT',
    rivalName: '峠の走り屋',
    roadHalf: 190, wallHalf: 260,
    playerPhysics: {
      // moveScale is deliberately NOT overridden here any more -- pace is
      // one value for every stage (see PHYSICS.moveScale). What stays below
      // is touge-specific handling, not speed.
      // Lowered from 435 with the switchback course. A drift latches while
      // BRAKE and steering are held above this speed and drops the moment
      // speed falls back under it -- and the new hairpins are taken at
      // ~400-450, so at 435 the slide broke exactly at the apex of every
      // one of them. The stage is built around drifting those corners, so
      // the threshold has to sit under the speed they are actually taken
      // at. 400 still leaves a drift impossible to hold at walking pace.
      driftMinSpeed: 400,
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
    id: 4, name: 'STAGE 4', shortDesc: 'HIGHWAY STAGE',
    courseName: 'COURSE · HIGHWAY LOOP',
    courseDesc: 'LONG STRAIGHTS / SWEEPERS / TOP SPEED',
    rivalName: '高速の帝王',
    roadHalf: 360, wallHalf: 420,
    playerPhysics: { wallInset: 3, wallSpeedMul: 0.82 },
    wallTriggerExtra: 6,
    rival: {
      maxSpeed: 790, accel: 260, turn: 1.95, sprite: 'truck0164',
      cornerSlow: 0.10, block: false, weave: false,
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
    id: 5, name: 'STAGE 5', shortDesc: 'GRAND CIRCUIT',
    courseName: 'COURSE · GRAND TOUR',
    // Describes the course it actually runs. Stage 5 shares stage 4's
    // expressway loop (see STAGE_PATHS) dressed as open country, so the
    // old "CITY + TOUGE + HIGHWAY / FULL MIX" was describing a course that
    // has never existed -- it was written for a stage that, in practice,
    // was silently running stage 1's beginner circuit.
    courseDesc: 'CITY + TUNNEL + PASS + VIADUCT / EVERYTHING',
    rivalName: 'ラスボス',
    roadHalf: 240, wallHalf: 320,
    // Tuned for the composite course, which asks for everything the other
    // rivals only have to do one of: 520-radius city junctions, a
    // 410-radius switchback, and an expressway. cornerSlow sits between
    // stage 4's 0.10 (a rival that barely lifts) and stage 3's 0.52 (one
    // that has to brake hard for a hairpin), with the longer lookahead
    // stage 3 needed so it sees a switchback coming in time. maxSpeed
    // stays at or under the player's 760, per the spec that the rival is
    // never outright faster in a straight line; what makes this one the
    // boss is that it gives up less speed than anything else in the game
    // for every kind of corner in it, and blocks while it leads.
    rival: {
      maxSpeed: 755, accel: 320, turn: 2.85, sprite: 'devilz', tint: 0x7a3ae0,
      cornerSlow: 0.30, cornerLookAhead: 40, raceLine: true, block: true,
      drift: 0.35, driftVisualBoost: 0.3, finalLapBoostOnly: true,
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
};

/** How long a drift tyre-mark point stays visible before fading out. */
export const DRIFT_MARK_LIFE = 1.3;
