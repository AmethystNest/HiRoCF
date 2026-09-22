/**
 * Rival AI.
 *
 * Targets a point ahead on the centreline offset to its own racing line,
 * brakes for curvature it can see coming, and keeps one boost in reserve for
 * the last lap. Tuning numbers (maxSpeed / accel / turn) come from the stage
 * config and are carried over from the Canvas build.
 */
import { PHYSICS as P, DRIFT_MARK_LIFE } from '../config.js';
import { makeContact, setContact } from './contact.js';

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Per-point "how committed to the big-corner line should the car be here"
 * value (0..1), by RUN LENGTH of sustained same-direction turning -- not by
 * local curvature. A short, sharp S-curve wiggle has HIGHER local curvature
 * than a long, gentle hairpin sweep (tighter radius = more turn per unit
 * distance), but it's the hairpin/big sweeper that reads as "the big
 * corner" to a driver, precisely because it's held for so long, not because
 * any single point of it is the sharpest.
 *
 * A first version returned a plain 0/1 mask, read by scanning up to 1040
 * units ahead of the car and taking the max -- which meant the moment ANY
 * point that far ahead was "big", the car snapped to full lean/drift right
 * then, even while it was still on an unrelated short curve nowhere near
 * the real corner. That's what read as the short entry/exit curves getting
 * misidentified, and as the car ballooning wide instead of cutting straight
 * to the inside: it was committing too early and too abruptly, so the
 * car's own steering (which can't turn instantly) overshot before catching
 * up.
 *
 * This version returns a continuous ramp instead of a binary flag, and
 * trims the ends of each qualifying run: the middle of the run (inset by
 * `trimLength` from each end) is the true "core" at full commitment (1);
 * outward from each core edge -- both back into the trimmed run ends and
 * out into whatever precedes/follows the run -- the value fades linearly to
 * 0 over `rampLength`. Reading a single value at the car's own position
 * each frame then naturally anticipates the corner (rising as it
 * approaches) and lets go smoothly on exit, with no separate lookahead scan
 * needed at call sites. Computed once per path and cached, like the mask
 * this replaced.
 *
 * Also returns `sign`: which way (+1/-1) THIS run turns, one fixed value
 * for every point the run's ramp touches (core, trimmed ends, and both
 * ramp-in/ramp-out tails). A long hairpin often runs right into a same-
 * direction connector arc that gets merged into the very same run, and that
 * combined run can easily be longer than any short lookahead window -- so
 * recomputing "which way is inside" fresh each frame from a live few-
 * hundred-unit lookahead (the first version of this) would, once the car
 * was far enough into a long run, start sampling past the run's own end
 * into whatever came next. If that next stretch curved the other way, the
 * lookahead's answer would flip sign while the car was still deep inside
 * the ORIGINAL run, well before its commitment (`amount`) had actually
 * decayed -- which is what read as snapping to hug the inside of the wrong,
 * upcoming corner while still exiting the one it was just in. Baking one
 * sign per run at build time, from the run's own direction, means the
 * whole run (ramps included) agrees on which way is inside for as long as
 * `amount` says the car is still committed to it.
 */
/**
 * Most lateral travel the racing line may ask for per unit of forward
 * travel -- about 22 degrees of crab. Swept against what the car actually
 * achieves, corner by corner: below this the apexes are visibly timid,
 * above it the transitions stop being trackable and the car runs wide on
 * exit, which is the overshoot the cap exists to prevent.
 */
const MAX_LATERAL_SLOPE = 0.40;

/**
 * Clear air a wall-line rival's bodywork keeps between itself and the
 * barrier at the apex. Small enough to read as "right up against it",
 * wide enough that tracking error on the way in doesn't turn the line
 * itself into a scrape -- the containment and its sparks start at the
 * barrier, 6 units further out.
 */
const WALL_LINE_GAP = 6;

/**
 * Per-point lateral offset for a full out-in-out lap, solved once for the
 * whole path and cached on it.
 *
 * The existing racing line (see raceLineEnabled in update) only ever leans
 * INTO a corner. That is an apex line, not a racing line: a driver arrives
 * from the outside, touches the inside at the apex and runs back out, and
 * it is the two "out" halves that straighten the corner and let the car
 * carry speed. Reacting to curvature frame by frame cannot produce them,
 * because at the moment the car should already be wide the corner has not
 * started yet.
 *
 * Solved rather than reacted to, with one trick. Build the apex profile
 * first -- at every point, how far inside the car would sit if it only
 * hugged. Then subtract a WIDE blur of that same profile. Where the corner
 * is, the blur is smaller than the apex, so the result is more inside than
 * the apex was; on the approach and the exit, where the apex profile is
 * zero but the blur is not, the result goes NEGATIVE -- the outside. One
 * subtraction, and entry, apex and exit all fall out of it, smooth by
 * construction and with no state to get wrong.
 *
 * It also handles a chicane correctly for free: two opposite corners close
 * together blur into each other and largely cancel, which is exactly the
 * straight-lining a driver does through one.
 *
 * Sign convention matches getLongCurveRamp: positive lateral is the side
 * the track is turning toward, i.e. the inside.
 */
