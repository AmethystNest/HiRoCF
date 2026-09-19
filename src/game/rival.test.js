import { describe, it, expect } from 'vitest';
import { STAGES, CAR_SIZE } from '../config.js';
import { STAGE_PATHS } from '../track/stages.js';
import { RivalCar } from './rival.js';

const WS = 2.77;                       // stage 4's worldScale
const cfg = STAGES[4];
const path = STAGE_PATHS[4]();
const STRAIGHT = Math.round(path.count * 0.53);

/**
 * Put the rival on a straight and hold a player alongside it, `lateral`
 * off the centreline, for `seconds`. Returns the rival's lateral offset
 * and its accumulated block bias at the end.
 */
function runAlongside({ sideBlock, lateral, gap = 0, seconds = 2.5, startLateral = -90 }) {
  const rival = new RivalCar(path, cfg, { ...cfg.rival, sideBlock });
  rival.bodyHalf = (CAR_SIZE[cfg.rival.sprite].w * WS) / 2;
  const at = path.offsetPoint(STRAIGHT, startLateral);
  rival.x = at.x; rival.y = at.y; rival.angle = path.tangents[STRAIGHT];
  rival._routeHint = STRAIGHT; rival.speed = 600; rival.raceTime = 30;

  const player = { x: 0, y: 0, angle: 0, speed: 600 };
  const dt = 1 / 60;
  let worstEdge = 0;
  for (let t = 0; t < seconds; t += dt) {
    const near = rival.nearestOnRoute(rival.x, rival.y);
    const spot = path.offsetPoint(near.index, lateral);
    player.x = spot.x; player.y = spot.y; player.angle = path.tangents[path.wrap(near.index)];
    rival.update(dt, { lap: 2, totalLaps: 3, player, gap });
    const n2 = rival.nearestOnRoute(rival.x, rival.y);
    worstEdge = Math.max(worstEdge, Math.abs(path.lateralOf(rival.x, rival.y, n2)) + rival.bodyHalf);
  }
  const near = rival.nearestOnRoute(rival.x, rival.y);
  return { lat: path.lateralOf(rival.x, rival.y, near), bias: rival._sideBlockBias, worstEdge };
}

describe('rival side block', () => {
  it('does nothing at all when the stage does not ask for it', () => {
    const r = runAlongside({ sideBlock: 0, lateral: 210 });
    expect(Math.abs(r.bias)).toBeLessThan(0.01);
  });

  it('leans toward the side the player came up', () => {
    const right = runAlongside({ sideBlock: 0.26, lateral: 210 });
    const left = runAlongside({ sideBlock: 0.26, lateral: -260, startLateral: 40 });
    expect(right.bias).toBeGreaterThan(40);
    expect(left.bias).toBeLessThan(-40);
  });

  it('eases across rather than swerving', () => {
    // a tenth of a second in, it has barely moved; a full second in, most
    // of the way. A block that snapped straight to full lean would be a
    // swipe at the player, not a door closing.
    const quick = runAlongside({ sideBlock: 0.26, lateral: 210, seconds: 0.1 });
    const settled = runAlongside({ sideBlock: 0.26, lateral: 210, seconds: 2.5 });
    expect(quick.bias).toBeLessThan(settled.bias * 0.25);
  });

  it('gives up once the player is properly past', () => {
    const past = runAlongside({ sideBlock: 0.26, lateral: 210, gap: -900 });
    expect(Math.abs(past.bias)).toBeLessThan(6);
  });

  it('ignores a player too far back to be overtaking', () => {
    // outside the abreast window: a car that distance behind is following,
    // not coming past, and a truck weaving at it would just look erratic
    const following = runAlongside({ sideBlock: 0.26, lateral: 210, gap: 1200 });
    expect(Math.abs(following.bias)).toBeLessThan(6);
  });

  it('never leans further than the stage asked for', () => {
    const full = cfg.rival.sideBlock * cfg.roadHalf;
    for (const lateral of [210, 340, -340]) {
      const r = runAlongside({ sideBlock: cfg.rival.sideBlock, lateral, seconds: 5 });
      expect(Math.abs(r.bias)).toBeLessThanOrEqual(full + 1);
    }
  });

  it('never leans far enough to hang the body off the road', () => {
    for (const lateral of [210, 300, -300]) {
      const r = runAlongside({ sideBlock: 0.26, lateral, seconds: 4 });
      expect(r.worstEdge).toBeLessThanOrEqual(cfg.roadHalf);
    }
  });
});
