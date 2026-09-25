/**
 * Tuning values carried over verbatim from the Canvas build.
 * The implementation around them is new; these numbers are not to drift.
 */

/**
 * World units travelled per unit of `speed` -- the actual pace of the game,
 * and the one number that decides how fast the world goes past. It is named
 * here rather than written inline because several other values are NOT free
 * of it: anything that is a DISTANCE standing in for a span of TIME has to
 * grow with it, and anything that is a SPEED at which a distance-based
 * effect latches has to shrink with it. Those are derived from MOVE_SCALE
 * below and in rival.js (see PHYSICS.paceScale), so raising it no longer
 * means hunting for the values that pay for it.
 *
 * PACE_REF is the moveScale every one of those distances was originally
 * tuned at, so at MOVE_SCALE === PACE_REF the derived numbers come out
 * exactly as they were measured.
 */
// 1.48 -> 1.66 -> 1.82 -> 2.90. The last step is +59% of real pace, and it
// exists because the dial and the ground disagreed: at 1.82 a full-speed
// reading of 350 was 99 km/h of ground actually covered (see hudSpeedFactor
// for how that is measured), so "100 km/h" on the HUD was 28 km/h and the
// car visibly crawled. Rather than shrink the number -- a dial that tops out
// at 99 is worse than one that flatters -- the world now moves: full speed
// is 158 km/h against the 350 reading, so the over-read is 2.21x where it
// was 3.52x.
//
// 2.90 and not more, measured rather than guessed. Sweeping the whole build
// at 2.40 / 2.90 / 3.40 with the same bot: 3.40 breaks stage 3 outright --
// the bot finished no lap at all, spent 9620 frames off the pavement, and
// the drift latched on 48 frames against 712 at 2.90, i.e. the touge stage
// loses the mechanic it is built on -- and on stages 1-2 even the AI could
// no longer reach its own top speed, because the corners had become the
// only limit. 2.40 leaves margin but only +32%. 2.90 keeps every stage
// drivable (all five completed, worst off-pavement run 147-234 frames where
// running wide costs nothing anyway) at about 85% of the measured ceiling.
//
// What it costs, stated plainly: laps are 26-37% shorter (bot laps 18.0 ->
// 11.9, 28.4 -> 19.8, 61.8 -> 45.7, 74.9 -> 52.3, 81.9 -> 58.4s), and every
// corner now demands braking that much earlier. Going further needs longer
// courses, not another number here.
//
// 2.90 -> 2.70 (-7%), asked for: "a little slower overall, dial unchanged".
// The dial reads `speed`, not ground covered (hudSpeedFactor), so this
// slows the world alone -- full speed is now 147 km/h of real travel
// against the same ~350 reading -- and everything distance-shaped follows
// through paceScale as above.
const MOVE_SCALE = 2.70;
const PACE_REF = 1.82;

