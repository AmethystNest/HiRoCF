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
  moveScale: 1.48,
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
    courseDesc: 'TIGHT STREETS / 90° CORNERS / NIGHT LIGHTS',
    rivalName: 'クルドカー',
    roadHalf: 230, wallHalf: 320,
    playerPhysics: { wallInset: 2 },
    wallTriggerExtra: 18,
    rival: { maxSpeed: 650, accel: 280, turn: 3.05, sprite: 'prius' },
    bestKey: 'topdownRacer_stage2_best_ms',
  },
  3: {
    id: 3, name: 'STAGE 3', shortDesc: 'MOUNTAIN PASS',
    courseName: 'COURSE · TOUGE PASS',
    courseDesc: 'HAIRPINS / GUARDRAILS / ELEVATION CHANGE',
    rivalName: '峠の走り屋',
    roadHalf: 190, wallHalf: 260,
    playerPhysics: {
      moveScale: 1.70,
      driftMinSpeed: 435,
      launchBoostBelow: 300,
      launchBoostMul: 1.28,
      accelScaleMin: 0.18,
      steerScaleExp: 1.18,
      turnCurveExp: 1.28,
      wallSpeedMul: 0.78,
      wallInset: 4,
    },
    rival: { maxSpeed: 715, accel: 210, turn: 3.35, sprite: 'ae86', drift: 0.88, driftVisualBoost: 0.45, block: false, cornerSlow: 0.07, raceLine: true, driftDelay: 4.0, bigCurveEdgeAttack: true, noBigCurveSlow: true },
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
    rival: { maxSpeed: 790, accel: 260, turn: 1.95, sprite: 'ae86', tint: 0xe0b23a, cornerSlow: 0.10, block: false, weave: false },
    bestKey: 'topdownRacer_stage4_best_ms',
  },
  5: {
    id: 5, name: 'STAGE 5', shortDesc: 'GRAND CIRCUIT',
    courseName: 'COURSE · GRAND TOUR',
    courseDesc: 'CITY + TOUGE + HIGHWAY / FULL MIX',
    rivalName: 'ラスボス',
    roadHalf: 260, wallHalf: 340,
    rival: { maxSpeed: 760, accel: 320, turn: 2.55, sprite: 'devilz', tint: 0x7a3ae0 },
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
