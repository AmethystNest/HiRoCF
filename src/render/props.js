/**
 * Trackside decoration.
 *
 * Three things the previous build got wrong are handled structurally here:
 *
 *  - Nothing floats: every prop gets a soft contact shadow, and props are
 *    anchored at their base rather than their centre.
 *  - Nothing repeats monotonously: the lap is split into themed sections, and
 *    each theme draws from its own weighted prop table.
 *  - Nothing overlaps: placement runs a radius check against everything placed
 *    so far and skips conflicts, instead of relying on hand-tuned indices.
 *
 * Every prop rotates fixed-with-the-world (never billboarded to counter the
 * camera): the camera itself rotates with the player, so any prop that
 * "counter-rotated to stay upright on screen" would visibly spin in place on
 * every turn. Only each prop's fixed local angle differs by kind -- the
 * local track tangent for symmetric scatter (trees, rocks, barrels, cones,
 * still called `kind: 'billboard'` for historical naming only), the travel
 * direction for elongated along-track props (parked vehicles, gantries), and
 * "face the centreline" for structures that read as looking at the track
 * (grandstands, tents, barriers).
 */
import { Container, Graphics, Sprite } from '../pixi.js';
import { CAR_SIZE } from '../config.js';

/** Decorative parked vehicles should read as the same size as the actual cars. */
const VEHICLE_PROPS = new Set([
  'ambulance', 'tow_vehicle',
  'car_civilian_white', 'car_civilian_silver', 'car_civilian_navy', 'car_civilian_maroon',
]);

