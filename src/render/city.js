/**
 * Stage 2's town: the street grid the course is one loop of.
 *
 * The course alone is a closed loop of road through open ground, and no
 * amount of kerbside decoration makes that read as a town -- the corners
 * are junctions with no second road in them, the crossings and signals
 * stand at places nothing crosses, and past the pavement there is nothing
 * but dirt. What makes a street a street from directly above is the grid
 * it belongs to: the road it turns off carrying straight on, cross streets
 * running away between blocks, and the blocks themselves built up to the
 * pavement.
 *
 * So the town is authored as that grid (layouts.js `cityGrid`: every
 * course straight lies on one of its lines) and everything here is derived
 * from it:
 *
 *  - `buildCityUnderlay` draws the streets, blocks, buildings, car parks
 *    and parks. It goes UNDER the course's own surface (buildSurface's
 *    `underlay`), so the course -- its asphalt, markings and pavement --
 *    is always drawn over it and nothing here can cover the road being
 *    driven.
 *  - `streetMouths` finds, per route index and side, where a street meets
 *    the course. buildSurface leaves the course's pavement out there
 *    (`gaps`), which is what opens the junction: the street's asphalt,
 *    underneath, shows through the gap.
 *  - `buildBarricades` closes each of those mouths along the course's own
 *    collision wall -- a side street you can see into is one you would
 *    expect to drive into, and an invisible wall across an open road reads
 *    as a bug.
 *  - `routeCrossroads` finds where a street crosses a course straight, for
 *    the crossings and signals buildSurface paints there.
 *
 * Purely visual: nothing here touches collision, progress or the AI.
 */
import { Container, Graphics, Sprite, TilingSprite } from '../pixi.js';

