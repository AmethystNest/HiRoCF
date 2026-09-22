/**
 * Tuning values carried over verbatim from the Canvas build.
 * The implementation around them is new; these numbers are not to drift.
 */
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
  turnHigh: 0.68,
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
  accelGapSpan: 260,
  accelScaleMin: 0.16,
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
  // km/h on the dial per unit of `speed`, derived from moveScale rather
  // than chosen. It was 0.46, which read ~350 at full speed and was simply
  // false. Measured against the one object in the world whose real size is
  // known -- the player's own car, an RC F at 4.705 x 1.845 m, drawn 221.1
  // x 98.8 world units -- the world runs at 50.2 units per metre (47.0 from
  // the length, 53.5 from the width). The road widths that scale implies
  // are 12.0 / 9.2 / 7.6 / 14.4 / 9.6 m across stages 1-5, i.e. 3.9 to 7.3
  // car widths of road, so the world IS consistent with itself: the dial
  // was the only thing lying, and by 3.52x. At 0.46, "100 km/h" on the HUD
  // was 28 km/h of ground actually covered, which is the whole of the
  // complaint that the car hardly moves at 100.
  //
  // 0.1316 = moveScale * 3.6 / 50.2, rounded so full speed reads exactly
  // 100: true value 99.2 km/h, and the 0.8% is well inside the spread
  // between the length- and width-derived scales. Nitro rides on the same
  // factor (see player.js displaySpeed), so a boost reads 138 and travels
  // 137. Nothing about the game's pace changes -- moveScale is untouched.
  //
  // The other direction, keeping the 350, is not a retune: it needs
  // moveScale 6.41 instead of 1.82, which divides every lap time by 3.52
  // (stage 3: 62s -> 18s) and therefore needs courses 3.5x longer.
  hudSpeedFactor: 0.1316,
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
    // 710 -> 689 (-3%): the player's lap here went 17.1 -> 18.0s with the
    // accel change and this rival's only 17.1 -> 17.5s, which turned a
    // dead-even stage into a 0.5s deficit. Measured back to 18.0s.
    rival: { maxSpeed: 689, accel: 107, turn: 2.25, sprite: 'devilz', block: false, weave: false, raceLine: true, cornerSlow: 0.22, holdOpeningStraight: true, finalLapBoostOnly: true },
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
    rival: { maxSpeed: 650, accel: 120, turn: 3.05, sprite: 'prius' },
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
      maxSpeed: 645, accel: 90, turn: 3.35, sprite: 'ae86',
      drift: 0.62, driftVisualBoost: 0.5,
      // Takes its hairpin apexes out to the guardrail rather than the
      // pavement edge -- there is no off-road penalty left to pay for it,
      // and on switchbacks this narrow the extra bite is most of what
      // makes the AE86 look like it is being driven.
      wallLine: true,
      block: false, cornerSlow: 0.52, raceLine: true, driftDelay: 4.0,
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
    playerPhysics: { wallInset: 3, wallSpeedMul: 0.82 },
    wallTriggerExtra: 6,
    rival: {
      maxSpeed: 790, accel: 111, turn: 1.95, sprite: 'truck0164',
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
      // cornerSlow is deliberately NOT re-derived this time: at 0.205 the
      // corner target falls with the top speed, 648 -> 628, which is the
      // same 3% and keeps the one knob doing the one job.
      cornerSlow: 0.205, cornerLookAhead: 24, launchAccel: 51, block: false, weave: false,
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
      // the player is the one that bounces and scrubs off pace.
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
    // Its own photo: a racing-green R8 with a black carbon roof, hood
    // stripe and spoiler, and its own red tail-light accent -- shot and
    // cropped to the car the same way the other rivals' photos are, so no
    // tint/recolour step is needed (an earlier flat sprite.tint on a white
    // photo dragged that red toward whatever the tint colour was).
    rival: {
      maxSpeed: PHYSICS.maxSpeed, accel: PHYSICS.accel, turn: 2.85, sprite: 'r8',
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
      cornerSlow: 0.44, cornerLookAhead: 40,
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
