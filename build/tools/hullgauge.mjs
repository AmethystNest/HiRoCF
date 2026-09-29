/**
 * How well does each collision hull agree with the car actually drawn?
 *
 *   node build/tools/hullgauge.mjs [circles|poly] [stages]     (dev server on :8099)
 *
 * Truth is the drawn silhouette (the sprite's alpha at its drawn size and heading).
 * The player and each stage's rival are posed at bearings and relative headings; the
 * second car is walked in until (a) the silhouettes first overlap and (b) the hull
 * first says touching. e = hull - truth: e > 0 daylight between the visible cars,
 * e < 0 the visible cars overlap by |e|, in world units. 'circles' is the old chain
 * (game/race.js hullCircles), 'poly' the silhouette hulls (game/hull.js). Numbers
 * when it was written, circles -> poly (max gap / max overlap): 44/-40 -> 16/0.
 */
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const MODEL = process.argv[2] || 'circles';
const STAGES = (process.argv[3] || '1,2,3,4,5').split(',').map(Number);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:8099/index.html?unlockall');
await page.waitForTimeout(1200);
await page.click('#titleStart');
await page.waitForFunction(() => window.__game, null, { timeout: 30000 });
const all = {};
for (const st of STAGES) {
  all[st] = await page.evaluate(async ({ st, MODEL }) => {
    const g = window.__game; window.__app.ticker.stop(); g.loadStage(st);
    const race = await import('/src/game/race.js?' + Date.now());
    const cfg = await import('/src/config.js');
    const hullMod = MODEL === 'poly' ? await import('/src/game/hull.js?' + Date.now()) : null;
    const s = g.worldScale;
    const pSize = { w: cfg.CAR_SIZE.player.w * s, h: cfg.CAR_SIZE.player.h * s };
    const rSize = g.rivalHullSize;

    // ---- silhouette masks of the DRAWN sprites
    const maskOf = (sprite, heading) => {
      const tex = sprite.texture, f = tex.frame;
      const W = Math.abs(sprite.width), H = Math.abs(sprite.height);
      const R = Math.ceil(Math.hypot(W, H) / 2) + 2, D = 2 * R + 1;
      const c = document.createElement('canvas'); c.width = D; c.height = D;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.translate(R + 0.5, R + 0.5); x.rotate(heading + Math.PI / 2);
      x.drawImage(tex.source.resource, f.x, f.y, f.width, f.height, -W / 2, -H / 2, W, H);
      const d = x.getImageData(0, 0, D, D).data;
      const grid = new Uint8Array(D * D), px = [];
      for (let yy = 0; yy < D; yy++) for (let xx = 0; xx < D; xx++) if (d[(yy * D + xx) * 4 + 3] > 12) { grid[yy * D + xx] = 1; px.push(xx - R, yy - R); }
      return { grid, D, R, px };
    };
    const maskP = maskOf(g.playerSprite, 0);
    const overlapMasks = (A, B, rx, ry) => {
      const ix = Math.round(rx), iy = Math.round(ry);
      for (let i = 0; i < B.px.length; i += 2) {   // every opaque pixel of B (already ~1 unit)
        const ax = B.px[i] + ix + A.R, ay = B.px[i + 1] + iy + A.R;
        if (ax >= 0 && ay >= 0 && ax < A.D && ay < A.D && A.grid[ay * A.D + ax]) return true;
      }
      return false;
    };

    // ---- the model's own idea of touching
    const modelTouch = (heading, rx, ry) => {
      const a = { x: 0, y: 0, angle: 0 }, b = { x: rx, y: ry, angle: heading };
      if (MODEL === 'poly') return hullMod.overlapDepth(a, { ...pSize, poly: g.playerHullSize?.poly }, b, { ...rSize, poly: g.rivalHullSize.poly }) > 0;
      const ha = race.hullCircles(a, pSize), hb = race.hullCircles(b, rSize);
      for (const ca of ha) for (const cb of hb) if (Math.hypot(cb.x - ca.x, cb.y - ca.y) < ca.r + cb.r) return true;
      return false;
    };

    const reach = Math.hypot(pSize.w, pSize.h) / 2 + Math.hypot(rSize.w, rSize.h) / 2 + 20;
    const touch = (fn, phi, heading) => {   // largest distance along the bearing at which fn says touching
      const cx = Math.cos(phi), cy = Math.sin(phi);
      let dd = reach;
      for (; dd > 0; dd -= 6) if (fn(heading, cx * dd, cy * dd)) break;
      if (dd <= 0) return 0;
      for (let f = dd + 6; f > dd; f -= 1) if (fn(heading, cx * f, cy * f)) return f;   // refine: first overlap coming in from far
      return dd;
    };
    const rows = [];
    for (const dh of [0, 20, -20, 90, 180]) {
      const heading = dh * Math.PI / 180;
      const maskR = maskOf(g.rivalSprite, heading);
      const truth = (h, rx, ry) => overlapMasks(maskP, maskR, rx, ry);
      const es = [], detail = {};
      for (let deg = 0; deg < 360; deg += 15) {
        const phi = deg * Math.PI / 180;
        const dt = touch(truth, phi, heading), dm = touch(modelTouch, phi, heading);
        es.push(dm - dt); detail[deg] = +(dm - dt).toFixed(1);
      }
      rows.push({ dh, maxGap: +Math.max(...es).toFixed(1), maxBury: +Math.min(...es).toFixed(1), meanAbs: +(es.reduce((a, b) => a + Math.abs(b), 0) / es.length).toFixed(1), alongside: [detail[90], detail[270]], nose_tail: [detail[0], detail[180]] });
    }
    return { rival: g.cfg.rival.sprite, pW: Math.round(pSize.w), pH: Math.round(pSize.h), rW: Math.round(rSize.w), rH: Math.round(rSize.h), rows };
  }, { st, MODEL });
}
console.log('MODEL', MODEL, '(units = world units; screen px = units x zoom ~', '0.4..1)');
for (const [st, v] of Object.entries(all)) {
  console.log(`stage ${st} rival=${v.rival} hull ${v.rW}x${v.rH} player ${v.pW}x${v.pH}`);
  for (const r of v.rows) console.log(`   dHeading ${String(r.dh).padStart(4)}  maxGap ${String(r.maxGap).padStart(6)}  maxBury ${String(r.maxBury).padStart(6)}  mean|e| ${String(r.meanAbs).padStart(5)}  alongside(90/270) ${JSON.stringify(r.alongside)}  nose-tail(0/180) ${JSON.stringify(r.nose_tail)}`);
}
console.log('errors', JSON.stringify(errs));
await browser.close();