function getRacingLine(path, limit) {
  const key = `line|${Math.round(limit)}`;
  if (!path._racingLineCache) path._racingLineCache = {};
  const cached = path._racingLineCache[key];
  if (cached) return cached;

  const n = path.count;
  const wrap = (i) => ((i % n) + n) % n;

  // Signed turn per point, over the same +/-2 window as the long-curve
  // scan so the two agree about which way a corner goes.
  const turn = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let d = path.tangents[wrap(i + 2)] - path.tangents[wrap(i - 2)];
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    turn[i] = d;
  }

  // Box blur over a circular array, `radius` points each side. Run twice
  // for a smooth (near-gaussian) kernel -- a single box leaves corners in
  // the line that the car then has to steer at.
  const blur = (src, radius) => {
    if (radius < 1) return src;
    let cur = src;
    for (let pass = 0; pass < 2; pass++) {
      const out = new Float32Array(n);
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += cur[wrap(k)];
      const inv = 1 / (radius * 2 + 1);
      for (let i = 0; i < n; i++) {
        out[i] = sum * inv;
        sum += cur[wrap(i + radius + 1)] - cur[wrap(i - radius)];
      }
      cur = out;
    }
    return cur;
  };

  const pts = (dist) => Math.max(1, Math.round(dist / path.spacing));
  // Turn over the 4-spacing window at which the car commits fully to the
  // inside. 0.09 is roughly a 1150-radius corner -- deliberately generous,
  // so a fast sweeper is attacked as hard as a hairpin rather than being
  // taken on a polite arc near the middle of the road. At 0.13 only a
  // quarter of this lap's corners brought the car within 15 units of the
  // pavement edge; at 0.09 it is well over half.
  const FULL_TURN = 0.09;
  const smoothTurn = blur(turn, pts(160));
  const apex = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.abs(smoothTurn[i]) / FULL_TURN);
    apex[i] = Math.sign(smoothTurn[i]) * limit * t;
  }

  // How far ahead of the corner the car should already be wide. A braking
  // zone's worth: much shorter and the entry reads as a flick, much longer
  // and the car spends the straights wandering to one side.
  const wide = blur(apex, pts(1100));
  const OUT = 0.9;
  const line = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = apex[i] * (1 + OUT) - wide[i] * OUT;
    line[i] = v > limit ? limit : v < -limit ? -limit : v;
  }
  const smoothed = blur(line, pts(220));

  // Cap how fast the line may move across the road. Nothing so far knows
  // anything about the car, and a blur of a saturating profile can leave a
  // hairpin transition asking for 0.73 of lateral travel per unit of
  // forward travel -- a 36-degree crab the car cannot hold. It chases it,
  // misses, and arrives on the far side of the road: measured, the rival
  // overshot a commanded 141 by reaching 169, hanging its body 22 units
  // past the pavement. Limiting the slope instead of catching the overshoot
  // afterwards keeps the line something the car can actually be ON.
  //
  // Swept forward then backward, repeatedly, because clamping one step
  // pushes the violation into the next: each pass moves the excess a point
  // further out and a few passes settle it. The tails wrap, so both
  // directions have to be swept or a corner near the seam keeps one steep
  // side.
  const maxStep = MAX_LATERAL_SLOPE * path.spacing;
  const limited = Float32Array.from(smoothed);
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < n; i++) {
      const j = wrap(i + 1);
      const d = limited[j] - limited[i];
      if (d > maxStep) limited[j] = limited[i] + maxStep;
      else if (d < -maxStep) limited[j] = limited[i] - maxStep;
    }
    for (let i = n - 1; i >= 0; i--) {
      const j = wrap(i - 1);
      const d = limited[j] - limited[i];
      if (d > maxStep) limited[j] = limited[i] + maxStep;
      else if (d < -maxStep) limited[j] = limited[i] - maxStep;
    }
  }
  const result = blur(limited, pts(120));
  path._racingLineCache[key] = result;
  return result;
}

function getLongCurveRamp(path, minLength, trimLength, rampLength) {
  const key = `${minLength}|${trimLength}|${rampLength}`;
  if (!path._longCurveRampCache) path._longCurveRampCache = {};
  const cached = path._longCurveRampCache[key];
  if (cached) return cached;

  const n = path.count;
  const EPS = 0.02; // below this, treat the point as straight (noise floor)
  const signedTurn = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = path.tangents[(i - 2 + n) % n];
    const b = path.tangents[(i + 2) % n];
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    signedTurn[i] = d;
  }

  // start the scan from a straight stretch so one run never gets split
  // across the array's wrap seam
  let start = 0;
  for (let k = 0; k < n; k++) {
    if (Math.abs(signedTurn[k]) < EPS) { start = k; break; }
  }

  // group into runs of consistent turn direction, keep the ones that clear
  // minLength, and record each qualifying run's point-index sequence
  const runs = [];
  let idx = 0;
  while (idx < n) {
    const k = (start + idx) % n;
    if (Math.abs(signedTurn[k]) < EPS) { idx++; continue; }
    const sign = Math.sign(signedTurn[k]);
    const runIdx = [];
    while (idx < n) {
      const kk = (start + idx) % n;
      if (Math.abs(signedTurn[kk]) < EPS || Math.sign(signedTurn[kk]) !== sign) break;
      runIdx.push(kk);
      idx++;
    }
    if (runIdx.length * path.spacing >= minLength) runs.push(runIdx);
  }

  const amount = new Float32Array(n);
  const sign = new Float32Array(n);
  const trimPts = Math.max(1, Math.round(trimLength / path.spacing));
  const rampPts = Math.max(1, Math.round(rampLength / path.spacing));
  for (const runIdx of runs) {
    const runSign = Math.sign(signedTurn[runIdx[Math.floor(runIdx.length / 2)]]);
    // keep at least one core point even on a run barely over minLength
    const trim = Math.min(trimPts, Math.floor((runIdx.length - 1) / 2));
    const coreStart = trim, coreEnd = runIdx.length - 1 - trim;
    for (let p = coreStart; p <= coreEnd; p++) {
      amount[runIdx[p]] = 1;
      sign[runIdx[p]] = runSign;
    }

    // ramp down across the trimmed head/tail of the run itself, then keep
    // going out past the run's raw edge into whatever comes before/after
    const rampTotal = trim + rampPts;
    for (let d = 1; d <= rampTotal; d++) {
      const v = Math.max(0, 1 - d / rampTotal);
      // before the core (walking backward from coreStart, may leave the run)
      const beforeIdx = coreStart - d >= 0
        ? runIdx[coreStart - d]
        : path.wrap(runIdx[0] - (d - coreStart));
      if (v > amount[beforeIdx]) { amount[beforeIdx] = v; sign[beforeIdx] = runSign; }
      // after the core (walking forward from coreEnd, may leave the run)
      const afterIdx = coreEnd + d < runIdx.length
        ? runIdx[coreEnd + d]
        : path.wrap(runIdx[runIdx.length - 1] + (d - (runIdx.length - 1 - coreEnd)));
      if (v > amount[afterIdx]) { amount[afterIdx] = v; sign[afterIdx] = runSign; }
    }
  }

  const result = { amount, sign };
  path._longCurveRampCache[key] = result;
  return result;
}

