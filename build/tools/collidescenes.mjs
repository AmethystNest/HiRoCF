/**
 * Contact scenarios with the game's real cars, hulls and resolveContacts:
 *   node build/tools/collidescenes.mjs [stages]                (dev server on :8099)
 * Rear-ends, side-swipes, T-bones, head-on. Reports the overlap left after resolving,
 * how far each car's heading was turned (and that it died away), speeds, NaNs.
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const STAGES = (process.argv[2] || '1,4').split(',').map(Number);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:8099/index.html?unlockall');
await page.waitForTimeout(1200);
await page.click('#titleStart');
await page.waitForFunction(() => window.__game, null, { timeout: 30000 });
for (const st of STAGES) {
  const out = await page.evaluate(async (st) => {
    const g = window.__game; window.__app.ticker.stop(); g.loadStage(st);
    const race = await import('/src/game/race.js?' + Date.now());
    const hull = await import('/src/game/hull.js?' + Date.now());
    const cfg = await import('/src/config.js');
    const P = g.player, R = g.rival, ms = cfg.PHYSICS.moveScale;
    const pS = g.playerHullSize, rS = g.rivalHullSize;
    const L = pS.h, W = pS.w;
    const res = [];
    // pose R relative to P (P at origin heading 0): ahead along x, right along y
    const run = (name, { ahead, right, rHead = 0, pSpeed, rSpeed, frames = 90 }) => {
      Object.assign(P, { x: 0, y: 0, angle: 0, speed: pSpeed, yawKick: 0, driftVisualAngle: 0, boosting: false, shake: 0, _carContactCooldown: 0 });
      Object.assign(R, { x: ahead, y: right, angle: rHead, speed: rSpeed, yawKick: 0, driftVisualAngle: 0, shake: 0, _carContactCooldown: 0, contactRecoveryTimer: 0 });
      let maxOverlap = 0, hit = false, nan = false, pYawMax = 0, rYawMax = 0, firstHit = -1, pMin = pSpeed, rMax = rSpeed;
      const p0 = P.angle, r0 = R.angle;
      for (let f = 0; f < frames; f++) {
        for (const c of [P, R]) { c.x += Math.cos(c.angle) * c.speed * ms / 60; c.y += Math.sin(c.angle) * c.speed * ms / 60; }
        race.resolveContacts([P, R], [pS, rS], 1 / 60);
        for (const c of [P, R]) {
          if (c.yawKick) { c.angle += c.yawKick / 60; c.yawKick *= Math.exp(-race.YAW_DECAY / 60); if (Math.abs(c.yawKick) < 0.01) c.yawKick = 0; }
        }
        const od = hull.overlapDepth(P, pS, R, rS);
        maxOverlap = Math.max(maxOverlap, od);
        if (P.carImpact || R.carImpact) { if (firstHit < 0) firstHit = f; hit = true; }
        pYawMax = Math.max(pYawMax, Math.abs(P.angle - p0)); rYawMax = Math.max(rYawMax, Math.abs(R.angle - r0));
        pMin = Math.min(pMin, P.speed); rMax = Math.max(rMax, R.speed);
        if (![P.x, P.y, P.angle, P.speed, R.x, R.y, R.angle, R.speed].every(Number.isFinite)) nan = true;
      }
      const deg = (r) => +(r * 180 / Math.PI).toFixed(1);
      res.push({ name, hit, firstHit, maxOverlapAfterResolve: +maxOverlap.toFixed(1), pYawMaxDeg: deg(pYawMax), rYawMaxDeg: deg(rYawMax), pYawEndDeg: deg(P.angle - p0), rYawEndDeg: deg(R.angle - r0), kickLeft: [+(P.yawKick || 0).toFixed(3), +(R.yawKick || 0).toFixed(3)], pSpeed: [Math.round(pSpeed), Math.round(P.speed)], rSpeed: [Math.round(rSpeed), Math.round(R.speed)], nan });
    };
    const rl = rS.h, half = (pS.h + rS.h) / 2;
    run('rear-end, centred', { ahead: half + 60, right: 0, pSpeed: 650, rSpeed: 400 });
    run('rear-end, R hit right of centre', { ahead: half + 60, right: 45, pSpeed: 650, rSpeed: 400 });
    run('rear-end, R hit left of centre', { ahead: half + 60, right: -45, pSpeed: 650, rSpeed: 400 });
    run('side-swipe, parallel, same speed', { ahead: 0, right: (pS.w + rS.w) / 2 * 0.6, pSpeed: 500, rSpeed: 500 });
    run('side-swipe, R angled in 8 deg', { ahead: 0, right: (pS.w + rS.w) / 2 * 0.62, rHead: -8 * Math.PI / 180, pSpeed: 500, rSpeed: 500 });
    run('nose to R rear quarter (P from left)', { ahead: rl * 0.25, right: -(pS.w + rS.w) / 2 * 0.9, rHead: 0, pSpeed: 620, rSpeed: 300 });
    run('T-bone: P into R side, middle', { ahead: 0, right: 250, rHead: 90 * Math.PI / 180, pSpeed: 0, rSpeed: 500 });
    run('T-bone: R across P nose, R rear third', { ahead: pS.h / 2 + 30, right: rl * 0.3, rHead: -90 * Math.PI / 180, pSpeed: 550, rSpeed: 200 });
    run('head-on', { ahead: 500, right: 0, rHead: Math.PI, pSpeed: 450, rSpeed: 450 });
    return res;
  }, st);
  console.log(`--- stage ${st}`);
  for (const r of out) console.log(JSON.stringify(r));
}
console.log('errors', JSON.stringify(errs));
await browser.close();