export const PHYSICS = {
  // 210 -> 90, with accelGapSpan/accelScaleMin below widening the taper:
  // measured, the car went 0-100 km/h on the dial in 0.9s and sat at 99%
  // of top speed after 4.5s, which left nothing to build toward and gave
  // the 8-speed box (see makeV8Engine) barely half a second per gear. Now
  // 2.1s to 100 and 12.9s to 99% of top -- the last 40 km/h alone takes
  // 4.2s of it. Top speed itself is unchanged; only the road to it is.
  // Braking is deliberately NOT scaled with this: a car that stops harder
  // than it accelerates is both what a real one does and what keeps the
  // corners playable at these rates.
  accel: 90,
  maxSpeed: 760,
  brake: 430,
  coast: 28,
  turnLow: 2.95,
  // Scaled by MOVE_SCALE/PACE_REF: turning radius at a given speed fraction
  // is speed*moveScale/turnRate, so raising moveScale alone (see above)
  // widens every high-speed corner by the same amount without the player
  // being able to do anything about it -- the 1.82 -> 2.90 pace step widened
  // top-speed radius by 59% on its own. turnLow is left alone (low-speed
  // maneuvering was never the complaint, and a radius argument does not
  // apply near-standstill the way it does at speed), so only the top of the
  // curve moves, keeping the same low-to-high shape.
  turnHigh: 0.68 * (MOVE_SCALE / PACE_REF),
  // World units travelled per unit of `speed`. This is the actual pace of
  // the game; `hudSpeedFactor` below is only the number on the dial, and it
  // is now DERIVED from this value rather than tuned against it (see there).
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
  moveScale: MOVE_SCALE,
  // MOVE_SCALE expressed against the pace every distance-shaped constant
  // was tuned at. Multiply a distance that stands for reaction time by it
  // (the AI's aim and corner-scan lookaheads, the elevated-deck fade
  // radius); divide a latch speed by it.
  paceScale: MOVE_SCALE / PACE_REF,
  // Turn rate in a drift, by how deep the slide is: at the first instant
  // of one (no slip angle yet) x driftTurnMin, at the full slip angle for
  // the speed x driftTurnMax, eased between. Was a flat x1.42 from the
  // moment BRAKE was pressed, so the slide itself -- holding it in,
  // letting it straighten, catching it -- changed nothing about the line;
  // now a held slide tightens the car's line and a released or caught one
  // opens it again.
  // 1.65 -> 1.72 with the deeper slip below: every degree of slip is a
  // degree the heading turns that the line does not, so the same rotation
  // needs a little more of it. Measured, 1 s of held drift turns the line
  // 193 / 117 / 53 degrees at 160 / 250 / 330 on the dial (grip: 125 / 80
  // / 43), where the 12-degree drift at x1.65 did 194 / 118 / 56.
  driftTurnMin: 1.15,
  driftTurnMax: 1.72,
  // Slip angle at full commitment, radians: driftAngleMax at top speed,
  // (1 - driftAngleSpeedShare) of it at a standstill, linear between. Was
  // 0.21 x speed share alone -- 5 degrees at 160 on the dial, 12 at the
  // top -- which read as running slightly crooked rather than sliding.
  driftAngleMax: 0.30,
  driftAngleSpeedShare: 0.35,
  // How much further the body is DRAWN round than the physics slips it.
  // The slip is what moves the car off its heading, and every degree of it
  // built up is a degree the line swings wide on entry; the drawn angle is
  // what reads as a drift. Exaggerating only the second is what arcade
  // racers do, and the collision hull follows the drawn body.
  driftVisualGain: 1.5,
  // Share of the full drift turn rate the car keeps rotating at with the
  // wheel released, by how deep the slide still is: the car was stopping
  // dead in yaw the instant the button came up, mid-slide.
  driftCarryYaw: 0.45,
  // How fast the slip angle goes to where it is being taken (1/s): into a
  // slide (was 9), and the drawn body following the slip (was 10).
  driftSlipResponse: 14,
  driftVisualResponse: 16,
  // Share of its speed a drift sheds per second at full depth (scaled by
  // how deep the slide is): the price of the extra rotation, so a corner
  // grip can make is faster taken on grip. Kept small on purpose.
  driftScrub: 0.05,
  // Brake deceleration as a multiple of `brake`; was a hard-coded 1.30.
  brakeMul: 0.95,
  // The drift's speed limit, as the DIAL reads it (displaySpeed, km/h --
  // nitro's over-read included, since that is the number on screen): a
  // drift can start only above it and ends the moment the dial falls to it.
  // Set by ear on the dial rather than derived from pace: it was a `speed`
  // threshold (driftMinSpeed, 221 at this pace, i.e. ~102 on the dial; 246
  // / ~113 on stage 3) and the ask was "release at 150 on the meter".
  driftDial: 150,
  boostMoveScale: 1.38,
  // The nitro's effect -- its movement scale, its extra acceleration and
  // its turn-rate change -- eases in over boostRampUp and back out over
  // boostRampDown (s) instead of switching: at full strength from the
  // first frame it was a lurch forward, and a lurch back when it ran out.
  boostRampUp: 0.8,
  boostRampDown: 0.6,
  boostDuration: 2.45,
  // Meter fill rate (% of a charge per second): 100 / 4.5 = ~22 s to a
  // charge. It was 9 (~11 s); asked to take twice as long.
  boostRecover: 4.5,

  // derived / incidental values from the same build
  launchBoostBelow: 220,
  launchBoostMul: 1.16,
  accelGapSpan: 260,
  accelScaleMin: 0.16,
  steerScaleAtTop: 0.46,
  steerScaleExp: 1.35,
  turnCurveExp: 1.55,
  // Turn rate while the nitro burns, eased in with it. Was 0.82 -- LESS
  // turn at 1.38x the movement, a 1.68x wider radius -- which made a burst
  // unusable anywhere but a straight; asked to turn more instead. At 1.25
  // the radius is 1.10x the unboosted car's at the same speed.
  boostTurnMul: 1.25,
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
  // km/h on the dial per unit of `speed`. Deliberately NOT honest, and the
  // reason is worth writing down, because it was tried the other way for
  // exactly one build.
  //
  // Measured against the one object in the world whose real size is known
  // -- the player's own car, an RC F at 4.705 x 1.845 m, drawn 221.1 x 98.8
  // world units -- the world runs at 50.2 units per metre (47.0 from the
  // length, 53.5 from the width). The road widths that scale implies are
  // 12.0 / 9.2 / 7.6 / 14.4 / 9.6 m across stages 1-5, i.e. 3.9 to 7.3 car
  // widths of road, so the world is consistent with itself, and the dial is
  // the one thing that is not. A truthful factor is moveScale * 3.6 / 50.2.
  //
  // At the old pace that came out at 0.1305, which put a full-speed reading
  // at 99 km/h, and a racing game whose dial tops out at 99 is worse than
  // one whose dial flatters. So the dial keeps its ~350 and the gap is
  // closed from the other side instead: MOVE_SCALE above went 1.82 -> 2.90,
  // which makes full speed 158 km/h of real travel rather than 99, and the
  // dial's over-read 2.21x rather than 3.52x. An honest factor at this pace
  // would be 0.208; the remaining flattery is deliberate and bounded by how
  // fast the existing courses can be driven, not by taste.
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
/**
 * Rival strength. Scales only the rival's top speed and acceleration --
 * what DustRacing2D's difficulty does to its AI as well -- so its line,
 * braking points and drift stay the ones each stage was tuned around.
 *
 * NORMAL is what was EASY (asked for: "today's EASY is the base"), measured
 * at 8-10% slower a lap than the stages as tuned. HARD is the stages
 * exactly as tuned (multipliers 1) and opens once every stage is cleared
 * (records.js). The old HARD (+5% on top) is gone with the old EASY.
 */
export const DIFFICULTY = {
  normal: { label: 'NORMAL', speed: 0.9, accel: 0.85 },
  hard: { label: 'HARD', speed: 1, accel: 1 },
};

/** The rival's tuning for a stage at a difficulty (HARD: as tuned). */
export function rivalTuning(rival, difficulty = 'normal') {
  // a stage may set its own multipliers for a difficulty (rival.difficulty)
  const d = { ...(DIFFICULTY[difficulty] || DIFFICULTY.normal), ...(rival.difficulty?.[difficulty] ?? {}) };
  // `topVsPlayer`: a top speed held to this share of the player's (PHYSICS
  // as the stage has set it up), whatever the difficulty would give it
  const cap = rival.topVsPlayer != null ? PHYSICS.maxSpeed * rival.topVsPlayer : Infinity;
  const maxSpeed = Math.min(rival.maxSpeed * d.speed, cap);
  if (d.speed === 1 && d.accel === 1 && maxSpeed === rival.maxSpeed) return rival;
  return {
    ...rival,
    maxSpeed,
    accel: rival.accel * d.accel,
    ...(rival.launchAccel != null ? { launchAccel: rival.launchAccel * d.accel } : {}),
  };
}

export const NITRO = {
  // One charge, as the single boost was: three banked charges that could
  // be chained was tried and asked back.
  maxStock: 1,
  // Nothing on the grid: the first charge has to be earned off the line.
  startStock: 0,
  chainWindow: 1.0,
};

/**
 * Per-stage rival tuning, also carried over verbatim.
 *
 * On the rivals' top speeds: the PHYSICS.accel cut above slowed the player's
 * lap by 3-11% depending on stage, but the rivals by only 0-6%, even after
 * they were given the same top-end taper -- their laps are corner-limited,
 * not accel-limited, so there was little for the taper to take. Measured on
 * stage 3: cutting that rival's accel by another 65% costs it 1.4s a lap and
 * raising its cornerSlow by 30% costs 2.8s, while 10% off its top speed
 * costs 6.7s. Top speed is therefore the lever used to hand each rival the
 * same share of lap time the player gave up, which restores the gap each
 * stage was actually tuned around rather than leaving every race harder than
 * it was signed off as. Stage 2 needed nothing and stage 5 cannot use this
 * lever at all (its engine is the player's by design); see both below.
 */
export const STAGES = {
  1: {
    id: 1, name: 'STAGE 1', shortDesc: '初心者向け',
    courseName: 'コース・シンプルサーキット',
    courseDesc: '長い直線 / 緩やかなカーブ / 大コーナー',
    rivalName: '這い寄る悪魔',
    roadHalf: 300, wallHalf: 410,
    // The one stage whose collision wall is NOT the visible barrier (see
    // main.js's `barrier`). Stage 1 draws no wall at all, so the visible
    // limit was the far edge of the gravel trap at 646 -- and the circuit's
    // trackside props (floodlights, camera towers, hoardings) are drawn
    // leaning in over that gravel, so at 646 the cars drove straight
    // through them. The wall stays where it was before, at wallHalf, still
    // tested with the car's drawn body like every other stage.
    barrierAtWallHalf: true,
    // (No foldInside here: squeezing the kerb in round the inside of the
    // 520 corners was tried and asked back -- the full-width kerb meeting
    // in a square corner reads better on a circuit.)
    // 710 -> 689 (-3%): the player's lap here went 17.1 -> 18.0s with the
    // accel change and this rival's only 17.1 -> 17.5s, which turned a
    // dead-even stage into a 0.5s deficit. Measured back to 18.0s.
    // 689 -> 665 (-3.5%) with the lap doubled (18,960 -> 36,800 units, one
    // big 180-degree curve added): on the line-follow bot the rival's lap
    // went from 0.929 of the player's to 0.900, the new corners suiting it
    // better; 665 measures 0.926, back where the stage was.
    // Brakes for the corners (brake: see RivalCar.cornerLimit) -- it used
    // to arrive too fast and run wide into the wall, 9 hits in 3 laps --
    // and is quicker on the straights to make up for it: 665 -> 711. Lap
    // within 2% of before, no wall contact on either difficulty, off the
    // road 15% -> 0.3%.
    // Then asked a little under the player rather than well under: top
    // 760 (the player's) and NORMAL at 0.96 of it (730, was 640). The
    // launch is the same accel, so the first 4 s match to the unit.
    rival: { engine: 'i6', maxSpeed: 760, difficulty: { normal: { speed: 0.96 } }, accel: 107, turn: 2.25, sprite: 'devilz', block: false, weave: false, raceLine: true, cornerSlow: 0.22, holdOpeningStraight: true, finalLapBoostOnly: true, brake: { decel: 900, grip: 0.9, lineGain: 1.3 } },
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
    // Untouched: this is the one rival whose lap grew by the same share as
    // the player's (27.1 -> 29.2s against 26.8 -> 28.6s), because a course
    // this tight leaves it accelerating out of corners as much as the
    // player does, so the taper reached it on its own.
    // Weaves wherever it is: behind the player as it used to only in
    // front, and wider in front (weaveAhead, share of roadHalf; 0.55 is
    // the default). Weaving flat out, the steering overshot every swerve
    // and ran the car over the kerb for up to 18% of a lap, so it aims
    // further up the road while weaving (weaveLook x the usual point),
    // which also smooths its corners. maxSpeed 650 -> 660 on top of that:
    // two laps come out 1.5-4.6% quicker than before on either difficulty,
    // leading or chasing, with the body over the kerb no more than it
    // was (<= 3.3% of a lap). accel -- the getaway -- is left alone: 4s
    // off the line it is doing 469 against 466.
    // Weaves only while it leads now (asked for); behind or alongside it
    // gets in the way instead (side block), and chases at chaseSpeed x its
    // top (NORMAL 648 -> 713 behind). Brakes for the corners like stage 1
    // -- flat out at the chase speed it hit the wall 6 times in 3 laps.
    // harass: once it leads with the player within 900, it sits on the
    // player's predicted line with a smaller swerve (0.3), keeps to their
    // pace 220 ahead instead of driving off, brake-checks now and then,
    // and leans on a car drawing alongside (sideBlock). Against a test
    // driver that tries to pass: in its path 15% -> ~25% of the time.
    rival: { engine: 'straightpipe', maxSpeed: 720, chaseSpeed: 1.1, brake: { decel: 900, grip: 0.9, lineGain: 1.3 }, accel: 120, turn: 3.05, sprite: 'prius', weaveAmp: 0.85, weaveAhead: 1.1, weaveOffRoad: true, weaveLook: 1.3, harass: { gap: 900, weave: 0.3, look: 0.8, predict: 0.35, hold: 220, brakeCheck: true }, sideBlock: 0.5, sideBlockRate: 2.2 },
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
      // (Its own drift threshold went with the move to one on the dial,
      // PHYSICS.driftDial, for every stage.)
      launchBoostBelow: 300,
      launchBoostMul: 1.28,
      accelScaleMin: 0.115,
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
      // 715 -> 645 (-10%), the largest cut of the five, because stage 3 is
      // where the player lost the most: 55.6 -> 62.0s a lap (+11.5%), since
      // eight hairpins mean the player is accelerating out of a corner for
      // most of the lap and this stage also runs the deepest taper floor
      // (playerPhysics.accelScaleMin 0.115 above). The rival meanwhile went
      // 50.9 -> 51.9s, so a 4.7s advantage had become 10.1s. Measured back
      // to 57.0s, i.e. the 4.7-5.0s the stage was tuned around.
      //
      // 645 -> 593 after the MOVE_SCALE step above, for the same reason
      // again: more pace costs a car that has to brake for eight hairpins
      // more than it costs one on a racing line, and this is the one stage
      // where two different test bots agreed about it (the gap reopened to
      // -8.0 and -7.8s against a -4.7s target, while on the other stages
      // the two bots disagreed by up to 2s and were left alone).
      // 613 -> 681 (NORMAL 552 -> 613): quicker all round, the launch
      // (accel) left as it was. driftSpeed: no drift below the dial's 150
      // km/h (326, where the player's own DRIFT starts, PHYSICS.driftDial),
      // the full angle from 207 km/h (450) -- leading at a crawl through a
      // hairpin it used to hang out the full 29 degrees at 364.
      // 593 -> 613 and cornerSlow 0.52 -> 0.48 below: laps 3.9% quicker,
      // asked for, with accel (the getaway) as it was.
      engine: 'i4', maxSpeed: 681, driftSpeed: [326, 450], accel: 90, turn: 3.35, sprite: 'ae86',
      drift: 0.62, driftVisualBoost: 0.5,
      // Takes its hairpin apexes out to the guardrail rather than the
      // pavement edge -- there is no off-road penalty left to pay for it,
      // and on switchbacks this narrow the extra bite is most of what
      // makes the AE86 look like it is being driven.
      wallLine: true,
      block: false, cornerSlow: 0.48, raceLine: true, driftDelay: 4.0,
      cornerLookAhead: 46,   // ~1200 units: a hairpin here needs a real braking zone
      // The per-lap "big curve boost" is off on this stage. It fires on the
      // leading edge of a long corner and, while it runs, bypasses corner
      // braking entirely (speed goes to maxSpeed * 1.18) -- which on the old
      // wide sweepers was the AE86's showpiece and on a 356-radius hairpin
      // means arriving at maxSpeed * 1.18 = 761 and being dragged round. The boost is saved
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
    // Other cars on the expressway (game/traffic.js): ~100 km/h, changing
    // lanes now and then, in the player's way; scattered by the truck, and
    // driven back into their lane after.
    traffic: { count: 8 },
    playerPhysics: { wallInset: 3, wallSpeedMul: 0.82 },
    wallTriggerExtra: 6,
    rival: {
      engine: 'diesel',
      maxSpeed: 790, accel: 111, turn: 1.95, sprite: 'truck0164',
      // ...but never faster than the player at the top end: held to 97% of
      // the player's top speed (760 -> 737 on HARD; NORMAL's 0.9 already
      // puts it at 711, under that). Asked for once the truck read as
      // simply faster than the player's car on the straights. Its boost
      // (1.18x speed, 1.12x movement) then peaks at 974 against the
      // player's nitro 1049.
      topVsPlayer: 0.97,
      // The one rival specified as slow away and fast flat out: 790
      // against the player's 760 at the top end, and a launch rate of 120
      // against the player's 244 off the line (see rival.js launchAccel).
      // A loaded box truck is the one car you can out-drag away from the
      // lights and the one you cannot out-run once it is rolling. No other
      // stage sets launchAccel, and no other rival's maxSpeed is above
      // the player's -- which is why this one comes down only 815 -> 790
      // (-3%), the least that both restores the 3.0s gap the stage was
      // tuned around (69.4 -> 69.6s here against the player's 72.4 ->
      // 75.0s) and leaves the truck the fastest thing on any straight.
      // (Since superseded at the top end by topVsPlayer below.)
      // cornerSlow is deliberately NOT re-derived this time: at 0.205 the
      // corner target falls with the top speed, 648 -> 628, which is the
      // same 3% and keeps the one knob doing the one job.
      // cornerSlow: was 0.205, which at this course's widest bends (curvature
      // 0.2 ahead) took 4% off; 1.0 takes 20% there -- 519 through the
      // tightest bends on NORMAL against 599 on the straights, where the
      // player's car holds ~608 on grip alone.
      cornerSlow: 1.0, cornerLookAhead: 24, launchAccel: 51, block: false, weave: false,
      // Shuts the door on a car coming alongside, and only then -- `block`
      // stays off, because that one weaves about for as long as the rival
      // leads, which on a truck would read as a driver who cannot hold a
      // lane. 0.26 of roadHalf is about 94 world units of lean, eased in
      // over roughly a second, so you get time to see it coming and decide
      // whether to commit or lift.
      sideBlock: 0.26, sideBlockRate: 1.3,
      // A loaded box truck does not get shoved aside by a car. `mass` is
      // how much of a contact the OTHER vehicle absorbs (see
      // resolveContacts). Was 9, which read as hitting a wall; at 4 the
      // player takes 77% of the separation (88% before) and the truck a
      // quarter of what a car would (a ninth before) -- still clearly the
      // heavier of the two, just no longer immovable.
      mass: 4,
      // Traffic it runs into (game/traffic.js hitRival): cars thrown less
      // hard than at 1 and the truck losing more of its own speed per hit,
      // still harder than the player's car knocks them.
      trafficHit: { forward: 1.0, out: [0.4, 0.7], spin: [4, 8], lift: [180, 0.09], keep: 0.9 },
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
    // The one wide stretch: from where the pass meets the expressway to the
    // run-in to the pit straight, the road is half as wide again (half-width
    // 240 -> 360) -- three lanes an expressway can actually be raced three
    // abreast on. It widens over ~1,070 units as the pass merges in and
    // narrows back over ~1,150 before the circuit's grandstands, whose
    // placement is measured against the narrow road. Knots are
    // [lap fraction, half-width], eased between (see widthProfile in main.js);
    // the collision wall, the drawing and prop placement all follow it.
    widthProfile: [[0.519, 240], [0.531, 360], [0.978, 360], [0.991, 240]],
    // The last rival is deliberately NOT faster or dirtier than the player.
    // It has the player's own engine -- same accel, same top speed, no
    // launch ramp -- it never drifts, and it never blocks or weaves. The
    // only thing it does better is drive: `perfectLine` puts it on a
    // precomputed out-in-out through every corner on the lap (see
    // getRacingLine in rival.js), which is worth more over a lap of this
    // course than any of the tricks the earlier rivals use. Beating it
    // means driving a better line, not out-dragging it.
    //
    // Its own photo: a racing-green R8 with a black carbon roof, hood
    // stripe and spoiler, and its own red tail-light accent -- shot and
    // cropped to the car the same way the other rivals' photos are, so no
    // tint/recolour step is needed (an earlier flat sprite.tint on a white
    // photo dragged that red toward whatever the tint colour was).
    rival: {
      // Brakes for the corners (brake) and keeps 50 back from the wall
      // (wallLineGap): it ran wide off one bend and overran its line where
      // the barrier closes in, 12 hits in 3 laps, now none. And its nitro
      // on the player's own rules (a charge every ~22 s) instead of once
      // on the last lap; lap time as it was.
      brake: { decel: 900, grip: 0.9, lineGain: 1.3 }, wallLineGap: 60, nitro: 'player',
      // Off the line as fast as the player (asked for): the player's accel
      // and launch boost on NORMAL too, where accel used to be x0.85 --
      // 1 s: 77 -> 104 against the player's 104. Top speed still NORMAL's.
      // wallLineGap 50 -> 60 with it: a few units quicker out of the chicane
      // at point ~1290, its exit swing reached the barrier (2 hits in 3
      // laps, where 50 had left it 1-2 units clear). 60: none, +0.1 s a lap.
      engine: 'v10', maxSpeed: PHYSICS.maxSpeed, accel: PHYSICS.accel, launchLikePlayer: true,
      difficulty: { normal: { accel: 1 } }, turn: 2.85, sprite: 'r8',
      // 0.30 -> 0.34 -> 0.44. The first step was about holding the line,
      // not pace: measured over two laps when the line still stopped at
      // the pavement, at 0.30 the body overran the commanded line on 39
      // frames and at 0.34 on none, for the same lap time. Now the line
      // runs to the barrier (wallLine), so overrunning it means a scrape,
      // and a higher value can only hold the line better.
      //
      // 0.44 is this stage's share of the pace restore described above
      // STAGES, and it has to come out of corner speed rather than top
      // speed: `maxSpeed: PHYSICS.maxSpeed` on the line above is the whole
      // point of this rival -- the player's own engine, beaten only by a
      // better line -- so taking its top speed below the player's would
      // change what the car IS. What that costs is honesty about the
      // limit: the player's lap here went 79.2 -> 82.5s and this rival's
      // 72.5 -> 73.3s, so 2.2s wanted giving back and corner speed is
      // worth about 1.2s of it (measured: +30% cornerSlow = +1.2s, where
      // 3% off top speed would have been +2.2s on its own). The last ~1s
      // is its racing line, which is the approved design, not a side
      // effect of the accel change.
      // 0.44 -> 0.52 with the MOVE_SCALE step, which is as far as this
      // lever reaches: measured, the last 18% of it is worth only 0.5s a
      // lap, and the gap here is 1.5-3.4s wider than the -6.7s the stage
      // was tuned around. Closing the rest means either lowering its top
      // speed below the player's -- which is the one thing this rival is
      // defined by not doing -- or dulling the racing line that IS its
      // advantage, so it is left open and visible instead of fudged.
      cornerSlow: 0.52, cornerLookAhead: 40,
      raceLine: true, perfectLine: true, lineAim: 13, wallLine: true,
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

/**
 * Collision-hull-only correction for stage 1's and stage 3's rivals, and
 * for nothing else: it is applied to the box handed to resolveContacts and
 * to nothing else either, so sprite width/height, drawHalf and grid
 * spacing all stay on the drawn size. Any car not listed is left exactly
 * as CAR_SIZE / CAR_VISUAL_SCALE produced it.
 *
 * These two photos carry a lot of empty canvas beside the car -- the body
 * covers 0.47 and 0.46 of its own frame's width against 0.84 and 0.92 of
 * its height -- and neither got a CAR_VISUAL_SCALE correction, because
 * that one also moves the DRAWN size and these two are part of the
 * reference the others were matched to. The numbers below are those
 * measured fractions.
 *
 * What makes a hit look right is the PAIR, not either hull alone: two cars
 * touch when the sum of their half-widths is crossed. hullCircles sizes
 * its circles at 0.355w (0.35w for the long-vehicle row), so a hull is
 * only ~0.71 of the box it is given -- which leaves the player's own
 * un-corrected hull about 26% wider than the car in its photo, and these
 * two, once corrected, about 30% narrower than theirs. Those cancel, so
 * the width stays near each one's measured fraction (0.47 and 0.46) and
 * only nudges up from it. Correcting the player as well stacked the two
 * corrections instead of cancelling them and buried the cars in each
 * other, which is why only these two are listed.
 *
 * The LENGTH is what the burying that survived that was actually about,
 * and it is why these run slightly PAST the drawn box. A hull is a chain
 * of circles, i.e. a rectangle with corners rounded by its own half-width,
 * while a car photographed from above stays near full width almost to the
 * bumper. Line the chain up with the body and those round shoulders cut in
 * exactly where a car comes alongside: matched against the rendered art
 * over a sweep of longitudinal offsets, contact at half a car length of
 * stagger landed 7% (stage 1) and 5% (stage 3) inside the sprites, and at
 * a full car length 22% and 26% inside. Reaching the chain past the
 * bumpers pushes those shoulders out of the way -- worst case anywhere
 * alongside is now 1.7% and 0.2%, and the hull never leads the sprites by
 * more than 5.3%. It is not free (the hull stands 22% and 15% past the
 * bumpers) but it costs nothing where it would show, because at nose-to-
 * tail offsets the player's own hull is shoulder-limited the same way.
 *
 * One dip survives, around a car's nose beside the other's flank, and it
 * is not these numbers: the player's front circle is 0.285w where its
 * middle is 0.355w, and that radius caps the pair no matter how the rival
 * is sized. Closing it means touching the player's hull, which is out of
 * scope here.
 */
export const CAR_HULL_SCALE = {
  devilz: { w: 0.48, h: 1.02 },
  ae86: { w: 0.46, h: 1.06 },
};

/**
 * Where each car sits inside its own photo, as a fraction of the drawn
 * size, +x across the car and +y toward its tail. Applied to the collision
 * hull only (see hullCircles), for the same two rivals and nothing else.
 *
 * A sprite is anchored at the middle of its CANVAS, so a car that is not
 * centred in its frame is drawn off the point it collides at -- and since
 * the two flanks are then different distances from that point, the error
 * flips sign between them: one side of the car buries into whatever it
 * touches by as much as the other side holds it off. Stage 1's rival sits
 * 4.0 units toward one side of its frame and 11.1 forward, stage 3's 2.6
 * and 5.1, which is what was left of the burying once the hull was the
 * right size. Measured from each photo's own alpha bbox; prius, r8 and the
 * truck come out centred to the pixel, so they have nothing here.
 *
 * The player's photo is off-centre too, by 3.4 units, and that is NOT
 * corrected here -- it is not one of the two cars this pass is scoped to,
 * and it is the same on every stage. It leaves about 2.5% between the two
 * flanks, roughly a screen pixel at racing zoom.
 */
export const CAR_HULL_OFFSET = {
  devilz: { x: 0.0213, y: -0.0449 },
  ae86: { x: 0.0142, y: -0.0208 },
};

/** How long a drift tyre-mark point stays visible before fading out. */
export const DRIFT_MARK_LIFE = 1.3;