export class RivalCar {
  constructor(path, cfg, tuning) {
    this.path = path;
    this.roadHalf = cfg.roadHalf;
    this.wallHalf = cfg.wallHalf;
    /** Same two fields the player exposes purely so the effects layer can
     *  treat both cars alike -- see contact.js and render/contactfx.js.
     *  Neither is read by the AI itself. */
    this.onGrass = false;
    this.contact = makeContact();
    this._wallCooldown = 0;

    this.maxSpeed = tuning.maxSpeed;
    this.holdOpeningStraight = tuning.holdOpeningStraight ?? false;
    this.openingStraightReleased = false;
    this.finalLapBoostOnly = tuning.finalLapBoostOnly ?? false;

    this.accel = tuning.accel;
    // Getaway, opt-in per stage. A rival that sets `launchAccel` pulls away
    // from a standstill at that rate instead of its own `accel` and only
    // reaches its own figure by `launchAccelUntil`, so the player wins the
    // drag off the grid and the rival takes it back further up the road on
    // top speed. Only stage 4's box truck is specified this way; every
    // other rival leaves the line on its own accel exactly as before, so
    // omitting the key has to mean "no ramp" rather than a default one.
    //
    // The ramp ends at 300, below every stage's corner-exit speed, so it
    // shapes the getaway only and leaves corner exits and cruising alone.
    // min() so a rival whose own accel is already under the launch figure
    // is never sped up by it.
    this.launchAccel = tuning.launchAccel != null
      ? Math.min(tuning.launchAccel, tuning.accel)
      : tuning.accel;
    this.launchAccelUntil = tuning.launchAccelUntil ?? 300;
    this.turn = tuning.turn;
    // 0 for every rival except stage 3's AE86 -- a per-stage "drift spec"
    // toggle, not a universal behaviour, since it changes how the car
    // reads through every corner and wasn't asked for everywhere.
    this.driftIntensity = tuning.drift ?? 0;
    // seconds after the start before drift kicks in -- right off the grid,
    // before the car's even up to speed, the slip just reads as twitchy
    // rather than a real drift, so it's held off for a beat rather than
    // being live from the green light.
    this.driftDelay = tuning.driftDelay ?? 0;
    // Extra sprite-only yaw while drifting. This changes only how sideways
    // the rival LOOKS; the physical slip / racing line remain untouched.
    this.driftVisualBoost = tuning.driftVisualBoost ?? 0;
    this.driftVisualAngle = 0;
    this.raceTime = 0;
    // fraction of maxSpeed shaved off per unit of upcoming curvature -- 0.45
    // reads as a normal rival braking hard for a corner; a drift-spec car like
    // stage 3's AE86 wants to carry speed through instead, so this is
    // per-stage tunable rather than a fixed constant.
    // How much of a body contact the OTHER vehicle absorbs (see
    // resolveContacts in race.js). 1 is a car; stage 4's box truck is 9.
    this.contactMass = tuning.mass ?? 1;
    this.cornerSlow = tuning.cornerSlow ?? 0.45;
    // How far ahead (in route points) the corner-braking scan reaches. The
    // default 22 is ~570 world units, which at cruising speed is about half
    // a second of warning -- enough for the wide corners every other stage
    // is made of. A stage whose corners need the car to shed 200+ of speed
    // (stage 3's switchbacks) has to see them coming from further out, or
    // it arrives still at full speed and gets dragged round by the
    // containment below instead of driving the corner.
    this.cornerLookAhead = tuning.cornerLookAhead ?? 32;
    // Running wide costs nothing any more (there is no off-pavement speed
    // penalty left on any car), so a stage may tell its rival to take the
    // apex out to the BARRIER rather than stopping at the pavement edge:
    // the verge is just more road to cut across now. See `edgeLimit`.
    this.wallLine = tuning.wallLine ?? false;
    this.noBigCurveSlow = tuning.noBigCurveSlow ?? false;
    // minimum arc length (world units) for a corner to count as "big", plus
    // how far the commitment ramp reaches in from each end of it and back
    // out past its raw edges -- see getLongCurveRamp above. Only built when
    // this car actually uses it (raceLine or drift), so a plain rival's
    // construction stays cheap.
    this.longCurveMinLen = tuning.longCurveMinLen ?? 1200;
    this.longCurveTrim = tuning.longCurveTrim ?? 250;
    this.longCurveRampLen = tuning.longCurveRampLen ?? 500;
    const longCurve = (tuning.raceLine || (tuning.drift ?? 0) > 0)
      ? getLongCurveRamp(path, this.longCurveMinLen, this.longCurveTrim, this.longCurveRampLen)
      : null;
    this._longCurveAmount = longCurve?.amount ?? null;
    this._longCurveSign = longCurve?.sign ?? null;
    this._boostOnStraight = false;
    this.drifting = false;
    this.driftTrail = []; // same shape as PlayerCar's, for the same trail renderer

    this.x = 0; this.y = 0; this.angle = 0;
    this.speed = 0;
    // Rolling centreline index, so route lookups stay on this car's own
    // stretch of road where the course crosses over itself.
    this._routeHint = null;
    this.line = -48;              // preferred lateral offset from the centreline
    this._raceLine = this.line;   // smoothed apex-hugging target, see update()
    // Apex-hugging line is a per-stage look, not a universal upgrade to
    // every rival -- off by default (a rival just holds `line` like before),
    // on for stage 3's AE86 specifically, which is the one built to show it.
    this.raceLineEnabled = tuning.raceLine ?? false;
    // Stage 5's boss drives a solved out-in-out instead of the reactive
    // apex lean above -- see getRacingLine. Built against the same inside
    // limit the lean would have used, so the two stay comparable.
    // Built at a nominal amplitude and rescaled at read time to whatever
    // the car can actually use, because how far it may sit from the
    // centreline depends on its own width, and that is not known until
    // the world scale is (see bodyHalf). Rescaling preserves the shape;
    // clamping it instead would flatten both the apex and the two "out"
    // halves, which is the whole of the line.
    this._perfectLineLimit = (this.wallLine ? cfg.wallHalf : cfg.roadHalf) - 40;
    this._perfectLine = tuning.perfectLine
      ? getRacingLine(path, this._perfectLineLimit)
      : null;
    // How far ahead the solved line is read for the steering aim. Swept
    // over 5..22: shorter tracks the line more tightly in theory and in
    // practice oscillates into the corner exits, longer cuts them. 13 is
    // where the body stopped crossing the pavement at all while still
    // reaching the commanded apex.
    this._lineAim = tuning.lineAim ?? 11;
    this._driftAmt = 0; // smoothed 0..1 "currently committed to a big-curve drift"
    this.boostUsed = false;
    this.boostTimer = 0;
    // Big-curve boost: one use per lap, triggered on entry into the
    // long-curve zone. Kept separate from the existing final-lap straight
    // boost so both behaviours can coexist.
    this.bigCurveBoostLap = 0;
    this.wasInBigCurveBoostZone = false;
    this._sideBlockBias = 0;
    this.finished = false;
    this.contactRecoveryTimer = 0;

    // --- blocking behaviour: when it's ahead of and close to the player,
    // it swerves across the road toward the player's own line instead of
    // holding its racing line -- reads as deliberately obstructing them,
    // rather than just driving its own race. Off by default for a rival
    // that's meant to just drive its own line cleanly (stage 3's AE86:
    // it's there to demonstrate a clean drift line through the touge, not
    // to harass the player).
    this.blockEnabled = tuning.block ?? true;
    // --- side block ---
    // A separate behaviour from `block` above, and deliberately so. That
    // one weaves about the racing line for as long as the rival leads,
    // which reads as a car driving badly; this one does nothing at all
    // until a car actually draws level, and then leans across toward
    // whichever side it came up, closing the door. 0 disables it.
    //
    // `sideBlock` is how far it leans, as a fraction of roadHalf.
    // `sideBlockRate` is how fast it gets there (1/s): this is the knob
    // that makes it a gentle shut-out rather than a swipe, since a slow
    // lean gives the player time to back out or commit.
    this.sideBlock = tuning.sideBlock ?? 0;
    this.sideBlockRate = tuning.sideBlockRate ?? 1.4;
    // route-distance window, in world units, within which the two count as
    // abreast; and how far the player may get ahead before it gives up
    this.sideBlockWindow = tuning.sideBlockWindow ?? 800;
    this.sideBlockYield = tuning.sideBlockYield ?? 220;
    this._sideBlockBias = 0;
    // Half the rival's own body width, set by main.js once it knows the
    // world scale. Without it the lean limit assumes a car; stage 4's
    // truck is wide enough that a car's limit would hang it off the road.
    this.bodyHalf = null;
    // Half the car's DRAWN width, which CAR_VISUAL_SCALE can make much
    // smaller than the collision width above. Set with bodyHalf in
    // main.js once the world scale is known; only the racing line uses it.
    this.drawHalf = null;
    this.weavePhase = 0;
    this.blockGapMax = 620;   // only blocks when the player is within this close behind
    this.weaveSpeed = 2.6;    // rad/s -- one full swerve cycle roughly every 2.4s
    this.weaveAmplitude = 0.55; // fraction of roadHalf added on top of the player's own line

    // --- rubber-band: easing off while actually in the lead keeps the race
    // close instead of letting one early gap snowball into an unreachable
    // lead. Left alone whenever it isn't ahead -- and the final-lap boost
    // (below) bypasses targetSpeed entirely, so this never blunts that.
    this.leadSlowdown = 0.88;
  }