/** Deterministic RNG, same as props.js, so the town is identical every load. */
function mulberry32(seed) {
  return function rng() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The city preset's pavement, strip by strip (surfaces.js SURFACE_PRESETS
// .city.bands), so a side street is built exactly like the course it meets.
const GUTTER = { w: 14, c: 0x5c6167 };
const KERB = { w: 10, c: 0xc8ccd0 };
const GRIME = { w: 34, c: 0x7d848b };
const PAVING = 0x969ea6;
const ASPHALT_TINT = 0xa6abb2;
const FORECOURT = 40;      // paving carried on past the pavement to the building line

/**
 * The grid as street segments. `v` streets run north-south at x = c,
 * the others east-west at y = c; each spans a0..a1 along its own axis.
 */
export function cityStreets(def) {
  return def.streets.map((s) => (s.x != null
    ? { v: true, c: s.x, a0: s.from, a1: s.to }
    : { v: false, c: s.y, a0: s.from, a1: s.to }));
}

/** Lateral (across) and along coordinates of (x, y) against a street. */
function local(s, x, y) {
  return s.v ? { d: x - s.c, a: y } : { d: y - s.c, a: x };
}

/** Is (x, y) within `half` of the street's axis, inside its length? */
function inStreet(s, x, y, half) {
  const { d, a } = local(s, x, y);
  return Math.abs(d) <= half && a >= s.a0 - half && a <= s.a1 + half;
}

/** Exact distance to the course's centreline. TrackPath.nearest only looks
 *  one 400-unit cell around the point, which is not enough out here. */
function routeDistance(path) {
  const pts = path.points;
  return (x, y) => {
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i][0] - x, dy = pts[i][1] - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
}

/**
 * Per route index, for each side (`pos`: the +normal side), 1 where that
 * side's pavement is a street mouth instead: where the middle of the
 * pavement falls on some street's asphalt. The course's own street never
 * qualifies along a straight -- its asphalt ends at the pavement's inner
 * edge -- so only a road meeting the course does.
 */
export function streetMouths(path, streets, { roadHalf, pave, streetHalf }) {
  const n = path.count;
  const pos = new Uint8Array(n), neg = new Uint8Array(n);
  const mid = roadHalf + pave / 2;
  for (let i = 0; i < n; i++) {
    for (const [side, out] of [[1, pos], [-1, neg]]) {
      const p = path.offsetPoint(i, side * mid);
      if (streets.some((s) => inStreet(s, p.x, p.y, streetHalf))) out[i] = 1;
    }
  }
  return { pos, neg };
}

/**
 * Route indices where a street crosses a course STRAIGHT at right angles
 * (not the corners, where the course turns from one street into another --
 * those are found from the course's curvature, as on every street stage).
 */
export function routeCrossroads(path, streets, streetHalf) {
  const hits = [];
  let run = null;
  for (let i = 0; i <= path.count; i++) {
    const k = path.wrap(i);
    const [x, y] = path.points[k];
    const a = path.tangents[k];
    const tx = Math.cos(a), ty = Math.sin(a);
    const on = i < path.count && streets.some((s) => inStreet(s, x, y, streetHalf)
      // across the street, not along it
      && Math.abs(s.v ? ty : tx) < 0.15);
    if (on && !run) run = [i, i];
    else if (on) run[1] = i;
    else if (run) { hits.push(Math.round((run[0] + run[1]) / 2)); run = null; }
  }
  return hits;
}

/**
 * Water-filled barriers across every street mouth, standing on the course's
 * collision wall (`barrier`, per index) so the car stops against them.
 */
export function buildBarricades(path, streets, barrier, { pave }) {
  const g = new Graphics();
  g.label = 'barricades';
  const DEPTH = 30, UNIT = 96, GAP = 8;
  for (const side of [1, -1]) {
    const flag = new Uint8Array(path.count);
    for (let i = 0; i < path.count; i++) {
      const p = path.offsetPoint(i, side * (barrier[i] + DEPTH / 2));
      if (streets.some((s) => inStreet(s, p.x, p.y, pave))) flag[i] = 1;
    }
    // runs of flagged indices, one point wider at each end so the line
    // tucks into the corner of the block on either side
    let from = 0;
    while (from < path.count && flag[from]) from++;
    const runs = [];
    let start = -1;
    for (let o = 0; o <= path.count; o++) {
      const on = o < path.count && flag[path.wrap(from + o)];
      if (on && start < 0) start = o;
      else if (!on && start >= 0) { runs.push([from + start - 1, from + o]); start = -1; }
    }
    for (const [a, b] of runs) {
      // the wall's face and the barrier's back, as two polylines with
      // their running length
      const inner = [], outer = [], len = [0];
      for (let o = a; o <= b; o++) {
        const k = path.wrap(o);
        const p = path.offsetPoint(k, side * barrier[k]);
        const q = path.offsetPoint(k, side * (barrier[k] + DEPTH));
        if (inner.length) {
          const l = inner[inner.length - 1];
          len.push(len[len.length - 1] + Math.hypot(p.x - l[0], p.y - l[1]));
        }
        inner.push([p.x, p.y]);
        outer.push([q.x, q.y]);
      }
      const total = len[len.length - 1];
      const pointAt = (line, d) => {
        let j = 1;
        while (j < len.length - 1 && len[j] < d) j++;
        const t = (d - len[j - 1]) / Math.max(1e-6, len[j] - len[j - 1]);
        return [line[j - 1][0] + (line[j][0] - line[j - 1][0]) * t, line[j - 1][1] + (line[j][1] - line[j - 1][1]) * t];
      };
      // shadow cast away from the road, then the units themselves
      for (let j = 0; j < outer.length - 1; j++) {
        const [x0, y0] = outer[j], [x1, y1] = outer[j + 1];
        g.poly([x0, y0, x1, y1, x1 + 14, y1 + 20, x0 + 14, y0 + 20]).fill({ color: 0x0a0d10, alpha: 0.28 });
      }
      const n = Math.max(1, Math.round(total / UNIT));
      const unit = total / n;
      for (let u = 0; u < n; u++) {
        const d0 = u * unit + GAP / 2, d1 = (u + 1) * unit - GAP / 2;
        const pts = [];
        for (let m = 0; m <= 3; m++) {
          const d = d0 + ((d1 - d0) * m) / 3;
          pts.push(pointAt(inner, d));
        }
        for (let m = 3; m >= 0; m--) {
          const d = d0 + ((d1 - d0) * m) / 3;
          pts.push(pointAt(outer, d));
        }
        const colour = u % 2 ? 0xf1f1ee : 0xd23a2c;
        g.poly(pts.flat()).fill({ color: colour });
        // the water-filler cap, a lighter spot on top
        const c = pointAt(inner, (d0 + d1) / 2), c2 = pointAt(outer, (d0 + d1) / 2);
        g.circle((c[0] + c2[0]) / 2, (c[1] + c2[1]) / 2, 6).fill({ color: u % 2 ? 0xd9d9d4 : 0xf08070 });
      }
    }
  }
  return g;
}

/**
 * Everything in the town that is not the course: streets, blocks and what
 * stands on them. See the header.
 */
export function buildCityUnderlay(path, tex, sheet, shadowTex, def, {
  roadHalf, pave, worldScale = 1, carWidth = 176, seed = 2,
}) {
  const rng = mulberry32(seed * 3301 + 17);
  const streets = cityStreets(def);
  const H = def.streetHalf;             // a side street's carriageway half-width
  const C = H + pave;                   // ...and its full corridor
  const dist = routeDistance(path);
  // anything built must stand clear of the course's pavement
  const clearOfRoute = roadHalf + pave + FORECOURT - 4;

  const root = new Container();
  root.label = 'city';
  const cull = [];

  // --- the extent of the ground plane (buildSurface's pad) ---
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of path.points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const PAD = roadHalf + 3200;
  const bx0 = minX - PAD, by0 = minY - PAD, bx1 = maxX + PAD, by1 = maxY + PAD;

  // Everything is drawn into chunks of the map, one per layer, so the
  // per-frame cull in main.js (cullProps) can skip the parts of the town
  // that are off screen -- as one mesh per layer the whole town, a map
  // five times the size of the view, was drawn every frame.
  const CH = 2000;
  const chunked = (parent, make = () => new Graphics()) => {
    const map = new Map();
    const get = (x, y) => {
      const i = Math.floor(x / CH), j = Math.floor(y / CH);
      const key = `${i},${j}`;
      let g = map.get(key);
      if (!g) {
        g = make();
        parent.addChild(g);
        map.set(key, g);
        cull.push({ node: g, x: (i + 0.5) * CH, y: (j + 0.5) * CH, r: CH * 0.7072 + 700 });
      }
      return g;
    };
    // axis-aligned rects are split at the chunk lines, everything else goes
    // to the chunk its middle is in
    const cells = (x, y, w, h, fn) => {
      const i0 = Math.floor(x / CH), i1 = Math.floor((x + w - 1e-6) / CH);
      const j0 = Math.floor(y / CH), j1 = Math.floor((y + h - 1e-6) / CH);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const x0 = Math.max(x, i * CH), x1 = Math.min(x + w, (i + 1) * CH);
          const y0 = Math.max(y, j * CH), y1 = Math.min(y + h, (j + 1) * CH);
          if (x1 > x0 && y1 > y0) fn(get((i + 0.5) * CH, (j + 0.5) * CH), x0, y0, x1 - x0, y1 - y0);
        }
      }
    };
    return {
      get, cells,
      rect: (x, y, w, h) => ({ fill: (st) => cells(x, y, w, h, (g, a, b, c, d) => g.rect(a, b, c, d).fill(st)) }),
      circle: (x, y, r) => ({ fill: (st) => get(x, y).circle(x, y, r).fill(st) }),
      poly: (pts) => ({
        fill: (st) => {
          let cx = 0, cy = 0;
          for (let k = 0; k < pts.length; k += 2) { cx += pts[k]; cy += pts[k + 1]; }
          const n = pts.length / 2;
          get(cx / n, cy / n).poly(pts).fill(st);
        },
      }),
    };
  };
  const layers = {};
  for (const name of ['parks', 'lots', 'pavement', 'kerbs', 'asphalt', 'marks', 'shadows', 'roofs']) {
    layers[name] = new Container();
    layers[name].label = `city-${name}`;
  }
  const sprites = new Container();
  layers.shadows.alpha = 0.3;
  root.addChild(...Object.values(layers), sprites);
  const pavement = chunked(layers.pavement), kerbs = chunked(layers.kerbs), marks = chunked(layers.marks);
  const lots = chunked(layers.lots), shadows = chunked(layers.shadows), roofs = chunked(layers.roofs);
  const asphalt = chunked(layers.asphalt, () => new Container());
  const parks = chunked(layers.parks, () => new Container());


  // --- streets ---
  const rect = (g, x0, y0, x1, y1, color, alpha = 1) =>
    g.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)).fill({ color, alpha });
  // (x, y) from a street's own (lateral, along)
  const at = (s, d, a) => (s.v ? [s.c + d, a] : [a, s.c + d]);
  const srect = (g, s, d0, d1, a0, a1, color, alpha) => {
    const [x0, y0] = at(s, d0, a0), [x1, y1] = at(s, d1, a1);
    rect(g, x0, y0, x1, y1, color, alpha);
  };
  const tile = tex.road_asphalt;
  const tw = tile?.width || 256, th = tile?.height || 256;
  // Stretches of a street that ARE the course (its straights lie on these
  // lines) are left out: the course's own surface covers them completely,
  // so drawing them underneath was pure overdraw. Measured on the street's
  // centre line against the course's; a corner's arms and the junction box
  // itself are off the course's line and so stay in.
  const openStretches = (s, a0, a1) => {
    const out = [];
    let st = null;
    for (let a = a0; a <= a1 + 20; a += 20) {
      const u = Math.min(a, a1);
      const [x, y] = at(s, 0, u);
      const open = a <= a1 && dist(x, y) > 30;
      if (open && st === null) st = u;
      else if (!open && st !== null) { out.push([st, u]); st = null; }
    }
    return out;
  };
  const across = (2 * 230) / 3 / tw, along = 520 / th;
  for (const s of streets) {
    const lo = Math.max(s.a0 - C, s.v ? by0 : bx0), hi = Math.min(s.a1 + C, s.v ? by1 : bx1);
    for (const [a0, a1] of openStretches(s, lo, hi)) {
      // pavement either side (none under the carriageway: the asphalt
      // would only cover it again)
      for (const sg of [1, -1]) {
        srect(pavement, s, sg * H, sg * C, a0, a1, PAVING);
        let o = H;
        for (const band of [GUTTER, KERB, GRIME]) {
          srect(kerbs, s, sg * o, sg * (o + band.w), a0, a1, band.c);
          o += band.w;
        }
      }
      // asphalt, tiled the way the course's is (3 repeats across 460, one
      // per 520 along), and anchored to the world so crossings line up
      const [x0, y0] = at(s, -H, a0), [x1, y1] = at(s, H, a1);
      asphalt.cells(x0, y0, x1 - x0, y1 - y0, (holder, px, py, pw, ph) => {
        const ts = new TilingSprite({ texture: tile, width: pw, height: ph });
        ts.position.set(px, py);
        ts.tileScale.set(s.v ? across : along, s.v ? along : across);
        ts.tilePosition.set(-px, -py);
        ts.tint = ASPHALT_TINT;
        holder.addChild(ts);
      });
    }
  }

  // --- markings on the side streets ---
  // Where each street is crossed by another (or meets the course), so its
  // lines stop at the junction instead of running through it.
  const crossingsOn = (s) => {
    const out = [];
    for (const o of streets) {
      if (o === s || o.v === s.v) continue;
      if (s.c < o.a0 - H || s.c > o.a1 + H) continue;
      if (o.c < s.a0 - H || o.c > s.a1 + H) continue;
      out.push(o.c);
    }
    return out.sort((a, b) => a - b);
  };
  const nearRoute = (x, y, r) => dist(x, y) < r;
  const zebras = [];
  for (const s of streets) {
    const xs = crossingsOn(s);
    const a0 = Math.max(s.a0, s.v ? by0 : bx0), a1 = Math.min(s.a1, s.v ? by1 : bx1);
    const clearOf = (a) => xs.every((c) => Math.abs(a - c) > C);
    // centre dashes (60 on, 60 off, like the course's) and edge lines
    for (let a = a0; a < a1; a += 120) {
      const m = a + 30;
      const [px, py] = at(s, 0, m);
      if (!clearOf(m) || nearRoute(px, py, roadHalf + pave + 40)) continue;
      srect(marks, s, -5.5, 5.5, a, a + 60, 0xffffff, 0.85);
    }
    for (const sg of [1, -1]) {
      for (let a = a0; a < a1; a += 40) {
        const m = a + 20;
        const [px, py] = at(s, sg * (H - 20), m);
        if (!clearOf(m) || nearRoute(px, py, roadHalf + pave + 40)) continue;
        srect(marks, s, sg * (H - 14), sg * (H - 25), a, a + 40, 0xffffff, 0.8);
      }
    }
    // crossings on every arm of every junction (collected, painted below)
    for (const c of xs) {
      // where the crossing street is the course itself, the mouth pass
      // below paints this arm's crossing
      const [jx, jy] = at(s, 0, c);
      if (nearRoute(jx, jy, roadHalf + pave)) continue;
      for (const dir of [-1, 1]) {
        const mid = c + dir * (C + 20 + 120);
        if (mid < a0 || mid > a1) continue;
        const [px, py] = at(s, 0, mid);
        if (nearRoute(px, py, roadHalf + pave + 60)) continue;
        zebras.push({ s, mid, dir, prio: 1 });
      }
    }
  }
  // street-mouth crossings at the course: found by walking each street and
  // stopping where it reaches the course's pavement
  for (const s of streets) {
    const a0 = Math.max(s.a0, s.v ? by0 : bx0), a1 = Math.min(s.a1, s.v ? by1 : bx1);
    let prevIn = null;
    for (let a = a0; a <= a1; a += 20) {
      const [px, py] = at(s, 0, a);
      const inside = dist(px, py) < roadHalf + pave;
      if (prevIn !== null && inside !== prevIn) {
        // a is where the street crosses the course's pavement edge, heading
        // into the course (inside) or out of it
        const dir = inside ? -1 : 1;      // the direction away from the course
        const mid = a + dir * (20 + 120 + 40);
        const [mx, my] = at(s, 0, mid);
        // no stop line: from the course it is a line beyond the crossing,
        // on a street that is closed anyway
        if (!nearRoute(mx, my, roadHalf + pave + 30)) zebras.push({ s, mid, dir, prio: 0, noStop: true });
      }
      prevIn = inside;
    }
  }
  // Paint them, the course's mouths first, dropping any that would overlap
  // one already down on the same street -- a short block between two
  // junctions has room for one crossing, not two laid over each other.
  // Each gets a stop line on the lane approaching its junction (traffic
  // keeps left), unless another crossing is in the way.
  zebras.sort((p, q) => p.prio - q.prio);
  const laid = new Map();
  for (const z of zebras) {
    const mine = laid.get(z.s) || [];
    if (mine.some((m) => Math.abs(m - z.mid) < 520)) continue;
    mine.push(z.mid);
    laid.set(z.s, mine);
  }
  for (const z of zebras) {
    if (!(laid.get(z.s) || []).includes(z.mid)) continue;
    paintZebra(marks, z.s, z.mid, H - 22, at);
    const stopA = z.mid + z.dir * (120 + 60);
    if (z.noStop || laid.get(z.s).some((m) => m !== z.mid && Math.abs(m - stopA) < 150)) continue;
    // approaching the junction means travelling -dir along the street
    const leftSign = z.s.v ? -z.dir : z.dir;
    srect(marks, z.s, 0, leftSign * (H - 18), stopA - 11, stopA + 11, 0xffffff, 0.9);
  }

  // --- blocks ---
  const vx = [...new Set(streets.filter((s) => s.v).map((s) => s.c))].sort((a, b) => a - b);
  const hy = [...new Set(streets.filter((s) => !s.v).map((s) => s.c))].sort((a, b) => a - b);
  const X = [bx0, ...vx, bx1], Y = [by0, ...hy, by1];
  // is there a street along this cell edge?
  const hasV = (x, ya, yb) => streets.some((s) => s.v && s.c === x && s.a0 <= (ya + yb) / 2 && s.a1 >= (ya + yb) / 2);
  const hasH = (y, xa, xb) => streets.some((s) => !s.v && s.c === y && s.a0 <= (xa + xb) / 2 && s.a1 >= (xa + xb) / 2);
  const builder = {
    rng, dist, clearOfRoute, lots, shadows, roofs, parks, sprites, sheet, shadowTex, tex, cull,
    carW: carWidth * worldScale * 1.2,
  };
  for (let i = 0; i < X.length - 1; i++) {
    for (let j = 0; j < Y.length - 1; j++) {
      const l = hasV(X[i], Y[j], Y[j + 1]), r = hasV(X[i + 1], Y[j], Y[j + 1]);
      const t = hasH(Y[j], X[i], X[i + 1]), b = hasH(Y[j + 1], X[i], X[i + 1]);
      const cell = {
        x0: X[i] + (l ? C + FORECOURT : 0), x1: X[i + 1] - (r ? C + FORECOURT : 0),
        y0: Y[j] + (t ? C + FORECOURT : 0), y1: Y[j + 1] - (b ? C + FORECOURT : 0),
      };
      // forecourt paving between the pavement and the building line
      if (l) rect(pavement, X[i] + C - 2, Y[j], X[i] + C + FORECOURT, Y[j + 1], PAVING);
      if (r) rect(pavement, X[i + 1] - C - FORECOURT, Y[j], X[i + 1] - C + 2, Y[j + 1], PAVING);
      if (t) rect(pavement, X[i], Y[j] + C - 2, X[i + 1], Y[j] + C + FORECOURT, PAVING);
      if (b) rect(pavement, X[i], Y[j + 1] - C - FORECOURT, X[i + 1], Y[j + 1] - C + 2, PAVING);
      fillBlock(builder, cell);
    }
  }

  // --- street trees and parked cars along the side streets ---
  const carNames = ['car_civilian_white', 'car_civilian_silver', 'car_civilian_navy', 'car_civilian_maroon'];
  for (const s of streets) {
    const xs = crossingsOn(s);
    const a0 = Math.max(s.a0, s.v ? by0 : bx0), a1 = Math.min(s.a1, s.v ? by1 : bx1);
    const clearOf = (a, m) => xs.every((c) => Math.abs(a - c) > C + m);
    for (const sg of [1, -1]) {
      // trees in the outer part of the pavement
      for (let a = a0 + rng() * 200; a < a1; a += 330 + rng() * 60) {
        const [px, py] = at(s, sg * (C - 58), a);
        if (!clearOf(a, 200) || dist(px, py) < roadHalf + pave + 190) continue;
        addTree(builder, px, py, 0.42 + rng() * 0.1, rng() < 0.2 ? 'tree_cherry' : 'tree_green');
      }
      // cars parked against the kerb, facing the way their lane runs
      for (let a = a0 + rng() * 300; a < a1; a += 250 + rng() * 420) {
        const [px, py] = at(s, sg * (H - 62), a);
        if (!clearOf(a, 260) || dist(px, py) < roadHalf + pave + 260) continue;
        // keep-left: the +lateral side of a north-south street is the
        // southbound lane, of an east-west one the westbound
        const heading = s.v ? (sg > 0 ? Math.PI / 2 : -Math.PI / 2) : (sg > 0 ? Math.PI : 0);
        addCar(builder, px, py, heading, carNames[(rng() * carNames.length) | 0]);
      }
    }
  }

  return { layer: root, cull };
}