/** Deterministic RNG so a stage looks identical every load. */
function mulberry32(seed) {
  return function rng() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Prop catalogue. `w` is the drawn width in world units; height follows the
 * source aspect. `kind` decides billboarding, `pad` the placement radius.
 */
const CATALOG = {
  cone: { w: 64, kind: 'billboard', pad: 27 },
  cone_fallen: { w: 72, kind: 'billboard', pad: 30 },
  barrel_redwhite: { w: 86, kind: 'billboard', pad: 36 },
  barrel_blackyellow: { w: 86, kind: 'billboard', pad: 36 },
  barrel_chevron: { w: 86, kind: 'billboard', pad: 36 },
  barrel_blue_set: { w: 168, kind: 'billboard', pad: 71 },
  barrel_green_set: { w: 168, kind: 'billboard', pad: 71 },
  barrel_red_set: { w: 168, kind: 'billboard', pad: 71 },
  barrel_white_red: { w: 86, kind: 'billboard', pad: 36 },

  bush_green: { w: 180, kind: 'billboard', pad: 76 },
  bush_pinkflowers: { w: 180, kind: 'billboard', pad: 76 },
  bush_whiteflowers: { w: 180, kind: 'billboard', pad: 76 },

  tree_green: { w: 400, kind: 'billboard', pad: 168 },
  tree_cherry: { w: 400, kind: 'billboard', pad: 168 },
  tree_autumn: { w: 400, kind: 'billboard', pad: 168 },
  tree_pine: { w: 340, kind: 'billboard', pad: 143 },
  tree_palm: { w: 350, kind: 'billboard', pad: 147 },

  rock_cluster_large: { w: 250, kind: 'billboard', pad: 105 },
  rock_cluster_small: { w: 175, kind: 'billboard', pad: 74 },

  tire_stack_black: { w: 190, kind: 'billboard', pad: 80 },
  tire_stack_redwhite: { w: 190, kind: 'billboard', pad: 80 },

  street_light: { w: 165, kind: 'billboard', pad: 69 },
  floodlight: { w: 225, kind: 'billboard', pad: 94 },
  marshal_tower: { w: 225, kind: 'billboard', pad: 94 },
  broadcast_camera_tower: { w: 225, kind: 'billboard', pad: 94 },

  chevron_redwhite: { w: 175, kind: 'face', pad: 74 },
  chevron_blackyellow: { w: 175, kind: 'face', pad: 74 },
  arrow_sign_right: { w: 175, kind: 'face', pad: 74 },

  concrete_barrier: { w: 250, kind: 'face', pad: 105 },
  fence_panel: { w: 250, kind: 'face', pad: 105 },
  guardrail_straight: { w: 250, kind: 'face', pad: 105 },
  crowd_fence: { w: 520, kind: 'face', pad: 218 },
  pitwall_barrier: { w: 520, kind: 'face', pad: 218 },

  racing_billboard: { w: 470, kind: 'face', pad: 197 },
  grandstand: { w: 880, kind: 'face', pad: 370 },
  podium_stage: { w: 460, kind: 'face', pad: 193 },
  marshal_hut: { w: 260, kind: 'face', pad: 109 },
  pit_tent_blue: { w: 290, kind: 'face', pad: 122 },
  pit_tent_red: { w: 290, kind: 'face', pad: 122 },

  ambulance: { w: 200, kind: 'along', pad: 84 },
  tow_vehicle: { w: 200, kind: 'along', pad: 84 },

  // plain generic parked traffic -- deliberately not the rival roster, so a
  // street stage doesn't look like it's full of parked race cars
  car_civilian_white: { w: 200, kind: 'along', pad: 84 },
  car_civilian_silver: { w: 200, kind: 'along', pad: 84 },
  car_civilian_navy: { w: 200, kind: 'along', pad: 84 },
  car_civilian_maroon: { w: 200, kind: 'along', pad: 84 },

  // city backdrop, set back beyond the kerb-side furniture -- look at the
  // road like every other structure (grandstands, tents)
  building_office: { w: 340, kind: 'face', pad: 160 },
  building_apartment: { w: 300, kind: 'face', pad: 145 },
  building_shop: { w: 380, kind: 'face', pad: 175 },

  start_gantry: { w: 1100, kind: 'along', pad: 462 },
  finish_gantry: { w: 1100, kind: 'along', pad: 462 },
  plain_gantry: { w: 1100, kind: 'along', pad: 462 },
};

/**
 * Section themes: what appears, how densely, and how far out.
 * `near`/`far` are measured from the outer edge of the built surface
 * (already ~650 units from the centreline once kerb/apron/gravel are
 * stacked), so these stay small -- most decoration should hug that edge,
 * with only occasional pieces set back as a backdrop.
 */
const THEMES = {
  grandstand: {
    step: 340,
    entries: [
      { name: 'grandstand', weight: 3, near: -246, far: -206 },
      { name: 'crowd_fence', weight: 3, near: 5, far: 25 },
      { name: 'racing_billboard', weight: 2, near: 10, far: 50 },
      { name: 'marshal_hut', weight: 1, near: 15, far: 55 },
      { name: 'broadcast_camera_tower', weight: 1, near: 20, far: 70 },
      { name: 'pitwall_barrier', weight: 2, near: 3, far: 18 },
    ],
  },
  forest: {
    step: 170,
    entries: [
      { name: 'tree_green', weight: 4, near: 10, far: 260 },
      { name: 'tree_cherry', weight: 2, near: 10, far: 260 },
      { name: 'tree_autumn', weight: 2, near: 10, far: 260 },
      { name: 'tree_pine', weight: 3, near: 20, far: 290 },
      { name: 'bush_green', weight: 3, near: 5, far: 90 },
      { name: 'bush_pinkflowers', weight: 1, near: 5, far: 90 },
      { name: 'bush_whiteflowers', weight: 1, near: 5, far: 90 },
    ],
  },
  runoff: {
    step: 150,
    entries: [
      { name: 'tire_stack_black', weight: 3, near: 5, far: 40 },
      { name: 'tire_stack_redwhite', weight: 3, near: 5, far: 40 },
      { name: 'barrel_red_set', weight: 2, near: 10, far: 60 },
      { name: 'barrel_blue_set', weight: 1, near: 10, far: 60 },
      { name: 'barrel_green_set', weight: 1, near: 10, far: 60 },
      { name: 'concrete_barrier', weight: 3, near: 5, far: 25 },
      { name: 'rock_cluster_small', weight: 1, near: 70, far: 180 },
    ],
  },
  paddock: {
    step: 200,
    entries: [
      { name: 'pit_tent_blue', weight: 2, near: 20, far: 65 },
      { name: 'pit_tent_red', weight: 2, near: 20, far: 65 },
      { name: 'ambulance', weight: 1, near: 15, far: 55 },
      { name: 'tow_vehicle', weight: 1, near: 15, far: 55 },
      { name: 'fence_panel', weight: 3, near: 3, far: 18 },
      { name: 'marshal_tower', weight: 1, near: 30, far: 85 },
      { name: 'floodlight', weight: 1, near: 25, far: 75 },
    ],
  },
  open: {
    step: 150,
    entries: [
      { name: 'rock_cluster_large', weight: 2, near: 40, far: 260 },
      { name: 'rock_cluster_small', weight: 2, near: 20, far: 220 },
      { name: 'bush_green', weight: 3, near: 5, far: 110 },
      { name: 'tree_pine', weight: 2, near: 60, far: 290 },
      { name: 'floodlight', weight: 1, near: 30, far: 90 },
      { name: 'street_light', weight: 2, near: 5, far: 35 },
    ],
  },
  // Touge pass: guardrail and the rock wall behind it are placed by their
  // own guaranteed-density passes below (buildProps' "mountain preset"
  // block), not through this weighted scatter -- a safety rail with gaps
  // in it, or a rock face that's really just occasional boulders, doesn't
  // read as either. This theme only covers what's naturally sparse: forest
  // further back. `farInfield` (used only on the infield/-1 side) lets
  // these reach much deeper than `far` does on the outside, since the
  // infield of a big loop like this course is mostly open interior that
  // reads as empty unless something actually fills it.
  // step 90 (was 160) and every far pushed out a bit further -- a real
  // mountainside forest is dense and layered, not a thin single-file line
  // of trees; more attempts per lap plus more depth for them to land in
  // both read as "natural" rather than "decorated".
  touge: {
    step: 78,
    entries: [
      // Pine is still the backbone of the hillside, but a pass like this one
      // is an autumn-colour road first and foremost -- a stand of nothing but
      // dark conifer reads as generic forest, and the mix is what makes it
      // read as a mountain in October rather than a tree-lined circuit.
      { name: 'tree_pine', weight: 5, near: 250, far: 560, farInfield: 1700 },
      { name: 'tree_autumn', weight: 4, near: 250, far: 540, farInfield: 1600 },
      { name: 'tree_green', weight: 2, near: 255, far: 500, farInfield: 1600 },
      { name: 'tree_cherry', weight: 1, near: 260, far: 520, farInfield: 1400 },
      { name: 'rock_cluster_large', weight: 2, near: 245, far: 420, farInfield: 950 },
      { name: 'rock_cluster_small', weight: 3, near: 240, far: 400, farInfield: 750 },
      { name: 'bush_green', weight: 2, near: 240, far: 340, farInfield: 550 },
    ],
  },
  // Ordinary city street: pavement furniture close to the kerb (street
  // lights, low fencing, planters), plus city-block buildings set well back
  // as a backdrop -- one theme, since near/far already keeps the two groups
  // physically apart (curb-side vs. set-back), so they never compete for
  // the same spot.
  //
  // near/far were originally authored close to the paved edge (as little
  // as +3), which was fine against the old, narrower pavement band -- once
  // that band widened and the actual wall/player footprint got measured
  // (see layouts.js stage 2), that put a wall-hugging car's own edge only
  // a handful of world units from these, reading as driving straight
  // through them. Every curbside entry now starts comfortably past that
  // measured reach (wallHalf 320 + player half-width ~88 + this prop's own
  // half-width + margin); only the backdrop buildings, already well clear,
  // are unchanged.
  street: {
    step: 150,
    entries: [
      { name: 'street_light', weight: 3, near: 80, far: 110 },
      { name: 'fence_panel', weight: 3, near: 90, far: 120 },
      { name: 'concrete_barrier', weight: 2, near: 90, far: 115 },
      { name: 'bush_green', weight: 2, near: 85, far: 140 },
      { name: 'bush_pinkflowers', weight: 1, near: 85, far: 140 },
      { name: 'bush_whiteflowers', weight: 1, near: 85, far: 140 },
      { name: 'building_office', weight: 2, near: 160, far: 420 },
      { name: 'building_apartment', weight: 2, near: 160, far: 420 },
      { name: 'building_shop', weight: 1, near: 160, far: 420 },
    ],
  },

  highway: {
    step: 125,
    entries: [
      { name: 'street_light', weight: 5, near: 70, far: 105 },
      { name: 'concrete_barrier', weight: 3, near: 62, far: 82 },
      { name: 'fence_panel', weight: 2, near: 75, far: 100 },
      { name: 'building_office', weight: 4, near: 360, far: 760 },
      { name: 'building_apartment', weight: 3, near: 380, far: 820 },
      { name: 'building_shop', weight: 1, near: 350, far: 650 },
    ],
  },

};

const SECTION_PLANS = {
  circuit: ['grandstand', 'forest', 'runoff', 'open', 'paddock', 'forest', 'runoff', 'open'],
  city: ['paddock', 'open', 'runoff', 'open', 'paddock', 'open', 'runoff', 'open'],
  mountain: ['forest', 'open', 'forest', 'runoff', 'forest', 'open', 'forest', 'open'],
  highway: ['highway'],
};

function pick(rng, entries) {
  const total = entries.reduce((a, e) => a + e.weight, 0);
  let r = rng() * total;
  for (const e of entries) { r -= e.weight; if (r <= 0) return e; }
  return entries[entries.length - 1];
}

/**
 * @param {TrackPath} path
 * @param {object} sheet  loaded prop spritesheet (sheet.textures keyed by name)
 * @param {Texture} shadowTex
 * @param {object} opts { edge, preset, seed, worldScale, wallHalf }
 * @returns {{ layer: Container }}
 */
export function buildProps(path, sheet, shadowTex, {
  edge, preset = 'circuit', seed = 1, layout = null, worldScale = 1, wallHalf = null,
}) {
  const rng = mulberry32(seed * 7919 + 13);
  const layer = new Container();
  layer.label = 'props';
  const placed = [];
  // How far a car can actually reach from ANY point on the centreline --
  // used below to reject a placement that's clear of its own section's
  // road but happens to land inside a *different*, nearby part of the
  // course instead. `near`/`far` are all authored against one lane in
  // isolation, but a winding course can fold back close to itself (a
  // switchback's two parallel lanes, for instance): a prop can be a
  // perfectly safe distance from the lane it was placed relative to and
  // still end up sitting in the reach of the parallel lane right next to
  // it. path.nearest() doesn't care which lane it belongs to, so it's the
  // only way to actually catch that.
  const playerReach = wallHalf != null ? wallHalf + (CAR_SIZE.player.w * worldScale) / 2 : null;

  // A stage may describe its own sections (tied to real track features);
  // otherwise fall back to equal slices of the generic plan for the preset.
  const sections = layout?.sections?.length
    ? layout.sections.map((s) => ({
        theme: s.theme, start: s.from * path.length, end: s.to * path.length,
      }))
    : (SECTION_PLANS[preset] || SECTION_PLANS.circuit).map((theme, i, arr) => ({
        theme,
        start: (i / arr.length) * path.length,
        end: ((i + 1) / arr.length) * path.length,
      }));

  const fits = (x, y, pad) => {
    for (const p of placed) {
      const dx = p.x - x, dy = p.y - y;
      if (dx * dx + dy * dy < (p.pad + pad) ** 2) return false;
    }
    return true;
  };

  const add = (name, dist, side, lateral, opts = {}) => {
    const info = CATALOG[name];
    const tx = sheet.textures[name];
    if (!info || !tx) return false;

    const idx = path.indexAtDistance(dist);
    const p = path.offsetPoint(idx, side * lateral);

    const scale = opts.scale ?? 1;
    // Parked ambulance/tow-truck decorations should read as the same size
    // as the actual player/rival cars, not the catalogue's own art-scale
    // width -- same screen-px * worldScale conversion main.js uses for cars.
    // These vehicles are drawn taller/narrower than the player car's own
    // sprite, so matching width 1:1 still read as smaller; the multiplier
    // brings their overall footprint up to match instead of just one edge.
    const baseW = VEHICLE_PROPS.has(name) ? CAR_SIZE.player.w * worldScale * 1.2 : info.w;
    const w = baseW * scale;
    const h = w * (tx.height / tx.width);
    // Collision-avoidance radius is derived from the prop's ACTUAL rendered
    // footprint, not the catalogue's static `pad` -- that value was
    // authored against the catalogue's own base width and silently went
    // stale for anything resized at placement time (VEHICLE_PROPS' worldScale
    // multiplier, or a per-call `scale`), which is exactly what let parked
    // cars and buildings visually overlap even though fits() reported no
    // conflict.
    const pad = opts.pad ?? Math.max(w, h) / 2;
    if (!opts.force) {
      if (!fits(p.x, p.y, pad)) return false;
      // Guard against the prop landing inside a *different* part of the
      // course's reach than the one it was placed relative to -- see the
      // playerReach comment above. Defaults to the same conservative
      // max(w,h)/2 as `pad`, but callers that know their prop's actual
      // depth toward the road (a 'face' prop's width runs ALONG the road
      // once rotated, so its own half-width overstates how far it reaches
      // toward traffic) can pass a tighter `reachPad` -- guardrail relies
      // on this, since max(w,h)/2 was rejecting most placements near every
      // hairpin and leaving the rail full of gaps for no visual reason.
      if (playerReach != null) {
        const nearestLane = path.nearest(p.x, p.y);
        const reachPad = opts.reachPad ?? Math.max(w, h) / 2;
        if (nearestLane.dist < playerReach + reachPad) return false;
      }
    }

    const holder = new Container();
    holder.position.set(p.x, p.y);

    // contact shadow, slightly offset and squashed so it reads as ground contact
    const sh = new Sprite(shadowTex);
    sh.anchor.set(0.5, 0.5);
    sh.width = w * 1.05;
    sh.height = Math.max(24, h * 0.34);
    sh.position.set(w * 0.06, 0);
    sh.alpha = opts.shadowAlpha ?? 0.5;
    holder.addChild(sh);

    const sp = new Sprite(tx);
    // stand the prop on its base rather than centring it
    sp.anchor.set(0.5, info.kind === 'along' ? 0.5 : 0.88);
    sp.width = w;
    sp.height = h;
    holder.addChild(sp);

    // Soft glow under the light fixtures only (street_light/floodlight) --
    // reads as an actual light source at night rather than a dark pole
    // silhouette, without touching the sprite art itself. Positioned near
    // the sprite's top (fixture head), not its base, using the same anchor
    // convention as the sprite above.
    if (name === 'street_light' || name === 'floodlight') {
      const glow = new Graphics();
      const gy = -h * 0.72;
      glow.circle(0, gy, w * 0.95).fill({ color: 0xfff0b8, alpha: 0.10 });
      glow.circle(0, gy, w * 0.42).fill({ color: 0xfff0b8, alpha: 0.28 });
      holder.addChild(glow);
    }

    if (info.kind === 'billboard') {
      // Fixed in world space, same as every other layer (asphalt, kerb,
      // buildings) -- aligned to the local track direction, matching the
      // reference Canvas build's convention for symmetric props (trees,
      // rocks, barrels, cones). A per-frame counter-rotation to keep it
      // screen-upright was tried and reverted: since the camera rotates
      // with the player, that made every tree/rock visibly spin in place
      // on every turn, which read as broken, not stylised.
      holder.rotation = p.angle;
    } else if (info.kind === 'along') {
      // long axis follows the direction of travel (parked cars, gantries)
      holder.rotation = p.angle + Math.PI / 2;
    } else {
      // structures look AT the track: turn the sprite's front (its lower
      // edge) toward the centreline.
      const k = path.wrap(idx);
      const dx = -path.normals[k * 2] * side;
      const dy = -path.normals[k * 2 + 1] * side;
      holder.rotation = Math.atan2(-dx, dy);
      holder.zIndex = 1;
    }

    // Radius used by the per-frame off-screen cull in main.js. Generous on
    // purpose (the glow circle reaches ~0.95*w past the sprite, and a
    // rotated prop's corner reaches further than either half-extent), so a
    // prop pops in well before its edge could enter the view.
    holder.cullRadius = Math.max(w, h) * 1.2;
    layer.addChild(holder);
    placed.push({ x: p.x, y: p.y, pad });
    return true;
  };

  // --- landmarks first: they are hand-placed and must win any conflict ---
  for (const lm of layout?.landmarks || []) {
    // `lateral` is normally measured out from the built surface edge; things
    // that span the road (gantries) need it measured from the centreline.
    const lateral = lm.fromCentre ? (lm.lateral ?? 0) : edge + (lm.lateral ?? 0);
    add(lm.name, lm.at * path.length, lm.side, lateral, {
      scale: lm.scale, shadowAlpha: lm.shadowAlpha, pad: lm.pad, force: lm.force,
    });
  }

  // --- warning chevrons on the outside of the tightest corners ---
  //
  // Placed BEFORE the scenery passes, not after: these are signage on a
  // specific corner, so they have to win the spot, and the mountain rock
  // scatter below blankets exactly the same shoulder.
  //
  // On a mountain pass they go up far earlier than a 0.55 curvature (a
  // ~340-radius corner) and run in a close row right around the bend --
  // that row of boards facing you across the outside of a hairpin is the
  // single most recognisable thing about a Japanese switchback. Every other
  // preset keeps the sparse, tightest-corners-only placement.
  //
  // The lateral offset is derived from playerReach rather than written as a
  // number. A first pass put the boards at wallHalf + 136 = 396, which is
  // one single unit inside the reach guard (357 + a 40 reachPad = 397), so
  // every last one of them was silently rejected and the corner signage
  // simply did not exist.
  const mountain = preset === 'mountain';
  const chevronName = mountain ? 'chevron_blackyellow' : 'chevron_redwhite';
  const chevronMinCurve = mountain ? 0.34 : 0.55;     // 0.34 ~= 555 radius
  const chevronEvery = mountain ? 115 : 190;
  const chevronLateral = mountain && playerReach != null
    ? playerReach + 58
    : edge + 70;
  for (let i = 0; i < path.count; i++) {
    if (path.curvature[i] < chevronMinCurve) continue;
    const d = i * path.spacing;
    if (d % chevronEvery > path.spacing) continue;    // thin them out along the corner
    // outside of the bend = opposite the turn direction
    let turn = path.tangents[path.wrap(i + 3)] - path.tangents[path.wrap(i - 3)];
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    const side = turn > 0 ? -1 : 1;
    add(chevronName, d, side, chevronLateral, { pad: mountain ? 55 : 90, reachPad: 38 });
  }

  // --- reserve side-street corridors so scatter props (buildings, bushes,
  // street furniture) never spawn on top of one -- buildSideStreets() draws
  // them in a completely separate pass with no idea what buildProps() is
  // doing, so without this a building or bush can and does land right on
  // the stub's pavement. Sampling a handful of fake "placed" points down
  // the corridor is enough for the existing fits() check to keep the whole
  // lap clear of it, same as any other prop. Width/length defaults must
  // match buildSideStreets()'s own defaults.
  for (const s of layout?.sideStreets || []) {
    const k = path.wrap(path.indexAtDistance(s.at * path.length));
    const cx = path.points[k][0], cy = path.points[k][1];
    const nx = path.normals[k * 2], ny = path.normals[k * 2 + 1];
    const ux = nx * s.side, uy = ny * s.side;
    const length = s.length ?? 900;
    const corridorPad = (s.width ?? 220) / 2 + 90;
    const startDist = edge - 20;
    const samples = 6;
    for (let i = 0; i <= samples; i++) {
      const d = startDist + (length * i) / samples;
      placed.push({ x: cx + ux * d, y: cy + uy * d, pad: corridorPad });
    }
  }

  // --- mountain preset: rock scatter along the cut slope behind the rail.
  // The guardrail itself is a continuous painted ribbon (see buildSurface
  // in surfaces.js), not individually placed sprites -- discrete rail
  // segments left gaps wherever a curve made two neighbours' own collision
  // checks conflict, which was exactly at the hairpins a real rail is most
  // needed. This pass puts rock just past that ribbon on both sides, since
  // which side is the cut-into-the-mountain face flips with every direction
  // the road turns, so putting it on both is the only thing always right.
  //
  // How far out it can sit is NOT a free choice: a prop inside
  // playerReach + its own reach toward the road looks like something the
  // car drives through, and the guard in add() rejects it. The previous
  // constant here (wallHalf + 120) sat well inside that, so this entire
  // pass had been placing nothing at all -- the "rock wall behind the
  // guardrail" it describes was not on screen. Derived from playerReach
  // now, with smaller rocks so the band it needs is narrower.
  if (preset === 'mountain') {
    const rockBase = playerReach != null
      ? playerReach + 130
      : (wallHalf != null ? wallHalf + 230 : edge + 150);
    const rockStep = 170; // denser than a first pass (230) -- for "natural" density
    for (let d = 0; d < path.length; d += rockStep) {
      for (const side of [1, -1]) {
        if (rng() < 0.12) continue; // an unbroken wall still has the odd gap
        const name = rng() < 0.45 ? 'rock_cluster_large' : 'rock_cluster_small';
        add(name, d + (rng() - 0.5) * rockStep * 0.4, side, rockBase + rng() * 110,
          { scale: 0.62 + rng() * 0.3 });
      }
    }

    // --- fill the loop's open interior, not just its verges ---
    // `farInfield` above assumes the -1 side's local normal points toward
    // the loop's interior, which only holds for a simple convex loop --
    // this course's S-curves and hairpins make "inside" flip locally back
    // and forth relative to the loop's actual middle, so that reach barely
    // landed anything there in practice. Random points across the whole
    // course bounding box, kept only where they land genuinely clear of
    // EVERY stretch of road (near.dist, a global check, not a local
    // one-sided guess), fill whatever open interior actually exists
    // regardless of the path's shape.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of path.points) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    const fillNames = ['tree_pine', 'tree_pine', 'tree_green', 'rock_cluster_large', 'rock_cluster_small', 'bush_green'];
    const fillClear = edge + 260; // must sit clear of every stretch of road by this much
    for (let i = 0; i < 480; i++) {
      const px = minX + rng() * (maxX - minX);
      const py = minY + rng() * (maxY - minY);
      const n = path.nearest(px, py);
      if (n.dist < fillClear) continue;
      const lat = path.lateralOf(px, py, n);
      const side = lat >= 0 ? 1 : -1;
      const name = fillNames[(rng() * fillNames.length) | 0];
      add(name, n.distance, side, Math.abs(lat) - edge, { scale: 0.85 + rng() * 0.5 });
    }
  }

  // --- themed sections around the lap ---
  for (const sec of sections) {
    const theme = THEMES[sec.theme];
    if (!theme) continue;
    for (let d = sec.start; d < sec.end; d += theme.step) {
      // two passes per step so both verges get populated
      for (const side of [1, -1]) {
        if (rng() < 0.05) continue;                    // gaps keep it from looking like a fence
        const entry = pick(rng, theme.entries);
        const jitter = (rng() - 0.5) * theme.step * 0.55;
        // farInfield lets background scatter reach much deeper on the
        // infield (-1) side than the outside -- used for filling a big
        // loop's open interior, which `fits()`'s reachability guard keeps
        // safe even at long reach (it simply stops placing once whatever
        // it's approaching is actually a different stretch of road).
        const far = (side === -1 && entry.farInfield != null) ? entry.farInfield : entry.far;
        const lateral = edge + entry.near + rng() * (far - entry.near);
        const scale = 0.88 + rng() * 0.3;
        add(entry.name, d + jitter, side, lateral, { scale });
      }
    }
  }

  layer.sortableChildren = true;
  return { layer };
}

/**
 * Soft ground patches scattered over the verges.
 *
 * A single tiled lawn texture reads as flat no matter how good the tile is;
 * a scatter of large, irregular, semi-transparent patches is what gives the
 * ground large-scale variation.
 */
export function buildGroundPatches(path, tex, { edge, seed = 1, count = 90, names }) {
  const rng = mulberry32(seed * 104729 + 7);
  const layer = new Container();
  layer.label = 'patches';
  for (let i = 0; i < count; i++) {
    const d = rng() * path.length;
    const side = rng() < 0.5 ? 1 : -1;
    const lateral = edge + 10 + rng() * 260;
    const p = path.offsetPoint(path.indexAtDistance(d), side * lateral);
    const name = names[(rng() * names.length) | 0];
    const sp = new Sprite(tex[name]);
    sp.anchor.set(0.5);
    const size = 320 + rng() * 760;
    sp.width = size;
    sp.height = size * (0.62 + rng() * 0.5);
    sp.rotation = rng() * Math.PI * 2;
    sp.alpha = 0.18 + rng() * 0.26;
    sp.position.set(p.x, p.y);
    layer.addChild(sp);
  }
  return layer;
}

/**
 * Short side-street stubs leading away from the main road, blocked off by a
 * barrier landmark placed at the same spot -- so a closed loop still reads
 * as a slice of a real street grid (other roads you can see but can't take)
 * instead of a purpose-built circuit shape with nothing beyond the kerb.
 *
 * Pure vector math off the path's own normal/tangent at that point (no
 * rotation-angle guessing): the stub is a simple quad from the road edge
 * outward, matching the "look at the centreline" props' dx/dy approach.
 *
 * @param {TrackPath} path
 * @param {object} opts { edge, list: [{ at, side, width, length }] }
 */
export function buildSideStreets(path, { edge, list = [] }) {
  const layer = new Container();
  layer.label = 'sideStreets';

  for (const s of list) {
    const k = path.wrap(path.indexAtDistance(s.at * path.length));
    const cx = path.points[k][0], cy = path.points[k][1];
    const nx = path.normals[k * 2], ny = path.normals[k * 2 + 1];
    const tx = -ny, ty = nx; // tangent, perpendicular to the normal
    const ux = nx * s.side, uy = ny * s.side; // unit vector down the stub

    const hw = (s.width ?? 220) / 2;
    const startDist = edge - 20;                 // slight overlap, no seam at the join
    // Long enough to read as an actual street receding into the distance,
    // not a short nub -- a short stub was the "why does this look wrong"
    // complaint; a real cross street is at least a full block.
    const length = s.length ?? 900;
    const farDist = startDist + length;

    const bx = cx + ux * startDist, by = cy + uy * startDist;
    const fx = cx + ux * farDist, fy = cy + uy * farDist;

    const g = new Graphics();
    // asphalt-toned (matches the main road's tinted asphalt, not the dark
    // dirt ground) so it clearly reads as "more street", not a shadow
    g.poly([
      bx - tx * hw, by - ty * hw,
      bx + tx * hw, by + ty * hw,
      fx + tx * hw, fy + ty * hw,
      fx - tx * hw, fy - ty * hw,
    ]).fill({ color: 0x9a9ea3, alpha: 0.95 });

    // thin white edge lines, same idea as the main road's painted edges --
    // without them the stub reads as a grey slab, not specifically a road
    const edgeHw = 4;
    for (const eSide of [1, -1]) {
      const off = hw - 12;
      g.poly([
        bx + tx * eSide * (off - edgeHw), by + ty * eSide * (off - edgeHw),
        bx + tx * eSide * (off + edgeHw), by + ty * eSide * (off + edgeHw),
        fx + tx * eSide * (off + edgeHw), fy + ty * eSide * (off + edgeHw),
        fx + tx * eSide * (off - edgeHw), fy + ty * eSide * (off - edgeHw),
      ]).fill({ color: 0xffffff, alpha: 0.5 });
    }

    // dashed yellow centreline, same read as the main road's -- this is
    // the single biggest cue that this is a street and not just pavement
    const DASH = 46, GAP = 36, dashHw = 6;
    for (let d = 0; d < length; d += DASH + GAP) {
      const d1 = Math.min(length, d + DASH);
      const p0x = bx + ux * d, p0y = by + uy * d;
      const p1x = bx + ux * d1, p1y = by + uy * d1;
      g.poly([
        p0x - tx * dashHw, p0y - ty * dashHw,
        p0x + tx * dashHw, p0y + ty * dashHw,
        p1x + tx * dashHw, p1y + ty * dashHw,
        p1x - tx * dashHw, p1y - ty * dashHw,
      ]).fill({ color: 0xd8c26a, alpha: 0.88 });
    }

    layer.addChild(g);
  }
  return layer;
}