  /** So the shared boost-flame effect (buildBoostFlame) can drive off this
   *  car exactly like it does the player, which uses its own boost input
   *  flag rather than a bare timer. */
  get boosting() { return this.boostTimer > 0; }

  /**
   * Acceleration available at a given speed: `launchAccel` from a
   * standstill, the car's own `accel` from `launchAccelUntil` upward,
   * linear between the two. See the constructor for why.
   */
  launchAccelAt(speed) {
    if (this.launchAccelUntil <= 0) return this.accel;
    // Squared, not linear: a rival with a big `accel` figure (stage 5's
    // 320) would otherwise be back past the player's launch rate within
    // the first tenth of the ramp and the getaway would read as unchanged.
    // k*k keeps the whole first half of the ramp near `launchAccel` while
    // still meeting the car's own accel exactly at the top of it.
    const k = Math.min(1, Math.max(0, speed / this.launchAccelUntil));
    return this.launchAccel + (this.accel - this.launchAccel) * k * k;
  }

  /**
   * Nearest centreline point on this car's own stretch of route, tracked by
   * a rolling index hint -- see TrackPath.nearestLocal.
   */
  nearestOnRoute(x, y) {
    const n = this.path.nearestLocal(x, y, this._routeHint, 90, this.wallHalf * 4);
    this._routeHint = n.index;
    return n;
  }

  placeAtStart(distance, lateral) {
    this.openingStraightReleased = false;
    const s = this.path.sample(distance);
    const k = s.index;
    this.x = s.x + this.path.normals[k * 2] * lateral;
    this.y = s.y + this.path.normals[k * 2 + 1] * lateral;
    this.angle = s.angle;
    this._routeHint = k;
    this.speed = 0;
    this.line = lateral;
    this._raceLine = lateral;
    this._driftAmt = 0;
    this.driftVisualAngle = 0;
    this.raceTime = 0;
    this.boostUsed = false;
    this.boostTimer = 0;
    this.bigCurveBoostLap = 0;
    this.wasInBigCurveBoostZone = false;
    this.finished = false;
    this.contactRecoveryTimer = 0;
    this.driftTrail.length = 0;
  }

