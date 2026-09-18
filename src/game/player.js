/**
 * Player car physics.
 *
 * New implementation, but every constant comes from config.PHYSICS, which is
 * a verbatim carry-over of the Canvas build's tuning — the car must feel
 * identical.
 */
import { PHYSICS as P, DRIFT_MARK_LIFE } from '../config.js';

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
    this.boostEnergy = 100;
    this.shake = 0;
    this.wallStuckTime = 0;
    this.driftTrail = [];
    // how far the sprite should currently tilt off "straight ahead" to show
    // the drift -- see update() and main.js's playerSprite.rotation. Needed
    // because the camera itself is locked to `angle` (the world rotates so
    // the nose always points up-screen), which cancels out `angle` itself
    // and would otherwise hide any slip: the car would visibly slide
    // sideways but never look tilted while doing it.
    this.driftVisualAngle = 0;
    // Latched player drift state: brake + steer starts a slide. Once started,
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
    this.boostEnergy = 100;
    this.boosting = false;
    this.boostTimer = 0;
    this.wallStuckTime = 0;
    this.driftTrail.length = 0;
    this.drifting = false;
    this.driftSlipAngle = 0;
    this.driftVisualAngle = 0;
    this.driftSign = 0;
  }

  tryBoost() {
    if (this.boosting || this.boostEnergy < 99.5) return false;
    this.boosting = true;
    this.boostTimer = P.boostDuration;
    this.boostEnergy = 0;
    return true;
  }

  /** Speed shown on the HUD (km/h), same scaling as the original build. */
  get displaySpeed() {
    return this.speed * P.hudSpeedFactor * (this.boosting ? P.boostMoveScale : 1);
  }

  update(dt, input) {
    // Progress-local lookup, not a global one: on a course that crosses over
    // itself the two decks share an XY, and a global search would snap the
    // car's "own" centreline (hence its wall, its off-road test and its
    // racing line) onto whichever deck happens to be marginally closer.
    // See TrackPath.nearestLocal.
    const near = this.nearestOnRoute(this.x, this.y);
    const onGrass = near.dist > this.roadHalf;

    // --- boost ---
    if (this.boosting) {
      this.boostTimer -= dt;
      if (this.boostTimer <= 0) {
        this.boosting = false;
        this.boostTimer = 0;
      }
    } else {
      this.boostEnergy = Math.min(100, this.boostEnergy + P.boostRecover * dt);
    }

    // --- longitudinal ---
    this.speedTargetTimer -= dt;
    if (this.speedTargetTimer <= 0) this.rollSpeedTarget();

    const targetMax = onGrass ? P.grassMax : Math.min(P.maxSpeed, this.speedTarget);

    if (input.brake) {
      this.speed -= P.brake * 1.30 * dt;
    } else {
      const gap = targetMax - this.speed;
      if (gap > 0) {
        const accelScale = Math.max(P.accelScaleMin, Math.min(1, gap / P.accelGapSpan));
        const launch = this.speed < P.launchBoostBelow ? P.launchBoostMul : 1;
        this.speed += P.accel * accelScale * launch * dt;
      } else {
        this.speed -= P.coast * dt;
      }

      // Boost now adds actual acceleration as well as movement scaling.
      // It is strongest at low speed so pressing BOOST from a slow corner
      // clearly launches the car instead of only draining the gauge.
      if (this.boosting) {
        const boostAccelScale = 0.35 + 0.95 * (1 - Math.min(1, this.speed / P.maxSpeed));
        this.speed += P.accel * 1.55 * boostAccelScale * dt;
      }
    }
    this.speed = Math.max(0, Math.min(P.maxSpeed, this.speed));

    // --- steering ---
    const ratio = Math.min(1, this.speed / P.maxSpeed);
    let turnRate = P.turnLow + (P.turnHigh - P.turnLow) * Math.pow(ratio, P.turnCurveExp);
    turnRate *= 1.10;

    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);

    // Drift starts immediately when speed is high enough and BRAKE + steering
    // are pressed together. Once active it remains latched until the car
    // straightens, unless speed falls below the drift threshold.
    const driftTrigger =
      this.speed >= P.driftMinSpeed &&
      !!input.brake &&
      steer !== 0;
    if (!this.drifting && driftTrigger) {
      this.drifting = true;
      this.driftSign = steer > 0 ? 1 : -1;
    }

    // Low speed cannot sustain a drift. Drop back to grip as soon as the
    // speed falls below the same threshold used to enter the drift.
    if (this.drifting && this.speed < P.driftMinSpeed) {
      this.drifting = false;
      this.driftSign = 0;
    }

    if (this.drifting) turnRate *= P.driftTurnBoost;
    if (this.boosting) turnRate *= P.boostTurnMul;

    const steerScale = 1 - P.steerScaleAtTop * Math.pow(ratio, P.steerScaleExp);
    if (this.speed > P.minSteerSpeed) this.angle += steer * turnRate * steerScale * dt;

    // --- movement, with latched drift slip ---
    const moveSpeed = this.speed * P.moveScale * (this.boosting ? P.boostMoveScale : 1);
    let moveAngle = this.angle;
    let slipTarget = 0;
    if (this.drifting) {
      const fullSlip = this.driftSign * P.driftSlip * 0.42 * Math.min(1, this.speed / P.maxSpeed);

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
      if ((recovering && Math.abs(this.driftSlipAngle) < 0.022) || this.speed < P.driftMinSpeed * 0.58) {
        this.drifting = false;
        this.driftSlipAngle = 0;
        this.driftSign = 0;
      }
    } else {
      this.driftSlipAngle += (0 - this.driftSlipAngle) * (1 - Math.exp(-dt * 7));
    }

    // The sprite follows the actual slip state, so visual drift persists for
    // exactly as long as the physical slide does.
    this.driftVisualAngle += (this.driftSlipAngle - this.driftVisualAngle) * (1 - Math.exp(-dt * 10));

    this.x += Math.cos(moveAngle) * moveSpeed * dt;
    this.y += Math.sin(moveAngle) * moveSpeed * dt;

    for (const p of this.driftTrail) p.life -= dt;
    if (this.driftTrail.length && this.driftTrail[0].life <= 0) {
      this.driftTrail = this.driftTrail.filter((p) => p.life > 0);
    }

    // --- barrier: push back in and re-aim rather than hard-stopping ---
    const after = this.nearestOnRoute(this.x, this.y);
    const wallTrigger = this.wallHalf + this.wallTriggerExtra;
    if (after.dist > wallTrigger) {
      const dx = this.x - after.x, dy = this.y - after.y;
      const d = Math.hypot(dx, dy) || 1;
      const safe = this.wallHalf - P.wallInset;
      this.x = after.x + (dx / d) * safe;
      this.y = after.y + (dy / d) * safe;
      this.speed *= P.wallSpeedMul;
      this.shake = Math.max(this.shake, 9);
      this.wallStuckTime += dt;

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

    this.shake = Math.max(0, this.shake - dt * 26);
    this.onGrass = onGrass;
    this.near = after;
  }
}