/** Zebra across a street at `mid` along it: stripes run WITH the traffic. */
function paintZebra(g, s, mid, half, at) {
  const depth = 240, stripe = 30, gap = 30;
  const n = Math.floor((2 * half + gap) / (stripe + gap));
  const span = n * stripe + (n - 1) * gap;
  for (let i = 0; i < n; i++) {
    const d0 = -span / 2 + i * (stripe + gap);
    const [x0, y0] = at(s, d0, mid - depth / 2), [x1, y1] = at(s, d0 + stripe, mid + depth / 2);
    g.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)).fill({ color: 0xffffff, alpha: 0.86 });
  }
}

const ROOF = [0x6f7780, 0x878d94, 0xa19b90, 0x7a6e65, 0x5e6771, 0xaeaaa2, 0x8b7d71, 0x67747f, 0x9aa3ab, 0x76706a];

function shade(c, f) {
  const r = Math.max(0, Math.min(255, Math.round(((c >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((c >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

/** Does a rectangle stand clear of the course? Corners, edge midpoints, centre. */
function clear(B, x0, y0, x1, y1) {
  const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1], [xm, y0], [xm, y1], [x0, ym], [x1, ym], [xm, ym]]) {
    if (B.dist(x, y) < B.clearOfRoute) return false;
  }
  return true;
}

/** One block's worth of lots: rows of buildings, the odd car park or park. */
function fillBlock(B, cell) {
  const { rng } = B;
  const W = cell.x1 - cell.x0, Hh = cell.y1 - cell.y0;
  if (W <= 0 || Hh <= 0) return;
  // the yards and service ways between the buildings: concrete -- laid on
  // any sliver of a cell too, or the bare ground shows between two lines
  // that do not both run here (x = 4160 / 4760 on stage 2)
  B.lots.rect(cell.x0, cell.y0, W, Hh).fill({ color: 0x899096 });
  if (W < 160 || Hh < 160) return;
  const horiz = W >= Hh;                   // rows run along the long side
  const long0 = horiz ? cell.x0 : cell.y0, long1 = horiz ? cell.x1 : cell.y1;
  const short0 = horiz ? cell.y0 : cell.x0, short1 = horiz ? cell.y1 : cell.x1;
  const depth = short1 - short0;
  const R = (a0, a1, s0, s1) => (horiz ? [a0, s0, a1, s1] : [s0, a0, s1, a1]);

  // the rows across the block: one building deep, two back to back, or
  // two with a courtyard between them
  const rows = [];
  if (depth <= 900) rows.push([short0, short1]);
  else if (depth <= 1500) {
    const m = short0 + depth * (0.42 + rng() * 0.16);
    rows.push([short0, m - 10], [m + 10, short1]);
  } else {
    const d = 420 + rng() * 200;
    rows.push([short0, short0 + d], [short1 - d, short1]);
    // courtyard: a park or a car park
    const [x0, y0, x1, y1] = R(long0 + 60, long1 - 60, short0 + d + 60, short1 - d - 60);
    if (x1 - x0 > 200 && y1 - y0 > 200 && clear(B, x0, y0, x1, y1)) {
      if (rng() < 0.55) park(B, x0, y0, x1, y1); else carPark(B, x0, y0, x1, y1);
    }
  }
  for (const [s0, s1] of rows) {
    let a = long0;
    while (a < long1 - 120) {
      let w = 360 + rng() * 560;
      if (long1 - (a + w) < 260) w = long1 - a;   // no sliver left at the end
      const [x0, y0, x1, y1] = R(a, a + w, s0, s1);
      const roll = rng();
      if (clear(B, x0, y0, x1, y1)) {
        if (roll < 0.1 && w > 300) carPark(B, x0 + 10, y0 + 10, x1 - 10, y1 - 10);
        else if (roll < 0.16 && w > 300) park(B, x0 + 10, y0 + 10, x1 - 10, y1 - 10);
        else {
          // set back a little from the lot line at random, never at the front
          const g = 6 + rng() * 22;
          building(B, x0 + g, y0 + g, x1 - g, y1 - g);
        }
      } else {
        // near the course (the inside of a corner): try the half of the lot
        // further from it before giving the lot up
        const h = (s1 - s0) / 2;
        for (const [p0, p1] of [[s0, s0 + h], [s0 + h, s1]]) {
          const [qx0, qy0, qx1, qy1] = R(a, a + w, p0, p1);
          if (p1 - p0 > 160 && clear(B, qx0, qy0, qx1, qy1)) building(B, qx0 + 12, qy0 + 12, qx1 - 12, qy1 - 12);
        }
      }
      a += w;
    }
  }
}

/** A flat-roofed building from directly above, with its cast shadow. */
function building(B, x0, y0, x1, y1) {
  const { rng, shadows: S, roofs: G } = B;
  const w = x1 - x0, h = y1 - y0;
  if (w < 80 || h < 80) return;
  const height = 60 + rng() * 170 + Math.min(w, h) * 0.12;
  // sun from the north-west: the shadow falls south-east
  const dx = height * 0.42, dy = height * 0.6;
  S.poly([x0, y0, x1, y0, x1 + dx, y0 + dy, x1 + dx, y1 + dy, x0 + dx, y1 + dy, x0, y1]).fill({ color: 0x06090c });

  const base = ROOF[(rng() * ROOF.length) | 0];
  const c = shade(base, 0.92 + rng() * 0.16);
  // parapet: the roof's edge wall, catching the light on its sunny sides
  G.rect(x0, y0, w, h).fill({ color: shade(c, 1.18) });
  G.rect(x0 + 10, y0 + 10, w - 10, h - 10).fill({ color: shade(c, 0.78) });
  G.rect(x0 + 12, y0 + 12, w - 24, h - 24).fill({ color: c });

  const ix0 = x0 + 30, iy0 = y0 + 30, ix1 = x1 - 30, iy1 = y1 - 30;
  const iw = ix1 - ix0, ih = iy1 - iy0;
  if (iw < 40 || ih < 40) return;
  const kind = rng();
  if (kind < 0.12 && iw > 140 && ih > 100) {
    // solar array
    const pw = 46, ph = 30;
    for (let y = iy0 + 6; y + ph < iy1 - 6; y += ph + 8) {
      for (let x = ix0 + 6; x + pw < ix1 - 6; x += pw + 6) {
        G.rect(x, y, pw, ph).fill({ color: 0x2c3e5c });
        G.rect(x, y, pw, 3).fill({ color: 0x6f86a8 });
      }
    }
    return;
  }
  if (kind < 0.2 && iw > 120 && ih > 120) {
    // roof garden
    G.rect(ix0, iy0, iw, ih).fill({ color: 0x5f7f4a });
    for (let k = 0; k < 5; k++) {
      G.circle(ix0 + rng() * iw, iy0 + rng() * ih, 14 + rng() * 18).fill({ color: 0x486b37 });
    }
    return;
  }
  // stair / lift housing, with its own short shadow
  if (iw > 110 && ih > 110) {
    const sw = 60 + rng() * 50, sh = 60 + rng() * 50;
    const sx = ix0 + rng() * (iw - sw), sy = iy0 + rng() * (ih - sh);
    G.rect(sx + 14, sy + 20, sw, sh).fill({ color: 0x06090c, alpha: 0.25 });
    G.rect(sx, sy, sw, sh).fill({ color: shade(c, 1.1) });
    G.rect(sx + 5, sy + 5, sw - 10, sh - 10).fill({ color: shade(c, 0.95) });
  }
  // air-conditioning units and a water tank
  const units = 1 + ((rng() * 5) | 0);
  for (let k = 0; k < units; k++) {
    const uw = 26 + rng() * 22, uh = 20 + rng() * 14;
    if (iw < uw + 4 || ih < uh + 4) break;
    const ux = ix0 + rng() * (iw - uw), uy = iy0 + rng() * (ih - uh);
    G.rect(ux + 4, uy + 6, uw, uh).fill({ color: 0x06090c, alpha: 0.22 });
    G.rect(ux, uy, uw, uh).fill({ color: 0xc9ccce });
    G.circle(ux + uw / 2, uy + uh / 2, Math.min(uw, uh) * 0.32).fill({ color: 0x8e9396 });
  }
  if (rng() < 0.35 && iw > 70 && ih > 70) {
    const r = 18 + rng() * 10;
    const tx = ix0 + r + rng() * (iw - 2 * r), ty = iy0 + r + rng() * (ih - 2 * r);
    G.circle(tx + 6, ty + 9, r).fill({ color: 0x06090c, alpha: 0.25 });
    G.circle(tx, ty, r).fill({ color: 0xd9dbd6 });
    G.circle(tx, ty, r * 0.6).fill({ color: 0xbfc2bd });
  }
}

/** A pocket park: lawn, a path across it, trees. */
function park(B, x0, y0, x1, y1) {
  const { rng, lots } = B;
  const w = x1 - x0, h = y1 - y0;
  lots.rect(x0 - 6, y0 - 6, w + 12, h + 12).fill({ color: 0x9aa09a });   // kerbed edge
  const grass = new TilingSprite({ texture: B.tex.grass, width: w, height: h });
  grass.position.set(x0, y0);
  grass.tileScale.set(1.2);
  grass.tilePosition.set(-x0, -y0);
  grass.tint = 0xb7c2a4;
  B.parks.get(x0 + w / 2, y0 + h / 2).addChild(grass);
  // a path on the diagonal-free grid, the way a city park is laid out
  const pw = 34;
  if (w > h) lots.rect(x0, y0 + h / 2 - pw / 2, w, pw).fill({ color: 0xc2b9a6 });
  else lots.rect(x0 + w / 2 - pw / 2, y0, pw, h).fill({ color: 0xc2b9a6 });
  // (the path is drawn under the lawn's layer; redraw it on top)
  const path = new Graphics();
  if (w > h) path.rect(x0, y0 + h / 2 - pw / 2, w, pw).fill({ color: 0xc9c0ad });
  else path.rect(x0 + w / 2 - pw / 2, y0, pw, h).fill({ color: 0xc9c0ad });
  B.parks.get(x0 + w / 2, y0 + h / 2).addChild(path);
  const n = Math.max(1, Math.round((w * h) / 90000));
  for (let k = 0; k < n; k++) {
    const x = x0 + 60 + rng() * Math.max(1, w - 120), y = y0 + 60 + rng() * Math.max(1, h - 120);
    if (Math.abs((w > h ? y - (y0 + h / 2) : x - (x0 + w / 2))) < 70) continue;
    addTree(B, x, y, 0.5 + rng() * 0.3, rng() < 0.25 ? 'tree_cherry' : 'tree_green');
  }
}

/** A surface car park: marked bays, some of them taken. */
function carPark(B, x0, y0, x1, y1) {
  const { rng, lots } = B;
  const w = x1 - x0, h = y1 - y0;
  lots.rect(x0, y0, w, h).fill({ color: 0x5d6268 });
  const bay = 130, len = 250;
  const horiz = w >= h;   // bays side by side along the long side
  const along0 = horiz ? x0 : y0, along1 = horiz ? x1 : y1;
  const across0 = horiz ? y0 : x0, across1 = horiz ? y1 : x1;
  const names = ['car_civilian_white', 'car_civilian_silver', 'car_civilian_navy', 'car_civilian_maroon'];
  for (const [r0, facing] of [[across0 + 10, 1], [across1 - 10 - len, -1]]) {
    if (r0 < across0 || r0 + len > across1) continue;
    if (facing < 0 && r0 < across0 + len + 120) continue;   // no room for a second row
    for (let a = along0 + 20; a + bay <= along1 - 20; a += bay) {
      // bay lines
      const line = (p) => (horiz
        ? lots.rect(p, r0, 6, len).fill({ color: 0xe8e8e2, alpha: 0.8 })
        : lots.rect(r0, p, len, 6).fill({ color: 0xe8e8e2, alpha: 0.8 }));
      line(a);
      if (a + 2 * bay > along1 - 20) line(a + bay);
      if (rng() < 0.55) {
        const cx = horiz ? a + bay / 2 : r0 + len / 2, cy = horiz ? r0 + len / 2 : a + bay / 2;
        const heading = horiz ? (facing > 0 ? -Math.PI / 2 : Math.PI / 2) : (facing > 0 ? Math.PI : 0);
        addCar(B, cx, cy, heading, names[(rng() * names.length) | 0], 0.92);
      }
    }
  }
}

function addTree(B, x, y, scale, name) {
  const t = B.sheet?.textures?.[name];
  if (!t) return;
  const w = 400 * scale, h = w * (t.height / t.width);
  const holder = new Container();
  holder.position.set(x, y);
  const sh = new Sprite(B.shadowTex);
  sh.anchor.set(0.5);
  sh.width = w * 0.95; sh.height = h * 0.6;
  sh.position.set(w * 0.12, h * 0.16);
  sh.alpha = 0.45;
  const sp = new Sprite(t);
  sp.anchor.set(0.5);
  sp.width = w; sp.height = h;
  sp.rotation = B.rng() * Math.PI * 2;
  holder.addChild(sh, sp);
  B.sprites.addChild(holder);
  B.cull.push({ node: holder, x, y, r: w });
}

function addCar(B, x, y, heading, name, scale = 1) {
  const t = B.sheet?.textures?.[name];
  if (!t) return;
  const w = B.carW * scale, h = w * (t.height / t.width);
  const holder = new Container();
  holder.position.set(x, y);
  holder.rotation = heading + Math.PI / 2;
  const sh = new Sprite(B.shadowTex);
  sh.anchor.set(0.5);
  sh.width = w * 1.1; sh.height = h * 0.95;
  sh.position.set(8, 10);
  sh.alpha = 0.4;
  const sp = new Sprite(t);
  sp.anchor.set(0.5);
  sp.width = w; sp.height = h;
  holder.addChild(sh, sp);
  B.sprites.addChild(holder);
  B.cull.push({ node: holder, x, y, r: h });
}