  update(dt, race) {
    this.contactRecoveryTimer = Math.max(0, this.contactRecoveryTimer - dt);

    // Stage 1 opening: keep the launch lane and heading through the entire
    // first straight. Release only when the first real corner is approaching.
    const holdStartLane = this.holdOpeningStraight && !this.openingStraightReleased;

    // Clean-race mode: do not target the player and do not snake across the lane.
    if (!this.block) {
      if ('blockOffset' in this) this.blockOffset = 0;
      if ('blockingOffset' in this) this.blockingOffset = 0;
      if ('playerBias' in this) this.playerBias = 0;
    }
    if (!this.weave) {
      if ('weaveOffset' in this) this.weaveOffset = 0;
      if ('laneWobble' in this) this.laneWobble = 0;
    }

    const path = this.path;
    // Progress-local, not global: at a crossing the other deck shares this
    // XY, and a global search would hand the AI the wrong stretch of route
    // to follow -- which reads as the rival suddenly cutting across the
    // course. See TrackPath.nearestLocal.
    const near = this.nearestOnRoute(this.x, this.y);
    const here = near.index;

    if (this.holdOpeningStraight && !this.openingStraightReleased) {
      let openingCurveAhead = 0;
      for (let i = 4; i <= 22; i += 3) {
        openingCurveAhead = Math.max(openingCurveAhead, path.curvature[path.wrap(here + i)]);
      }
      // Stay dead straight for the opening straight; hand control back to
      // normal AI as the first corner becomes meaningfully visible.
      if (openingCurveAhead >= 0.08) this.openingStraightReleased = true;
    }

    this.raceTime += dt;
    // held through the opening straight -- weaving toward an apex or
    // sliding before the car's even found its feet just reads as messy, so
    // it drives dead straight down the centre until driftDelay has passed
    // (same clock the drift gate below uses, so both let go together).
    const warmingUp = this.raceTime < this.driftDelay;

    // --- long-curve check: how committed should the car be right now to
    // the big-corner line (see getLongCurveRamp)? Shared by both the racing
    // line and the drift below, so the car leans in and starts drifting for
    // the same corners, not two different ideas of "big". The value itself
    // already carries the approach/release ramp, so a single lookup at the
    // car's own position is enough -- no separate lookahead scan needed.
    const bigCurve = this._longCurveAmount ? this._longCurveAmount[here] : 0;

    // --- how committed to the drift right now (0..1), updated here (ahead
    // of the steering aim below) so the aim-point compensation just below
    // can use this frame's value instead of lagging a frame behind. Blends
    // toward 0/1 over a short time instead of snapping, so committing to
    // and easing out of the drift both read as one continuous slide rather
    // than a pop.
    const driftTarget = (this.driftIntensity > 0 && !warmingUp) ? bigCurve : 0;
    const driftSmooth = 1 - Math.exp(-dt * 6.0); // ~0.17s time constant
    this._driftAmt += (driftTarget - this._driftAmt) * driftSmooth;

    // --- racing line: lean toward the inside of the upcoming corner, but
    // only when it's one of the big/long ones -- otherwise hold the
    // centreline. A fixed offset the whole lap either clips a hairpin's
    // apex too early or barely tucks in on a wide sweeper (it can't do
    // both), but leaning into every short chicane wiggle just as hard reads
    // as aimless weaving rather than a deliberate line, which is why this
    // is gated on bigCurve instead of raw local curvature. Which side is
    // "inside" comes from the SAME run's baked-in sign (see
    // getLongCurveRamp), not a fresh lookahead read every frame -- a fresh
    // read, once the car is more than a lookahead's distance into a long
    // run, starts sampling past that run's own end into whatever comes
    // next, and would flip the target to the wrong side while still deep
    // inside the original corner. Eased toward with a time-based blend (not
    // snapped every frame) so the target doesn't jitter with per-point
    // noise. Per-stage (raceLineEnabled) -- see constructor.
    // Furthest the MIDDLE of the car may be commanded from the centreline.
    // Normally the pavement edge less the car's own half-width; on a
    // wall-line stage the barrier instead, held WALL_LINE_GAP short of it
    // so running the apex is not the same thing as scraping (the
    // containment below starts at the barrier itself).
    const carHalf = this.drawHalf ?? this.bodyHalf ?? 45;
    const edgeLimit = (this.wallLine ? this.wallHalf - WALL_LINE_GAP : this.roadHalf - 2) - carHalf;

    if (this._perfectLine) {
      // Read straight off the solved line at the car's own position. It is
      // already smooth along the lap, so the only easing needed is enough
      // to stop a route-hint jump from stepping the target sideways.
      // 2, not the 8 a reactive line leaves: this one is solved and
      // clamped, so the only thing the margin has to cover is the car
      // arriving a fraction wide, and every unit of it is a unit of apex
      // the car visibly gives away. Measured over two laps against the
      // DRAWN body, it reaches 239 of the 240 available, never crosses.
      this._lineScale = edgeLimit / this._perfectLineLimit;
      const targetLine = warmingUp ? 0 : this._perfectLine[here] * this._lineScale;
      const raceSmooth = 1 - Math.exp(-dt * 6.0);
      this._raceLine += (targetLine - this._raceLine) * raceSmooth;
    } else if (this.raceLineEnabled) {
      // Normal rivals leave margin. A wall-line stage instead leans on the
      // full corridor, so the apex is taken against the barrier.
      const insideLimit = this.wallLine ? edgeLimit : this.roadHalf - 40;
      const lean = warmingUp ? 0 : bigCurve;
      const runSign = this._longCurveSign ? this._longCurveSign[here] : 0;
      const targetLine = runSign * insideLimit * lean;
      const raceSmooth = 1 - Math.exp(-dt * 4.0); // ~0.25s time constant
      this._raceLine += (targetLine - this._raceLine) * raceSmooth;
    } else {
      this._raceLine = this.line;
    }

    // --- weave/block: any time it's ahead of the player at all, it drives
    // unpredictably (weaving around its own line) rather than holding a
    // clean racing line -- not gated on distance, so a big lead doesn't
    // read as "driving properly" and only start swerving once caught up.
    // Once the player is actually close behind, the weave re-centres on
    // the player's own line instead of its own, so it's now actively
    // cutting them off rather than just wandering.
    // How far the middle of this car may sit from the centreline before
    // part of it is hanging off the road. `bodyHalf` is only known once
    // the world scale is (see main.js); 45 is the car-sized default this
    // used before there was anything on the grid wider than a car.
    const lineLimit = this.roadHalf - (this.bodyHalf ?? 45) - 2;

    let steerLine = this._raceLine;
    if (this.blockEnabled && race?.player && race.gap != null && race.gap > 0) {
      this.weavePhase += dt * this.weaveSpeed;
      const weave = Math.sin(this.weavePhase) * this.roadHalf * this.weaveAmplitude;
      const center = race.gap < this.blockGapMax
        ? path.lateralOf(race.player.x, race.player.y, near)
        : this._raceLine;
      steerLine = Math.max(-lineLimit, Math.min(lineLimit, center + weave));
    } else {
      this.weavePhase = 0;
    }

    // --- side block: shut the door on a car drawing alongside ---
    // Only while the two actually overlap along the route, and only toward
    // the side the player came up. The lean is eased in and out at
    // `sideBlockRate`, so it reads as the rival gradually taking the line
    // away rather than swerving at them, and it decays to nothing the
    // moment they drop back or get through.
    if (this.sideBlock > 0 && race?.player && race.gap != null && !warmingUp) {
      const abreast = Math.max(0, 1 - Math.abs(race.gap) / this.sideBlockWindow);
      let target = 0;
      // give up once the player is properly ahead -- leaning on someone
      // already past reads as ramming them, not as defending a line
      if (abreast > 0 && race.gap > -this.sideBlockYield) {
        const playerLat = path.lateralOf(race.player.x, race.player.y, near);
        const myLat = path.lateralOf(this.x, this.y, near);
        const side = Math.sign(playerLat - myLat);
        // ignore a player sitting in the rival's own tracks: there is no
        // side to defend, and a zero-width gap would make `side` flicker
        if (side !== 0 && Math.abs(playerLat - myLat) > 30) {
          target = side * this.sideBlock * this.roadHalf * abreast;
        }
      }
      this._sideBlockBias += (target - this._sideBlockBias) * (1 - Math.exp(-dt * this.sideBlockRate));
      steerLine = Math.max(-lineLimit, Math.min(lineLimit, steerLine + this._sideBlockBias));
    }

    // --- aim at a point ahead, offset to this car's line. While drifting,
    // aim further past the line -- toward the inside -- in proportion to
    // how committed to the slide it is: a big slip angle carries the car's
    // actual travel wider than its nose points (that's what a slide is), so
    // aiming at the nominal line alone lets the real trajectory balloon
    // toward the outside. Countersteering harder into the corner (the same
    // thing a real driver does to hold a drift on line) fixes that by
    // making the car's own heading anticipate the slide, rather than
    // fighting the slide by yanking the car's position around afterward --
    // an earlier version did exactly that (a spring pulling x/y toward the
    // line each frame) and it fed back on itself: pulling position changes
    // which path point is nearest, which moves the pull target, which often
    // overshot and pulled back the other way next frame. That oscillation
    // didn't show up in the tracked `speed` value at all (still a smooth
    // number) but ate a big chunk of the car's actual forward progress each
    // frame, which is exactly what read as the car mysteriously slowing
    // down through the big corners despite `speed` saying otherwise.
    // Tied to bigCurve directly, not _driftAmt -- bigCurve is the raw,
    // unsmoothed "how deep into this corner am I right now" reading, while
    // _driftAmt lags it slightly (it's smoothed for the slip itself, so the
    // slide doesn't pop on/off). Biasing off the lagging value meant that,
    // on the way OUT of a corner, the compensation stayed large a beat
    // after the track had already started straightening out from under it,
    // over-rotating the nose inward right when the corner needed less of
    // that, not more -- which is what sent the car drifting wide on exit.
    const driftAimBias = bigCurve * this.driftIntensity * 70;
    // capped so the aim point can never land past the actual pavement --
    // without this, full lean (steerLine near insideLimit) plus full bias
    // could ask for a point beyond roadHalf, off the road entirely, which
    // is a nonsensical target no matter how well-intentioned the
    // compensation is.
    //
    // On a wall-line stage the barrier is that limit, not the line: capping
    // the aim at the line's OWN value threw the drift compensation away
    // exactly where it was needed. Measured on stage 3, the line asked for
    // 161 and the bias wanted 200, the cap cut it back to 161 -- and a car
    // held sideways at 28 degrees through a hairpin then tracked 14 units
    // shy of the line it had been given, leaving the apex it was built for
    // a car's width off the rail. The bias exists to be spent here.
    const aimCap = this.wallLine ? this.wallHalf - WALL_LINE_GAP : this.roadHalf - 20;
    let aimLine = Math.max(-aimCap, Math.min(aimCap, steerLine + Math.sign(steerLine) * driftAimBias));

    // After body contact, don't immediately yank back to the programmed
    // racing line. Keep following the road, but preserve most of the
    // lateral displacement for a short moment so a player's shove actually
    // moves the rival instead of being cancelled by AI steering next frame.
    if (this.contactRecoveryTimer > 0) {
      const currentLine = path.lateralOf(this.x, this.y, near);
      const lineRecovery = 0.28;
      aimLine = currentLine + (aimLine - currentLine) * lineRecovery;
    }

    const lookAhead = 11;
    // A solved line is known everywhere, so offset the aim point by the
    // line's value AT THE AIM POINT rather than at the car. Using the
    // car's own value steers toward a point 11 indices ahead while holding
    // the offset from 11 indices behind it, which is a lag of exactly the
    // lookahead distance -- the car was arriving at 112 of a commanded 137
    // through every apex, and giving away 35 units of road it had been
    // told to use. Nothing else reads the line this way because nothing
    // else knows it in advance.
    let aimAt = lookAhead;
    if (this._perfectLine && !warmingUp && this.contactRecoveryTimer <= 0) {
      aimAt = this._lineAim ?? lookAhead;
      const ahead = this._perfectLine[path.wrap(here + aimAt)] * this._lineScale;
      aimLine = Math.max(-aimCap, Math.min(aimCap, ahead));
    }
    const target = path.offsetPoint(here + aimAt, aimLine);
    const desired = Math.atan2(target.y - this.y, target.x - this.x);
    const diff = wrapAngle(desired - this.angle);

    const steer = (holdStartLane ? 0 : (Math.max(-1, Math.min(1, diff * 2.45))));
    const ratio = Math.min(1, this.speed / this.maxSpeed);
    const steerScale = 1 - 0.40 * Math.pow(ratio, 1.35);
    this.angle += steer * (this.turn * 1.02) * steerScale * dt;

    // --- read the corner that is coming, not just the current error ---
    let curveAhead = 0;
    const scanStep = Math.max(3, Math.round(this.cornerLookAhead / 7));
    for (let i = 4; i <= this.cornerLookAhead; i += scanStep) {
      curveAhead = Math.max(curveAhead, path.curvature[path.wrap(here + i)]);
    }
    // Speed control reacts to the road's own geometry (curveAhead) only --
    // NOT blended with the live steering error (diff) the way the original
    // cornerFactor was. That blend meant any time the AI's own steering
    // target moved a lot in one frame (the racing line ramping up into a
    // big corner, or snapping across at a hairpin) the resulting heading
    // error alone could peg this at 1 even on a straight-ish stretch,
    // triggering the same hard braking (below) a real tight corner gets --
    // which is what read as the car mysteriously slowing down right as it
    // was supposed to be picking up a big drift.
    const speedFactor = curveAhead;
    if (!this.finalLapBoostOnly) {
  
  
      // --- one big-curve boost per lap ---
      // Trigger on the leading edge of the same long-curve zone used by the
      // rival's racing line/drift. This prevents repeated retriggering while
      // it remains inside one long corner.
      const inBigCurveBoostZone = bigCurve >= 0.45;
      const currentLap = race?.lap ?? 1;
      if (
        inBigCurveBoostZone &&
        !this.wasInBigCurveBoostZone &&
        this.bigCurveBoostLap !== currentLap &&
        !warmingUp
      ) {
        this.bigCurveBoostLap = currentLap;
        this.boostTimer = Math.max(this.boostTimer, 2.35);
      }
      this.wasInBigCurveBoostZone = inBigCurveBoostZone;
    } else {
      this.wasInBigCurveBoostZone = false;
    }

    // --- one-shot boost saved for the final lap on a straight ---
    // curveAhead alone isn't enough of a guard: it's a LOCAL reading, and
    // even the gentlest big hairpin/sweeper dips below 0.18 at some points
    // along its own arc without actually being a straight. Firing the boost
    // there pushed speed to 1.18x mid-corner, well past what the drift
    // countersteering (tuned for normal cruise speed) was set up to hold,
    // which is exactly what sent the car wide right as the corner or its
    // exit needed it most under control. bigCurve (already computed above)
    // is the same "am I currently in or near a big corner" signal the
    // racing line and drift use, so require it to be essentially zero too.
    if (!this.boostUsed && race && race.lap >= race.totalLaps && curveAhead < 0.18 && bigCurve < 0.05) {
      this.boostUsed = true;
      this.boostTimer = 2.35;
      this._boostOnStraight = true;
    }
    if (this.boostTimer > 0) this.boostTimer = Math.max(0, this.boostTimer - dt);
    // ...and give it back the moment the road stops being straight. The
    // firing guard only sees as far as the corner scan reaches, while the
    // boost itself runs for 2.35s -- at this build's pace that is several
    // thousand world units, so a corner can arrive well inside a boost
    // that was legitimately fired on a clear road. Stage 5's 518-radius
    // sweeper is exactly that: at 1.18 * 825 the car needs 569 of radius
    // and has 518, so it ran wide on the final lap every time until the
    // boost was released here rather than held to its timer.
    //
    // Only the straight-line boost above is released this way. The OTHER
    // boost (the per-lap one below, on cars without finalLapBoostOnly) is
    // deliberately fired INSIDE a big curve as that car's showpiece, so
    // the same test would cancel it on the frame it starts.
    if (this._boostOnStraight && this.boostTimer > 0 && (curveAhead >= 0.18 || bigCurve >= 0.05)) {
      this.boostTimer = 0;
      this._boostOnStraight = false;
    }

    const fullBigCurveAttack = this.noBigCurveSlow && bigCurve >= 0.35;
    let targetSpeed = fullBigCurveAttack
      ? this.maxSpeed
      : this.maxSpeed * (1 - this.cornerSlow * speedFactor);
    // The Stage 3 big-corner special carries full speed even while leading;
    // don't let rubber-band slowdown masquerade as corner braking there.
    if (!fullBigCurveAttack && race?.gap != null && race.gap > 0) targetSpeed *= this.leadSlowdown;

    if (this.boostTimer > 0) {
      this.speed += 430 * dt;
      this.speed = Math.min(this.maxSpeed * 1.18, this.speed);
    } else {
      if (this.speed < targetSpeed) {
        // The same top-end taper the player has (see PHYSICS.accelGapSpan /
        // accelScaleMin), measured against this car's OWN top speed exactly
        // as the player's is against maxSpeed -- not against targetSpeed,
        // which corner braking pulls down to just above the current speed
        // and which would therefore read as the car going slack mid-corner
        // instead of as it running out of road speed.
        //
        // Without it the two cars were on different models, and that only
        // showed when the accel figures came down together: the player's
        // taper took another 73% off its last few km/h while the rival had
        // none to take, so a scaling meant to slow both down equally put
        // stage 3's rival 10.3s a lap ahead where it had been 4.7s.
        const gap = this.maxSpeed - this.speed;
        const taper = Math.max(P.accelScaleMin, Math.min(1, gap / P.accelGapSpan));
        this.speed += this.launchAccelAt(this.speed) * taper * dt;
      } else if (!fullBigCurveAttack) this.speed -= 430 * speedFactor * dt;
      this.speed = Math.max(0, Math.min(this.maxSpeed, this.speed));
    }

    // --- drift spec: the car's actual travel direction lags behind where
    // it's pointed, same idea as the player's own drift (moveAngle offset
    // from facing angle) -- reads as the rear sliding wide through a
    // corner instead of gripping through it. Gated on the same bigCurve
    // signal as the racing line above (a real long/big corner, not local
    // curvature) via `_driftAmt` (updated earlier this frame), so it only
    // ever drifts where it's also leaning into the inside line, not on some
    // short chicane bend along the way.
    let moveAngle = this.angle;
    this.drifting = false;
    if (this._driftAmt > 0.02) {
      // Which way the slide leans comes from the same baked-in run sign as
      // the racing line (see getLongCurveRamp), not from the live steer
      // value -- right at the tail of a drift, the steering target has
      // nearly returned to centre, so the live steering error is small and
      // can land on either side of zero from ordinary noise. Deriving the
      // slide's direction from THAT meant the last moment of a drift could
      // occasionally flick the slip the other way, right as it should have
      // just been coasting out -- reading as the car trying to drift the
      // opposite direction at the very end. The run sign never wavers like
      // that: it's fixed for the whole corner.
      const runSign = this._longCurveSign ? this._longCurveSign[here] : 0;
      const steerSign = runSign !== 0 ? runSign : (steer > 0 ? 1 : -1);
      const slip = this.driftIntensity * this._driftAmt * Math.min(1, this.speed / this.maxSpeed);
      moveAngle -= steerSign * slip;
      this.drifting = slip > 0.06;

      // Make the AE86 visibly hang its tail farther out without changing
      // its actual trajectory. Sign follows the same baked corner direction
      // as the physical slip, so visual yaw and tyre motion agree.
      const visualTarget = steerSign * this.driftVisualBoost * this._driftAmt;
      const visualSmooth = 1 - Math.exp(-dt * 9.0);
      this.driftVisualAngle += (visualTarget - this.driftVisualAngle) * visualSmooth;
    } else {
      const visualSmooth = 1 - Math.exp(-dt * 10.5);
      this.driftVisualAngle += (0 - this.driftVisualAngle) * visualSmooth;
    }

    const move = this.speed * P.moveScale * (this.boostTimer > 0 ? 1.12 : 1);
    this.x += Math.cos(moveAngle) * move * dt;
    this.y += Math.sin(moveAngle) * move * dt;

    // --- hug the line while drifting: nudge the CROSS-TRACK position only
    // (along path.normals at `here`, never the along-track/tangential
    // component) toward steerLine, in proportion to commitment. An earlier
    // attempt pulled straight toward an absolute world point instead, which
    // couldn't help but tug at the along-track component too -- that fed
    // back through `here` being recomputed from the pulled position each
    // frame and showed up as the car's actual forward progress oscillating
    // even though `speed` stayed smooth. Moving purely along the normal
    // can't touch forward progress at all, so it's free to be quite firm
    // without reintroducing that.
    if (this._driftAmt > 0.02) {
      const nx = path.normals[here * 2], ny = path.normals[here * 2 + 1];
      const curLat = (this.x - near.x) * nx + (this.y - near.y) * ny;
      const pull = (1 - Math.exp(-dt * 18.0)) * this._driftAmt;
      const dLat = (steerLine - curLat) * pull;
      this.x += nx * dLat;
      this.y += ny * dLat;
    }

    if (this.drifting) {
      this.driftTrail.push({ x: this.x, y: this.y, life: DRIFT_MARK_LIFE });
      if (this.driftTrail.length > 160) this.driftTrail.shift();
    }
    for (const pt of this.driftTrail) pt.life -= dt;
    if (this.driftTrail.length && this.driftTrail[0].life <= 0) {
      this.driftTrail = this.driftTrail.filter((pt) => pt.life > 0);
    }

    // --- soft containment so it never beaches itself on a barrier ---
    // Measured against the BARRIER, not the pavement edge: leaving the road
    // costs nothing now, and on a wall-line stage the apex is out here on
    // purpose. What is still not allowed is driving through the wall, so
    // the pull starts where the car's own body reaches it -- which also
    // stops a wide car (stage 1's is 186 units across) hanging its flank
    // past the barrier while its middle is still inside the old trigger.
    const after = this.nearestOnRoute(this.x, this.y);
    const bodyAtWall = this.wallHalf - (this.drawHalf ?? this.bodyHalf ?? 45);
    if (after.dist > bodyAtWall) {
      this.x += (after.x - this.x) * 0.09;
      this.y += (after.y - this.y) * 0.09;
      this.angle += wrapAngle(after.angle - this.angle) * 0.10;
      this.speed *= 0.965;
    }

    // Effects only, and on the same barrier test: the pull above parks the
    // car just inside it, so a rival grinding along the wall is only PAST
    // the trigger on some frames -- 2 units of slack keeps the sparks
    // running for the whole scrape instead of strobing. A racing line that
    // runs the apex stays WALL_LINE_GAP short of this, so driving the line
    // never sparks.
    if (after.dist > bodyAtWall - 2) {
      const dx = this.x - after.x, dy = this.y - after.y;
      const d = Math.hypot(dx, dy) || 1;
      this._wallCooldown = Math.max(0, this._wallCooldown - dt);
      const impact = this._wallCooldown <= 0;
      this._wallCooldown = P.wallGraceWindow;
      setContact(this.contact, {
        impact,
        x: after.x + (dx / d) * this.wallHalf,
        y: after.y + (dy / d) * this.wallHalf,
        nx: dx / d,
        ny: dy / d,
        force: Math.min(1, this.speed / P.maxSpeed),
      });
    }

    this.onGrass = after.dist > this.roadHalf;
    this.near = after;
  }
}