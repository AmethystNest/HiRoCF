/**
 * Player car physics.
 *
 * New implementation, but every constant comes from config.PHYSICS, which is
 * a verbatim carry-over of the Canvas build's tuning — the car must feel
 * identical.
 */
import { PHYSICS as P, NITRO, DRIFT_MARK_LIFE } from '../config.js';
import { bodyPastBarrier } from './race.js';
import { makeContact, setContact } from './contact.js';

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class PlayerCar {
  constructor(path, cfg) {
    this.path = path;
    this.roadHalf = cfg.roadHalf;
    this.wallHalf = cfg.wallHalf;
    this.wallTriggerExtra = cfg.wallTriggerExtra ?? 8;

    this.x = 0; this.y = 0; this.angle = 0;
    this.speed = 0;
    this.drifting = false;
    this.boosting = false;
    this.boostTimer = 0;
    // Banked nitro charges, plus the 0-100 meter working toward the next
    // one. See NITRO in config.js and tryNitro below.
    this.nitroStock = NITRO.startStock;
    this.nitroCharge = 0;
    this.shake = 0;
    this.wallStuckTime = 0;
    // Contact state for the barrier -- see the impact/graze split in
    // update(). _wallCooldown counts down while a contact event is still
    // "recent"; wallImpact is public and true for exactly the frame a new
    // event begins.
    this._wallCooldown = 0;
    this.wallImpact = false;
    /** Where and how hard this car last touched something -- see contact.js. */
    this.contact = makeContact();
    this.driftTrail = [];
    // how far the sprite should currently tilt off "straight ahead" to show
    // the drift -- see update() and main.js's playerSprite.rotation. Needed
    // because the camera itself is locked to `angle` (the world rotates so
    // the nose always points up-screen), which cancels out `angle` itself
    // and would otherwise hide any slip: the car would visibly slide
    // sideways but never look tilted while doing it.
    this.driftVisualAngle = 0;
    // Latched player drift state: BRAKE and steering held together for
    // driftHoldTime starts a slide (shorter presses stay on grip). Once started,
    // releasing the brake does not cancel it; the slide stays active until
    // the slip angle has naturally returned close to straight.
    this.driftSlipAngle = 0;
    this.driftSign = 0;

    this.speedTarget = 0;
    this.speedTargetTimer = 0;
    // Rolling centreline index, so route lookups stay on this car's own
    // stretch of road where the course crosses over itself.
    this._routeHint = null;
    this.rollSpeedTarget();
  }

  /**
   * Nearest centreline point on this car's own stretch of route. Tracked by
   * a rolling index hint rather than searched globally -- see
   * TrackPath.nearestLocal for why that matters at a crossing.
   */
  nearestOnRoute(x, y) {
    const n = this.path.nearestLocal(x, y, this._routeHint, 90, this.wallHalf * 4);
    this._routeHint = n.index;
    return n;
  }

  rollSpeedTarget() {
    this.speedTarget = P.speedTargetBase + Math.random() * P.speedTargetSpread;
    this.speedTargetTimer = P.speedTargetMinHold + Math.random() * P.speedTargetSpreadHold;
  }

  placeAtStart(distance = 0, lateral = 0) {
    const s = this.path.sample(distance);
    const k = s.index;
    this.x = s.x + this.path.normals[k * 2] * lateral;
    this.y = s.y + this.path.normals[k * 2 + 1] * lateral;
    this.angle = s.angle;
    this._routeHint = k;
    this.speed = 0;
    this.nitroStock = NITRO.startStock;
    this.nitroCharge = 0;
    this.boosting = false;
    this.boostTimer = 0;
    this.wallStuckTime = 0;
    this._wallCooldown = 0;
    this.wallImpact = false;
    this.driftTrail.length = 0;
    this.drifting = false;
    this.driftSlipAngle = 0;
    this.driftVisualAngle = 0;
    this.driftSign = 0;
    // how long BRAKE and steering have been held together (drift trigger)
    this._coHold = 0;
    this.boostMix = 0;
  }

  /**
   * Spend one banked charge. Returns false without spending anything if
   * there is none, or if the press would waste one -- see NITRO.chainWindow
   * in config.js for why both halves of that rule exist.
   */
  tryNitro() {
    if (this.nitroStock <= 0) return false;
    if (this.boosting && this.boostTimer > NITRO.chainWindow) return false;
    this.nitroStock--;
    // Extend, never restart: whatever is left of the running burst is kept
    // and this charge's full duration is added on top of it.
    this.boostTimer += P.boostDuration;
    this.boosting = true;
    return true;
  }

  /** Speed shown on the HUD (km/h), same scaling as the original build. */
  /**
   * The fastest this car can yaw at its current speed on grip alone -- the
   * steering block in update() at full lock, before any drift or nitro
   * multiplier. Used to tell how close to the limit a corner is being
   * taken (see main.js's tyreSlip); kept in step with update() by hand.
   */
  maxYawRate() {
    const ratio = Math.min(1, this.speed / P.maxSpeed);
    const turnRate = (P.turnLow + (P.turnHigh - P.turnLow) * Math.pow(ratio, P.turnCurveExp)) * 1.10;
    const steerScale = 1 - P.steerScaleAtTop * Math.pow(ratio, P.steerScaleExp);
    return turnRate * steerScale;
  }

  /** Slip angle of a fully committed drift at the current speed (rad). */
  fullDriftAngle() {
    const ratio = Math.min(1, this.speed / P.maxSpeed);
    return P.driftAngleMax * (1 - P.driftAngleSpeedShare + P.driftAngleSpeedShare * ratio);
  }

  /** The nitro's effect eased in and out (0..1), see boostRampUp/Down. */
  get boostEase() {
    const t = this.boostMix ?? 0;
    return t * t * (3 - 2 * t);
  }

  /** Movement (and dial) multiplier from the nitro at this instant. */
  get boostFactor() {
    return 1 + (P.boostMoveScale - 1) * this.boostEase;
  }

  get displaySpeed() {
    return this.speed * P.hudSpeedFactor * this.boostFactor;
  }

  update(dt, input) {
    // Progress-local lookup, not a global one: on a course that crosses over
    // itself the two decks share an XY, and a global search would snap the
    // car's "own" centreline (hence its wall, its off-road test and its
    // racing line) onto whichever deck happens to be marginally closer.
    // See TrackPath.nearestLocal.
    const near = this.nearestOnRoute(this.x, this.y);
    const onGrass = near.dist > (this.halfWidth ? this.halfWidth[near.index] : this.roadHalf);

    // --- nitro ---
    if (this.boosting) {
      this.boostTimer -= dt;
      if (this.boostTimer <= 0) {
        this.boosting = false;
        this.boostTimer = 0;
      }
    }
    // how far in the nitro's effect is (see boostRampUp/Down)
    {
      const rate = this.boosting ? 1 / P.boostRampUp : -1 / P.boostRampDown;
      this.boostMix = Math.max(0, Math.min(1, (this.boostMix ?? 0) + rate * dt));
    }
    if (this.boosting) {
      // (recharge is frozen for as long as a burst is running)
    } else if (this.nitroStock < NITRO.maxStock) {
      // The meter is frozen for as long as a burst is running, as it was
      // with the single boost. That is what a chain costs: three charges
      // spent back to back also buy seven seconds of no recharge.
      this.nitroCharge += P.boostRecover * dt;
      while (this.nitroCharge >= 100 && this.nitroStock < NITRO.maxStock) {
        this.nitroCharge -= 100;
        this.nitroStock++;
      }
      if (this.nitroStock >= NITRO.maxStock) this.nitroCharge = 0;
    }

    // --- longitudinal ---
    this.speedTargetTimer -= dt;
    if (this.speedTargetTimer <= 0) this.rollSpeedTarget();

    // Leaving the pavement costs nothing: the only thing that still slows a
    // car down is hitting the barrier. `onGrass` survives for the dust
    // thrown up off the verge (see contactfx), not as a speed penalty.
    const targetMax = Math.min(P.maxSpeed, this.speedTarget);

    if (input.brake) {
      this.speed -= P.brake * P.brakeMul * dt;
    } else {
      const gap = targetMax - this.speed;
      if (gap > 0) {
        const accelScale = Math.max(P.accelScaleMin, Math.min(1, gap / P.accelGapSpan));
        const launch = this.speed < P.launchBoostBelow ? P.launchBoostMul : 1;
        this.speed += P.accel * accelScale * launch * dt;
      } else {
        this.speed -= P.coast * dt;
      }

      // Nitro adds actual acceleration as well as movement scaling. It is
      // strongest at low speed so firing one out of a slow corner clearly
      // launches the car instead of only draining the gauge.
      if (this.boostEase > 0) {
        const boostAccelScale = 0.35 + 0.95 * (1 - Math.min(1, this.speed / P.maxSpeed));
        this.speed += P.accel * 1.55 * boostAccelScale * this.boostEase * dt;
      }
    }
    // A slide costs speed, in proportion to how deep it is (driftScrub);
    // last frame's depth, as for the turn rate below.
    if (this.drifting) this.speed -= this.speed * P.driftScrub * (this.driftDepth ?? 0) * dt;
    this.speed = Math.max(0, Math.min(P.maxSpeed, this.speed));

    // --- steering ---
    const ratio = Math.min(1, this.speed / P.maxSpeed);
    let turnRate = P.turnLow + (P.turnHigh - P.turnLow) * Math.pow(ratio, P.turnCurveExp);
    turnRate *= 1.10;

    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);

    // Drift or grip is decided by how LONG BRAKE and steering are held down
    // together: past P.driftHoldTime the car breaks into a drift, and any
    // shorter press only slows it on grip. (Two earlier rules: any moment
    // with both held -- no grip braking at all; then the order of the two
    // -- but they arrive together in nearly every corner of this game.)
    // Only above P.driftDial on the dial.
    this._coHold = input.brake && steer !== 0 ? (this._coHold ?? 0) + dt : 0;
    const fastEnough = this.displaySpeed > P.driftDial;
    const driftTrigger = fastEnough && steer !== 0 && this._coHold >= P.driftHoldTime;
    if (!this.drifting && driftTrigger) {
      this.drifting = true;
      this.driftSign = steer > 0 ? 1 : -1;
    }

    // Low speed cannot sustain a drift. Drop back to grip as soon as the
    // dial falls to the same threshold used to enter the drift.
    if (this.drifting && !fastEnough) {
      this.drifting = false;
      this.driftSign = 0;
    }

    // How deep the slide is, as a share of the full slip angle at this
    // speed (the same fullSlip as below, last frame's angle): the turn rate
    // grows with it (see driftTurnMin/Max).
    this.driftDepth = 0;
    if (this.drifting) {
      const full = this.fullDriftAngle();
      this.driftDepth = full > 1e-4 ? Math.min(1, Math.abs(this.driftSlipAngle) / full) : 0;
      turnRate *= P.driftTurnMin + (P.driftTurnMax - P.driftTurnMin) * this.driftDepth;
    }
    turnRate *= 1 + (P.boostTurnMul - 1) * this.boostEase;

    const steerScale = 1 - P.steerScaleAtTop * Math.pow(ratio, P.steerScaleExp);
    if (this.speed > P.minSteerSpeed) {
      this.angle += steer * turnRate * steerScale * dt;
      // Wheel released mid-slide: the car carries on rotating with the
      // slide, easing off as the slide does, instead of stopping dead.
      if (this.drifting && steer === 0) {
        this.angle += this.driftSign * turnRate * steerScale * P.driftCarryYaw * this.driftDepth * dt;
      }
    }

    // --- movement, with latched drift slip ---
    const moveSpeed = this.speed * P.moveScale * this.boostFactor;
    let moveAngle = this.angle;
    let slipTarget = 0;
    if (this.drifting) {
      const fullSlip = this.driftSign * this.fullDriftAngle();

      // Keep the slide while steering into it. Releasing the wheel lets the
      // rear progressively settle; counter-steering settles it more quickly.
      if (steer === this.driftSign) slipTarget = fullSlip;
      else slipTarget = 0;

      const recovering = steer !== this.driftSign;
      const response = recovering ? (steer === 0 ? 5.2 : 7.4) : 9.0;
      this.driftSlipAngle += (slipTarget - this.driftSlipAngle) * (1 - Math.exp(-dt * response));

      moveAngle -= this.driftSlipAngle;
      this.driftTrail.push({ x: this.x, y: this.y, life: DRIFT_MARK_LIFE });
      if (this.driftTrail.length > 160) this.driftTrail.shift();

      // Do not terminate just because BRAKE was released. Only end once the
      // car has genuinely straightened, or speed has fallen very low.
      if (recovering && Math.abs(this.driftSlipAngle) < 0.022) {
        this.drifting = false;
        this.driftSlipAngle = 0;
        this.driftSign = 0;
      }
    } else {
      this.driftSlipAngle += (0 - this.driftSlipAngle) * (1 - Math.exp(-dt * 7));
    }

    // The sprite follows the actual slip state, so visual drift persists for
    // exactly as long as the physical slide does.
    this.driftVisualAngle += (this.driftSlipAngle * P.driftVisualGain - this.driftVisualAngle) * (1 - Math.exp(-dt * 10));

    this.x += Math.cos(moveAngle) * moveSpeed * dt;
    this.y += Math.sin(moveAngle) * moveSpeed * dt;

    for (const p of this.driftTrail) p.life -= dt;
    if (this.driftTrail.length && this.driftTrail[0].life <= 0) {
      this.driftTrail = this.driftTrail.filter((p) => p.life > 0);
    }

    // --- barrier: push back in and re-aim rather than hard-stopping ---
    const after = this.nearestOnRoute(this.x, this.y);
    // Against the barrier the course actually SHOWS here (main.js's
    // `barrier`), and with the car's drawn body rather than its centre
    // (bodyPastBarrier in race.js). This used to be the centre against
    // cfg.wallHalf + wallTriggerExtra, which was wrong both ways at once:
    // on most stages cfg.wallHalf sits in open ground well short of
    // anything drawn, so the car hit nothing visible, and where a wall IS
    // drawn at it (stage 4's crash walls) the body had to be ~55 units
    // INSIDE the concrete before the centre reached the trigger.
    const barrier = this.barrier;
    const hit = bodyPastBarrier(
      this, this.path, (i, side) => {
        if (!barrier) return this.wallHalf;
        const bs = this.barrierSide;
        return bs ? (side > 0 ? bs.pos[i] : bs.neg[i]) : barrier[i];
      },
      this.wallBody ?? { hw: 49, hl: 110, ox: 0, oy: 0 },
      after.index, this.wallHalf * 4,
    );
    const over = hit.over;
    const touchingWall = over > 0;
    // A frame-to-frame "was it touching last frame" test does NOT work
    // for telling an impact from a graze: the position snap below pulls
    // the body back to wallInset clear of the wall, so a
    // car still steering into the barrier spends a couple of frames back
    // under the trigger before it crosses out again -- and each re-crossing
    // then reads as a brand new impact, one every 3-4 frames, which is the
    // exact repeated-crash behaviour this is meant to fix. A short time
    // window bridges those gaps: contact within wallGraceWindow of the
    // last one counts as the SAME ongoing contact.
    this._wallCooldown = Math.max(0, this._wallCooldown - dt);
    // True only on the frame a NEW contact event begins -- main.js reads
    // this to fire a spark burst once per hit, not once per frame of a
    // held one.
    this.wallImpact = touchingWall && this._wallCooldown <= 0;
    if (touchingWall) {
      // Out by exactly how far the body went in, plus wallInset -- the same
      // small margin inside the wall the old centre snap parked it at.
      this.x -= hit.nx * (over + P.wallInset);
      this.y -= hit.ny * (over + P.wallInset);
      // The full penalty is an IMPACT, and only happens on the frame
      // contact begins. Steering stays pinned into the barrier easily
      // (cornering wide, holding a slide), and the old check reapplied
      // wallSpeedMul's ~38% cut on every one of the frames that produces,
      // cratering the car's speed in under ten frames. A continuing graze
      // bleeds off wallScrubMul's much smaller cut instead -- friction,
      // not a second crash every tick.
      this.speed *= this.wallImpact ? P.wallSpeedMul : P.wallScrubMul;
      this.shake = Math.max(this.shake, this.wallImpact ? 9 : 3);
      this.wallStuckTime += dt;
      this._wallCooldown = P.wallGraceWindow;

      let tangent = after.angle;
      if (Math.abs(wrapAngle(tangent + Math.PI - this.angle)) < Math.abs(wrapAngle(tangent - this.angle))) {
        tangent += Math.PI;
      }
      this.angle += wrapAngle(tangent - this.angle) * P.wallAngleBlend;

      if (this.wallStuckTime > P.wallStuckTime && this.speed < P.wallStuckSpeed) {
        this.x = after.x;
        this.y = after.y;
        this.angle = tangent;
        this.wallStuckTime = 0;
      }
    } else {
      this.wallStuckTime = Math.max(0, this.wallStuckTime - dt * 2.5);
    }

    // Effects only, and deliberately NOT gated on `touchingWall`. The snap
    // above parks the car at `safe`, inside the trigger, so a car grinding
    // along the barrier is only PAST the trigger on about one frame in
    // four -- driving the sparks off that would strobe them. Riding at or
    // beyond the snap radius is the honest "still rubbing" test, true on
    // every frame of a grind and false as soon as the car steers off.
    // The contact patch is the barrier face, not the middle of the roof,
    // which is where a burst placed on the car itself appears to come from.
    // Where the body sits NOW relative to the wall (the snap above leaves
    // it wallInset inside); same 2 units of slack as before.
    const restOver = touchingWall ? -P.wallInset : over;
    if (restOver > -P.wallInset - 2) {
      setContact(this.contact, {
        impact: this.wallImpact,
        x: hit.x,
        y: hit.y,
        nx: hit.nx,
        ny: hit.ny,
        force: Math.min(1, this.speed / P.maxSpeed),
      });
    }

    this.shake = Math.max(0, this.shake - dt * 26);
    this.onGrass = onGrass;
    this.near = after;
  }
}
