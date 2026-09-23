/**
 * Builds the layered road surface for a stage.
 *
 * The "cheap" look of the previous build came from the road being one flat
 * fill with a painted line on it. Here the surface is assembled from stacked
 * ribbons, each with its own material, so the eye reads real construction:
 *
 *   ground → run-off → apron → kerb → asphalt → wear → edge shading → paint
 *
 * Boundary bands are declared as an ordered list of widths growing outward
 * from the road edge, so they can never accidentally overlap and hide each
 * other. Each band overlaps its neighbour by a couple of units to avoid a
 * hairline gap where two meshes meet.
 */
import { Container, Graphics, TilingSprite, Texture } from '../pixi.js';
import { ribbonMesh } from './ribbon.js';

const OVERLAP = 2;

export const SURFACE_PRESETS = {
  circuit: {
    ground: 'grass',
    groundScale: 1.7,
    asphalt: { texture: 'road_asphalt', uRepeat: 4, vPer: 1 / 520 },
    ruts: { offset: 108, width: 92, alpha: 0.38, vPer: 1 / 900 },
    edgeLine: { inset: 16, width: 14, tint: 0xffffff, alpha: 0.9 },
    centreLine: null,
    // ordered outward from the asphalt edge
    bands: [
      { texture: 'curb_redwhite', width: 84, vPer: 1 / 90 },
      { texture: null, width: 52, tint: 0xa8adb0, alpha: 0.9 },          // concrete apron
      { texture: 'gravel', width: 210, vPer: 1 / 300, uRepeat: 1.6, alpha: 0.95 },
    ],
  },
  city: {
    ground: 'dirt',
    groundScale: 2.2,
    // The town's lots and yards (stage 2 is the only stage on this preset,
    // and its blocks are built over it -- see render/city.js): concrete,
    // not the dark earth it was when there was nothing past the pavement.
    groundTint: 0xa9afb6,
    asphalt: { texture: 'road_asphalt', uRepeat: 3, vPer: 1 / 520, tint: 0xa6abb2 },
    ruts: { offset: 82, width: 74, alpha: 0.4, vPer: 1 / 900 },
    edgeLine: { inset: 14, width: 11, tint: 0xffffff, alpha: 0.85 },
    // White dashed, not yellow. On an ordinary Japanese street the centre
    // line is a white broken line; yellow means no overtaking and belongs
    // on the mountain pass, where stage 3 uses it.
    centreLine: { texture: 'dash_white', width: 11, vPer: 1 / 120 },
    junctionMarks: true,
    paintStart: false, // an ordinary street has no painted chequer
    startMarker: 'crosswalk', // ...it gets a crosswalk instead, see buildSurface
    // no racing kerb -- just a plain gutter strip into the sidewalk, the
    // way an actual public road meets its pavement. Pavement is kept wide
    // (230, up from a first pass at 150) so kerbside decoration -- cones,
    // parked cars, fences -- has room to sit clear of wallHalf without
    // spilling off the paved surface into the dirt.
    // Still 18 + 230 = 248 in total -- the figure `edge` is derived from and
    // that every landmark lateral in layouts.js stage 2 was solved against
    // -- but cut into the four things a real footpath is made of instead of
    // one flat slab. The pavement itself is textured (curb_concrete tiles
    // as paving panels) rather than a fill: at this zoom a 230-unit band of
    // single-colour grey is the largest flat area anywhere in the game, and
    // it was what made the street read as a car park.
    // Four solid strips, not one flat slab and not a texture. Every tiling
    // texture in the set is mid-to-dark and a tint can only multiply, so
    // there is no way to reach a light concrete through one: curb_concrete
    // read as a chequerboard at this zoom, and gravel came out darker than
    // the asphalt it borders. What a footpath actually needs from above is
    // structure -- a shadowed gutter, a kerb face catching the light, the
    // dirty strip traffic throws at the kerb, then clean paving -- and
    // that is all readable in flat fills. Still 248 in total, the figure
    // `edge` and every landmark lateral in layouts.js are measured against.
    bands: [
      { texture: null, width: 14, tint: 0x5c6167, alpha: 0.95 },     // gutter
      { texture: null, width: 10, tint: 0xc8ccd0, alpha: 1.0 },      // kerb face
      { texture: null, width: 34, tint: 0x7d848b, alpha: 0.98 },     // grime at the kerb
      { texture: null, width: 190, tint: 0x969ea6, alpha: 0.98 },    // paving
    ],
    bandEdge: { width: 34, tint: 0x4b5157, alpha: 0.85 },  // shade at the building line
  },
  mountain: {
    ground: 'grass_dry',
    groundScale: 1.5,
    // Dry, olive hillside rather than lawn. The previous tint was bright
    // enough that the verges read as mown grass beside a circuit, which
    // fought the rock, the autumn stands and the guardrail all trying to
    // say "mountain" at the same time.
    groundTint: 0x87906b,
    asphalt: { texture: 'road_asphalt', uRepeat: 2.4, vPer: 1 / 520, tint: 0xc3bfb8 },
    ruts: { offset: 62, width: 62, alpha: 0.34, vPer: 1 / 900 },
    edgeLine: { inset: 11, width: 9, tint: 0xf0ead8, alpha: 0.8 },
    // Solid yellow, not white dashes. On a Japanese mountain road the centre
    // line is an unbroken yellow no-overtaking line for essentially the whole
    // pass, and it is one of the strongest "this is a touge, not a circuit"
    // cues available from directly overhead. `texture: null` paints it as a
    // tinted solid rather than a dashed strip.
    centreLine: { texture: null, width: 10, tint: 0xf0c542, alpha: 0.95 },
    // Total band width here (34 + 150 = 184) is load-bearing, not just a
    // look: it's added to roadHalf to get `edge`, which is exactly the
    // number stage 3's course generator used for its corner-radius and
    // no-self-overlap safety margins (see the big comment on
    // buildStage3Path in stages.js). Widening this band without
    // regenerating that course is what let the guardrail ribbon -- drawn
    // at a fixed reach from wallHalf, independent of this band -- end up
    // visually crossing a DIFFERENT nearby stretch of the same course:
    // the course was only proven clear at the OLD, narrower edge, and
    // wallHalf itself never moved, so widening the band silently ate into
    // a margin the path's own generation had already spent to the limit.
    // If this ever needs to change again, stage3_v2's generator constants
    // (BAND_WIDTH, EDGE, MIN_SEP, CR_MIN_SAFE) have to change with it and
    // the whole course re-validated, not just this number.
    // Total is still 34 + 150 = 184; only the split changed. See the note
    // above -- that sum is what the course generator's clearances are
    // measured against, so the bands may be re-cut but not widened.
    bands: [
      { texture: null, width: 22, tint: 0x9d9384, alpha: 0.95 },         // gritty verge
      // the foot of the cut slope, in its own shadow -- without this the
      // rock band reads as a flat mat lying beside the road rather than a
      // face rising off it
      { texture: null, width: 30, tint: 0x61594e, alpha: 0.92 },
      // rock face, not a generic "dirt shoulder" -- darker, rockier tint
      { texture: 'dirt', width: 132, vPer: 1 / 260, uRepeat: 1.3, tint: 0x8c8478, alpha: 0.94 },
    ],
    // A lit strip along the top of the rock band. Rock catches the light at
    // its crest and sits in shadow at its foot; having both ends of that
    // gradient is what turns a flat band into a slope.
    bandEdge: { width: 34, tint: 0xb5ab9c, alpha: 0.8 },
    // The land falls away on the OUTSIDE of a switchback -- the turn is
    // built out on fill, which is why a hairpin has a guardrail on that side
    // and a cut face on the other. Curvature-driven, so it only appears
    // where it is actually true, and fades in rather than starting abruptly.
    valleyDrop: { reach: 280, tint: 0x0d1a0b, alpha: 0.9, from: 0.20, full: 0.48, lip: 26, lipTint: 0xb2ab97 },
    // Roadside delineator posts (視線誘導標): white poles with a reflector,
    // set just outside the rail at a wider spacing than the rail's own posts.
    delineator: { every: 320, tint: 0xf4f7f8, reflector: 0xff9838, out: 34 },
    // Guardrail as a continuous painted ribbon (see buildSurface), not
    // individually placed sprites -- discrete rail segments left gaps
    // wherever a curve made two neighbours' collision checks conflict,
    // which is exactly at the hairpins a real rail is most needed. A
    // ribbon just follows the path, so it can never gap. `inset` is
    // measured from wallHalf, not the road edge, since what actually
    // matters is clearing the player's own reach, not any particular band.
    // tint is bright white, not a subtle silver-grey -- the first attempt
    // (0xd7dbdd) technically rendered fine but was nearly invisible
    // against the similarly light rock/verge bands right next to it; a
    // real guardrail's reflective beam is exactly this kind of "stands
    // out against everything" bright by design.
    guardrail: { inset: 90, width: 20, tint: 0xf4f6f7, postTint: 0x2b2d30, postEvery: 95, postWidth: 8 },
  },

  highway: {
    ground: 'dirt',
    groundScale: 2.4,
    groundTint: 0x343b43,
    asphalt: { texture: 'road_asphalt', uRepeat: 4.8, vPer: 1 / 600, tint: 0x9fa5aa },
    ruts: { offset: 118, width: 78, alpha: 0.22, vPer: 1 / 1000 },
    edgeLine: { inset: 18, width: 12, tint: 0xf7f7f3, alpha: 0.95 },
    centreLine: null,
    highwayLanes: true,
    elevatedDeck: true,
    concreteWalls: true,
    paintStart: false,   // a chequer would read as a racetrack, not a highway
    startMarker: 'gate', // ...so the lap line is a lit gate instead
    bands: [
      { texture: null, width: 26, tint: 0x5d6267, alpha: 1.0 },
      { texture: null, width: 78, tint: 0x73777a, alpha: 1.0 },
    ],
  },

  /**
   * Stage 5 runs the same expressway loop stage 4 does (see STAGE_PATHS),
   * so the one thing it must not do is look like stage 4. Same road,
   * different world: stage 4 is that expressway at night through the middle
   * of a city; this is it in daylight, out where the city has run out --
   * open ground, warm concrete, green verges, and a road surface that has
   * been baked rather than lit by sodium.
   *
   * Everything structural (three lanes, elevated deck, crash walls, the lit
   * gate at the start line) is kept, because those belong to the ROAD, not
   * to the time of day.
   */
  grandtour: {
    ground: 'grass_dry',
    groundScale: 1.9,
    groundTint: 0x9aa878,
    asphalt: { texture: 'road_asphalt', uRepeat: 4.8, vPer: 1 / 600, tint: 0xbfc2c0 },
    ruts: { offset: 96, width: 72, alpha: 0.26, vPer: 1 / 1000 },
    edgeLine: { inset: 16, width: 12, tint: 0xfbfaf4, alpha: 0.95 },
    centreLine: null,
    highwayLanes: true,
    elevatedDeck: true,
    concreteWalls: true,
    paintStart: false,
    startMarker: 'gate',
    bands: [
      { texture: null, width: 24, tint: 0x8e8b80, alpha: 1.0 },
      { texture: 'gravel', width: 74, vPer: 1 / 320, uRepeat: 1.4, tint: 0xb3ab97, alpha: 0.96 },
    ],
  },

  /**
   * Stage 5's three sectors. It is one road with one width (roadHalf 240)
   * that changes character twice round the lap, so these are the existing
   * city / mountain / highway treatments re-cut for that width rather than
   * new looks: the band totals differ (176, 120, 104) because each sector's
   * corners are sized against its own built width -- the inside of a turn
   * has to clear it or the outermost band folds through itself -- and
   * because a city footpath, a rock cut and a motorway hard shoulder are
   * not the same size in the first place.
   *
   * Each carries its own `terrain`, so the ground changes with the road.
   */
  /**
   * Stage 5's start/finish complex: a permanent grand-prix pit straight the
   * lap launches out of before the course spills into the city streets.
   * Racing kerbs, a concrete apron and a gravel trap, a painted chequer at
   * the line, and no centre line -- a circuit does not have one.
   *
   * Its ground/terrain settings are gt_city's verbatim, on purpose: this is
   * the first sector in the list, and buildSurface only lays the shared
   * ground plane for the first one, so anything different here would
   * re-tint the whole lap.
   *
   * The band widths total 180 against gt_city's 176. That is not a
   * coincidence either -- surfaceExtent() of the WIDEST sector is what prop
   * placement measures `near`/`far` from, so a generous run-off here would
   * quietly push every kerbside prop on the city streets outward too.
   */
  gt_circuit: {
    // (no terrain band: it would be the ground plane's own earth again)
    ground: 'dirt', groundScale: 2.2, groundTint: 0x767c84,
    asphalt: { texture: 'road_asphalt', uRepeat: 3.4, vPer: 1 / 540, tint: 0x9aa0a7 },
    ruts: { offset: 92, width: 78, alpha: 0.26, vPer: 1 / 950 },
    edgeLine: { inset: 15, width: 13, tint: 0xffffff, alpha: 0.95 },
    centreLine: null,
    bands: [
      { texture: 'curb_redwhite', width: 60, vPer: 1 / 78 },
      { texture: null, width: 44, tint: 0xb0b5b9, alpha: 0.95 },   // concrete apron
      { texture: 'gravel', width: 76, vPer: 1 / 300, uRepeat: 1.4, alpha: 0.95 },
    ],
    bandEdge: { width: 26, tint: 0x5b6067, alpha: 0.8 },
  },

  gt_city: {
    // (no terrain band: it would be the ground plane's own earth again)
    ground: 'dirt', groundScale: 2.2, groundTint: 0x767c84,
    asphalt: { texture: 'road_asphalt', uRepeat: 3, vPer: 1 / 520, tint: 0xa6abb2 },
    ruts: { offset: 86, width: 74, alpha: 0.4, vPer: 1 / 900 },
    edgeLine: { inset: 14, width: 11, tint: 0xffffff, alpha: 0.85 },
    centreLine: { texture: 'dash_white', width: 11, vPer: 1 / 120 },
    junctionMarks: true,
    paintStart: false,
    startMarker: 'crosswalk',
    bands: [
      { texture: null, width: 12, tint: 0x5c6167, alpha: 0.95 },
      { texture: null, width: 8, tint: 0xc8ccd0, alpha: 1.0 },
      { texture: null, width: 26, tint: 0x7d848b, alpha: 0.98 },
      { texture: null, width: 130, tint: 0x969ea6, alpha: 0.98 },
    ],
    bandEdge: { width: 28, tint: 0x4b5157, alpha: 0.85 },
  },

  gt_touge: {
    ground: 'grass_dry', groundScale: 1.5, groundTint: 0x87906b,
    terrain: 1600,
    asphalt: { texture: 'road_asphalt', uRepeat: 2.6, vPer: 1 / 520, tint: 0xc3bfb8 },
    ruts: { offset: 70, width: 62, alpha: 0.34, vPer: 1 / 900 },
    edgeLine: { inset: 11, width: 9, tint: 0xf0ead8, alpha: 0.8 },
    centreLine: { texture: null, width: 10, tint: 0xf0c542, alpha: 0.95 },
    paintStart: false,
    bands: [
      { texture: null, width: 18, tint: 0x9d9384, alpha: 0.95 },
      { texture: null, width: 24, tint: 0x61594e, alpha: 0.92 },
      { texture: 'dirt', width: 78, vPer: 1 / 260, uRepeat: 1.3, tint: 0x8c8478, alpha: 0.94 },
    ],
    bandEdge: { width: 26, tint: 0xb5ab9c, alpha: 0.8 },
    valleyDrop: { reach: 260, tint: 0x0d1a0b, alpha: 0.9, from: 0.20, full: 0.48, lip: 24, lipTint: 0xb2ab97 },
    guardrail: { inset: 80, width: 18, tint: 0xf4f6f7, postTint: 0x2b2d30, postEvery: 95, postWidth: 8 },
    delineator: { every: 320, tint: 0xf4f7f8, reflector: 0xff9838, out: 30 },
  },

  gt_highway: {
    ground: 'dirt', groundScale: 2.4, groundTint: 0x4a5058,
    // No terrain band of its own: it never showed (see main.js groundExtras)
    // and the expressway has always run over the town's ground.
    asphalt: { texture: 'road_asphalt', uRepeat: 4.2, vPer: 1 / 600, tint: 0x9fa5aa },
    ruts: { offset: 96, width: 74, alpha: 0.22, vPer: 1 / 1000 },
    edgeLine: { inset: 16, width: 12, tint: 0xf7f7f3, alpha: 0.95 },
    centreLine: null,
    highwayLanes: true,
    elevatedDeck: true,
    concreteWalls: true,
    paintStart: false,
    bands: [
      { texture: null, width: 26, tint: 0x5d6267, alpha: 1.0 },
      { texture: null, width: 78, tint: 0x73777a, alpha: 1.0 },
    ],
  },

};

/**
 * @param {TrackPath} path
 * @param {object} tex loaded texture map keyed by base name
 * @param {object} cfg { roadHalf, wallHalf, preset, ... }
 *
 * `roadHalf` and `wallHalf` may be numbers or functions of route index: a
 * stage whose road changes width (stage 5's expressway) passes functions,
 * and everything laid out from the road edge follows.
 *
 * `sector` ({ from, span, fadeIn, fadeOut }, route indices) is the whole
 * stretch this preset owns on a mixed stage; `range` may be one piece of it
 * (a sector is cut into ground and deck pieces). Where two sectors meet
 * they overlap by the incoming one's `fadeIn` (= the outgoing one's
 * `fadeOut`), and across that overlap:
 *   - the boundary bands (kerb, shoulder, verge, rock cut...) of the one
 *     going narrow down to the road edge while the other's widen out of it,
 *     so a footpath runs out into a gravel shoulder instead of stopping on
 *     a line;
 *   - the incoming road surface and ground are laid over the outgoing ones
 *     in steps of rising opacity -- a cross-fade, since a mesh has one alpha;
 *   - paint, walls and rails change over at the midpoint, where a real road
 *     changes them, and a guardrail flares out to its terminal.
 * Without a `sector`, none of this happens and the output is as before.
 *
 * `fold` ({ pos, neg } per route index, see foldLimits) caps how far out anything may be
 * drawn on the INSIDE of a bend: on the pass's hairpins (apex radius
 * 420-465) the shoulder and guardrail reached 400 from the centreline, so
 * the inner rail ran round a loop of radius 20-60 and was drawn as a spike
 * pointing into the corner. Where the cap bites, everything beyond the road
 * edge on that side is squeezed in proportionally (insideSqueeze) -- the
 * rail stays the outermost thing, just closer to the road, the way a real
 * hairpin's inside rail is -- and main.js moves the wall on that side with
 * it.
 */
export function buildSurface(path, tex, {
  roadHalf, wallHalf, preset = 'circuit', range = null, ground = true, terrainLayer = null,
  noTerrain = false, skipJunctionAt = null, sector = null, fold = null,
  baseHalf = typeof roadHalf === 'number' ? roadHalf : null,
  underlay = null, gaps = null, crossroads = null,
}) {
  const P = SURFACE_PRESETS[preset] || SURFACE_PRESETS.circuit;
  const layer = new Container();
  layer.label = 'surface';
  // Anything that physically hangs OVER the carriageway goes in here rather
  // than into `layer`. The caller parents it above the actors, so a car
  // passes under it instead of over it; see paintSignalOverhead.
  layer.overhead = new Container();
  layer.overhead.label = 'surface-overhead';
  // Everything PAINTED on the carriageway -- lane lines, crossings, the
  // start marker -- collected so a caller can hide it on its own. On the
  // raised deck that matters: faded to the same 0.10 as the road, white
  // lines over dark ground still read clearly, and since the deck crosses
  // the road below at an angle they read as lines drawn ACROSS the road
  // being driven. The deck's road surface can stay as a ghost; its
  // markings have to go completely.
  const markings = new Container();
  markings.label = 'surface-markings';
  layer.markings = markings;

  // A stage whose road changes character part-way round (stage 5 runs city
  // streets, then a pass, then an expressway) calls this once per sector
  // with its own preset and the index range that sector covers. `R` goes
  // into every ribbon so each layer is drawn over that span only, and the
  // ground plane -- which is one sprite over the whole course -- is drawn
  // by the first call alone.
  const R = range ? { fromIndex: range.fromIndex, spanIndices: range.spanIndices } : {};
  const base = range ? range.fromIndex : 0;
  const span = range ? range.spanIndices : path.count;

  const RH = typeof roadHalf === 'function' ? roadHalf : () => roadHalf;
  const WH = wallHalf == null ? null : (typeof wallHalf === 'function' ? wallHalf : () => wallHalf);
  const rh0 = baseHalf ?? RH(base);

  // --- sector hand-over (see the header) ---
  const S = sector && range ? sector : null;
  const so = (k) => path.wrap(k - S.from);
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const taper = S && (S.fadeIn || S.fadeOut)
    ? (k) => {
      const o = so(k);
      return Math.min(
        S.fadeIn ? ease((o + 0.5) / S.fadeIn) : 1,
        S.fadeOut ? ease((S.span - o - 0.5) / S.fadeOut) : 1,
      );
    }
    : () => 1;
  // this piece's share of the stretch the sector owns outright
  const pieceO = S ? so(base) : 0;
  const ownFrom = S ? Math.floor(S.fadeIn / 2) : 0;
  const ownTo = S ? S.span - Math.floor(S.fadeOut / 2) : span;
  const ownA = Math.max(ownFrom, pieceO), ownB = Math.min(ownTo, pieceO + span);
  const OWN = !S ? R : (ownB > ownA ? { fromIndex: path.wrap(S.from + ownA), spanIndices: ownB - ownA } : null);
  const ownBase = OWN ? (OWN.fromIndex ?? 0) : 0;
  const ownSpan = OWN ? (OWN.spanIndices ?? path.count) : 0;
  const inSpan = (k) => path.wrap(k - base) < span;
  const inOwn = (k) => OWN != null && path.wrap(k - ownBase) < ownSpan;
  const ownIndices = function* (step) {
    for (let o = 0; o < ownSpan; o += step) yield path.wrap(ownBase + o);
  };
  // Cross-fade: `make(range, alphaMul)` is called for each step of the
  // sector's fade-in that falls in this piece, then once for the rest.
  const faded = (make) => {
    if (!S || !S.fadeIn) { make(R, 1); return; }
    const K = 6;
    for (let st = 0; st < K; st++) {
      const lo = Math.max(Math.floor((S.fadeIn * st) / K), pieceO);
      const hi = Math.min(Math.floor((S.fadeIn * (st + 1)) / K), pieceO + span);
      if (hi > lo) make({ fromIndex: path.wrap(S.from + lo), spanIndices: hi - lo }, (st + 1) / (K + 1));
    }
    const lo = Math.max(S.fadeIn, pieceO), hi = pieceO + span;
    if (hi > lo) make({ fromIndex: path.wrap(S.from + lo), spanIndices: hi - lo }, 1);
  };
  // How far a strip may reach on the inside of a bend (see `fold`).
  const guard = fold
    ? (k, off) => {
      const a = Math.abs(off), rh = RH(k);
      if (a <= rh) return off;
      const lim = off > 0 ? fold.pos[k] : fold.neg[k];
      return Math.sign(off) * (rh + (a - rh) * squeezeAt(P, lim, rh, WH ? WH(k) : null));
    }
    : (k, off) => off;
  const G = (fn) => (k) => guard(k, fn(k));
  // Where a street meets the course (city.js streetMouths) that side's
  // pavement, kerb and edge paint are left out, so the street's own asphalt
  // -- in the underlay -- shows through: the junction is open. `rg` is the
  // range a ribbon would otherwise cover; this is the runs of it to draw.
  const sideRuns = (rg, side) => {
    const mask = gaps ? (side > 0 ? gaps.pos : gaps.neg) : null;
    if (!mask || !rg) return rg ? [rg] : [];
    const from = rg.fromIndex ?? 0, spanN = rg.spanIndices ?? path.count;
    const out = [];
    let st = -1;
    for (let o = 0; o <= spanN; o++) {
      const keep = o < spanN && !mask[path.wrap(from + o)];
      if (keep && st < 0) st = o;
      else if (!keep && st >= 0) {
        out.push({ ...rg, fromIndex: path.wrap(from + st), spanIndices: o - st });
        st = -1;
      }
    }
    return out;
  };
  // Any partial ribbon counts its texture V from the lap's index 0, so two
  // pieces of the same material meet without a jump in the pattern: stage
  // 4's road is built in pieces at every deck-level change, and with V
  // restarting per piece the wheel-track wear and the lane dashes stepped
  // at each one, drawn as a hard-edged darker box across the lanes.
  const absV = range ? { absoluteV: true } : {};

  // --- ground: one world-space tiling plane covering the track bounds ---
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  if (ground) {
  for (const [x, y] of path.points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const pad = rh0 + 3200;
  const groundSprite = new TilingSprite({
    texture: tex[P.ground],
    width: (maxX - minX) + pad * 2,
    height: (maxY - minY) + pad * 2,
  });
  groundSprite.position.set(minX - pad, minY - pad);
  groundSprite.tileScale.set(P.groundScale ?? 1.6);
  if (P.groundTint) groundSprite.tint = P.groundTint;
  layer.addChild(groundSprite);
  }
  // Whatever the course runs through (stage 2's town, see city.js) goes
  // over the ground and under everything of the course's own.
  if (underlay) layer.addChild(underlay);

  // --- per-sector terrain ---
  // The ground plane is one sprite over the whole course, which is right
  // until a course changes country part-way round. A sector that sets
  // `terrain` lays its own ground down as a band along its own stretch,
  // over the shared plane, so stage 5 can run city dirt, then a dry
  // hillside, then expressway scrub without three ground sprites fighting
  // over the same bounding box.
  //
  // It goes in `terrainLayer`, a container the caller puts UNDERNEATH every
  // sector's road, not in this sector's own container. Sector containers
  // are siblings drawn in order, and on a course that crosses over itself
  // the last sector's terrain is physically on top of an earlier sector's
  // road -- stage 5's viaduct flies over the city, and with the terrain in
  // the sector's own container it painted the city street out of existence
  // for a third of a block either side.
  //
  // A stretch carried on a bridge opts out with `noTerrain`: there is no
  // land under a viaduct to lay, and the band is wider than the deck, so
  // built with the deck it paints a swathe of hillside over whatever the
  // bridge is flying above.
  if (P.terrain && !noTerrain) {
    // Feathered: two wider, fainter copies underneath, so the band's edge
    // melts into the ground around it instead of stopping on a line.
    // Mapped flat onto the world at the ground plane's own scale, so it is
    // the same ground stage 3 lies on rather than a strip of it bent round
    // every hairpin (which smeared it into radial streaks).
    const tile = (tex[P.ground]?.width || 256) * (P.groundScale ?? 1.6);
    for (const [extra, a] of [[520, 0.22], [260, 0.5], [0, 1]]) {
      const half = P.terrain + extra;
      faded((r, am) => (terrainLayer ?? layer).addChild(ribbonMesh(path, tex[P.ground], {
        ...r, planar: tile,
        innerOffset: -half, outerOffset: half,
        tint: P.groundTint, alpha: am * a,
      })));
    }
  }

  // --- elevated expressway under-deck / cast shadow ---
  // Oversized dark ribbons underneath the asphalt make the road read as a
  // raised concrete deck instead of paint sitting directly on the ground.
  if (P.elevatedDeck) {
    for (const side of [1, -1]) {
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        ...R,
        innerOffset: G((k) => side * (RH(k) + 18)),
        outerOffset: G((k) => side * (RH(k) + 18 + 137 * taper(k))),
        tint: 0x111820, alpha: 0.42,
      }));
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        ...R,
        innerOffset: G((k) => side * (RH(k) + 6)),
        outerOffset: G((k) => side * (RH(k) + 6 + 86 * taper(k))),
        tint: 0x3d4247, alpha: 0.98,
      }));
    }
  }

  // --- main asphalt ---
  faded((r, am) => layer.addChild(ribbonMesh(path, tex[P.asphalt.texture], {
    ...r, ...absV,
    innerOffset: (k) => -RH(k), outerOffset: (k) => RH(k),
    uInner: 0, uOuter: P.asphalt.uRepeat, vPerWorldUnit: P.asphalt.vPer,
    tint: P.asphalt.tint, alpha: am,
  })));

  // --- wear: two wheel tracks polished into the surface ---
  // Laid at the same share of the road's width wherever it is wider.
  if (P.ruts && OWN) {
    for (const sgn of [-1, 1]) {
      const at = (k) => sgn * P.ruts.offset * (RH(k) / rh0);
      layer.addChild(ribbonMesh(path, tex.rut_overlay, {
        ...OWN, ...absV,
        innerOffset: (k) => at(k) - P.ruts.width / 2, outerOffset: (k) => at(k) + P.ruts.width / 2,
        uInner: 0, uOuter: 1, vPerWorldUnit: P.ruts.vPer, alpha: P.ruts.alpha,
      }));
    }
  }

  // --- contact shading on the asphalt beside the boundary ---
  if (OWN) {
    for (const side of [1, -1]) for (const run of sideRuns(OWN, side)) {
      layer.addChild(ribbonMesh(path, tex.edge_shadow, {
        ...run, ...absV,
        innerOffset: (k) => side * RH(k), outerOffset: (k) => side * (RH(k) - 110),
        uInner: 0, uOuter: 1, vPerWorldUnit: 1 / 2048, alpha: 0.9,
      }));
    }
  }

  // Everything from here to the boundary bands is paint on the road, and
  // goes into the markings container at exactly the z it would have had.
  layer.addChild(markings);

  // --- painted edge lines ---
  if (P.edgeLine && OWN) {
    for (const side of [1, -1]) for (const run of sideRuns(OWN, side)) {
      const inner = (k) => side * (RH(k) - P.edgeLine.inset);
      markings.addChild(ribbonMesh(path, Texture.WHITE, {
        ...run,
        innerOffset: inner, outerOffset: (k) => inner(k) - side * P.edgeLine.width,
        tint: P.edgeLine.tint, alpha: P.edgeLine.alpha,
      }));
    }
  }

  // --- dashed centre line (public-road stages) ---
  if (P.centreLine && OWN) {
    const cl = P.centreLine;
    markings.addChild(ribbonMesh(path, cl.texture ? tex[cl.texture] : Texture.WHITE, {
      ...OWN, ...absV,
      innerOffset: -cl.width / 2, outerOffset: cl.width / 2,
      uInner: 0, uOuter: 1, vPerWorldUnit: cl.vPer ?? 1 / 1024,
      tint: cl.tint, alpha: cl.alpha ?? 0.92,
    }));
  }


  // --- metropolitan expressway lane markings ---
  // Three usable lanes: two dashed white separators at ±1/3 road width.
  if (P.highwayLanes && OWN) {
    for (const sgn of [-1, 1]) {
      markings.addChild(ribbonMesh(path, tex.dash_white, {
        ...OWN, ...absV,
        innerOffset: (k) => (sgn * RH(k)) / 3 - 6, outerOffset: (k) => (sgn * RH(k)) / 3 + 6,
        uInner: 0, uOuter: 1, vPerWorldUnit: 1 / 165, alpha: 0.94,
      }));
    }
  }

  // --- start / finish chequer, painted across the road -- a racing-circuit
  // convention; ordinary street stages opt out (preset.paintStart: false)
  // since a public road has no painted start line ---
  if (P.paintStart !== false && inSpan(0)) {
    const startSpan = 3;
    markings.addChild(ribbonMesh(path, tex.checker, {
        ...R,
      innerOffset: -RH(0), outerOffset: RH(0),
      uInner: 0, uOuter: 1,
      // exactly one copy of the two-row pattern over the painted span
      vPerWorldUnit: 1 / (startSpan * path.spacing),
      fromIndex: 0, spanIndices: startSpan,
    }));
  }

  // --- crosswalk, painted across the road at the start/finish line --
  // ordinary-street stages mark start/finish this way instead of a racing
  // chequer (a public road doesn't have one). Zebra bars, not a texture, so
  // it needs no new art: perpendicular strokes computed straight off the
  // path's own normal/tangent at distance 0, the same vector approach used
  // for the side-street stubs in props.js.
  if (P.startMarker === 'crosswalk' && inSpan(0)) {
    const g = new Graphics();
    paintCrossing(g, path, 0, RH(0) - (P.edgeLine?.inset ?? 14) - 4);
    markings.addChild(g);
  }

  // --- junction markings: a crossing on each arm of every corner ---
  // A lap of nothing but road reads as a circuit no matter what stands
  // beside it. Zebra bars and a stop line on the approach and the exit of
  // each turn are what make a corner read as an intersection instead, and
  // they cost no new art. Driven off the path's own curvature, so they
  // follow the course rather than a list of lap fractions that goes stale
  // the moment the course is regenerated.
  //
  // Only on a turn a junction would be: 60 degrees or more. A gentle bend
  // in the road is not an intersection, and stage 5's town has two 34-degree
  // bends -- the second of them at the tunnel mouth -- that were each given
  // a pair of zebra crossings and signals out in the middle of nowhere.
  if (P.junctionMarks) {
    const g = new Graphics();
    const gantry = new Graphics();
    const setback = Math.round(210 / path.spacing);
    // [crossing index, which stop line, signal index]
    const sites = [];
    for (const [enter, exit] of cornerRuns(path, 0.16)) {
      if (Math.abs(turnBetween(path, enter, exit)) < (60 * Math.PI) / 180) continue;
      sites.push([path.wrap(enter - setback), 'approach', path.wrap(enter - setback)]);
      sites.push([path.wrap(exit + setback), 'oncoming', path.wrap(exit + setback)]);
    }
    // A street crossing a straight (`crossroads`, from city.js): a crossing
    // on each side of it, level with the cross street's pavement, and the
    // signal on the corner just beyond that pavement.
    const crossSites = [];
    for (const kc of crossroads || []) {
      const c = Math.round(360 / path.spacing), sg = Math.round(530 / path.spacing);
      crossSites.push([path.wrap(kc - c), 'approach', path.wrap(kc - sg)]);
      crossSites.push([path.wrap(kc + c), 'oncoming', path.wrap(kc + sg)]);
    }
    // A corner's crossing that would land within ~1,000 of a crossroads'
    // own goes: on a short block the two were a pair of crossings and a
    // pair of signals almost on top of each other.
    const gapIdx = Math.round(1000 / path.spacing);
    const apart = (a, b) => Math.min(path.wrap(a - b), path.wrap(b - a));
    for (let i = sites.length - 1; i >= 0; i--) {
      if (crossSites.some((c) => apart(c[0], sites[i][0]) < gapIdx)) sites.splice(i, 1);
    }
    sites.push(...crossSites);
    for (const [k, stop, ks] of sites) {
      if (!inOwn(k)) continue;
      // A junction the viaduct flies over gets no signals. The gantry is
      // drawn above the cars, which necessarily puts it above the deck
      // too, so a signal head left here shows through the bridge from
      // the carriageway on top of it.
      if (skipJunctionAt?.(k)) continue;
      const half = RH(k) - (P.edgeLine?.inset ?? 14) - 4;
      // post at the back of the pavement, head reaching back in over the
      // road -- on the driver's left (-normal), as traffic keeps left
      const signalOut = -(RH(ks) + 250);
      const signalReach = -(RH(ks) - 120);
      paintCrossing(g, path, k, half, { stop });
      paintSignalShadow(g, path, ks, signalOut, signalReach);
      paintSignalOverhead(gantry, path, ks, signalOut, signalReach);
    }
    markings.addChild(g);
    layer.overhead.addChild(gantry);
  }

  // --- start/finish gate (expressway stages) ---
  // The highway preset paints neither a racing chequer nor a crosswalk, so
  // until now its start/finish line was completely unmarked -- on a 90k-unit
  // lap there was nothing at all to tell you where the lap ended. A chequer
  // would look wrong on an expressway, so this is a gate instead: a bright
  // band across the carriageway with a lit pylon standing at each shoulder,
  // which reads at speed and from a distance without pretending to be a
  // racetrack. Geometry comes straight off the path's own normal/tangent at
  // distance 0, the same approach as the crosswalk above.
  if (P.startMarker === 'gate' && WH != null && inSpan(0)) {
    const rh = RH(0), wh = WH(0);
    const nx = path.normals[0], ny = path.normals[1];
    const tx = -ny, ty = nx;
    const cx0 = path.points[0][0], cy0 = path.points[0][1];
    const g = new Graphics();

    // the line itself: a wide band, plus a thin bright leading edge so it
    // still registers when crossed at full speed
    const band = (from, to, color, alpha) => {
      g.poly([
        cx0 + tx * from - nx * rh, cy0 + ty * from - ny * rh,
        cx0 + tx * to - nx * rh, cy0 + ty * to - ny * rh,
        cx0 + tx * to + nx * rh, cy0 + ty * to + ny * rh,
        cx0 + tx * from + nx * rh, cy0 + ty * from + ny * rh,
      ]).fill({ color, alpha });
    };
    band(-70, 70, 0xf2f4f5, 0.96);
    band(-92, -70, 0xffd34d, 0.9);
    band(70, 92, 0xffd34d, 0.9);

    // lit pylons just outside the barrier on both shoulders
    for (const side of [1, -1]) {
      const px = cx0 + nx * side * (wh + 55);
      const py = cy0 + ny * side * (wh + 55);
      g.circle(px, py, 150).fill({ color: 0xffd34d, alpha: 0.12 });
      g.circle(px, py, 78).fill({ color: 0xffd34d, alpha: 0.2 });
      const hw = 34, hl = 78;
      g.poly([
        px - tx * hw - nx * side * hl, py - ty * hw - ny * side * hl,
        px + tx * hw - nx * side * hl, py + ty * hw - ny * side * hl,
        px + tx * hw + nx * side * hl, py + ty * hw + ny * side * hl,
        px - tx * hw + nx * side * hl, py - ty * hw + ny * side * hl,
      ]).fill({ color: 0x2b2f33, alpha: 1 });
      g.poly([
        px - tx * (hw - 10) - nx * side * (hl - 18), py - ty * (hw - 10) - ny * side * (hl - 18),
        px + tx * (hw - 10) - nx * side * (hl - 18), py + ty * (hw - 10) - ny * side * (hl - 18),
        px + tx * (hw - 10) + nx * side * (hl - 18), py + ty * (hw - 10) + ny * side * (hl - 18),
        px - tx * (hw - 10) + nx * side * (hl - 18), py - ty * (hw - 10) + ny * side * (hl - 18),
      ]).fill({ color: 0xffd34d, alpha: 0.95 });
    }
    markings.addChild(g);
  }

  // --- boundary bands last, outermost first.
  // They must sit ON TOP of the asphalt: each band's inner edge carries a
  // semi-transparent contact shadow that has to fall on the road surface,
  // not on whatever is underneath it.
  // Every band starts back at the road edge rather than where the previous
  // one ended, so each is fully backed by the one under it. Materials with
  // transparent zones (the kerb's contact and cast shadows) then land on a
  // real surface instead of letting the ground show through.
  // At a sector hand-over every band's width runs down to nothing (taper).
  const bounds = [];
  let cursor = 0;
  for (const band of P.bands || []) {
    cursor += band.width;
    bounds.push({ band, to: cursor });
  }
  for (let i = bounds.length - 1; i >= 0; i--) {
    const { band, to } = bounds[i];
    for (const side of [1, -1]) for (const run of sideRuns(R, side)) {
      layer.addChild(ribbonMesh(path, band.texture ? tex[band.texture] : Texture.WHITE, {
        ...run, ...absV,
        innerOffset: G((k) => side * (RH(k) - OVERLAP)),
        outerOffset: G((k) => side * (RH(k) + to * taper(k))),
        uInner: 0,
        uOuter: band.uRepeat ?? 1,
        vPerWorldUnit: band.vPer ?? 1 / 1024,
        alpha: band.alpha,
        tint: band.tint,
      }));
    }
  }


  // --- a strip along the OUTER edge of the boundary bands ---
  // The bands themselves each run from the road edge outward and paint over
  // one another, so none of them can put anything at the far edge alone.
  // Mountain uses this for the lit crest of the cut slope, city for the
  // shade where the footpath meets the building line.
  if (P.bandEdge) {
    const total = (P.bands || []).reduce((a, b) => a + b.width, 0);
    const outer = (k) => RH(k) + total * taper(k);
    for (const side of [1, -1]) for (const run of sideRuns(R, side)) {
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        ...run,
        innerOffset: G((k) => side * (outer(k) - P.bandEdge.width * taper(k))),
        outerOffset: G((k) => side * outer(k)),
        tint: P.bandEdge.tint, alpha: P.bandEdge.alpha,
      }));
    }
  }

  // --- the land falling away on the outside of a switchback ---
  // Only on the outside, only where the road is actually turning hard, and
  // faded in by how hard: a hairpin is built out on fill, so that is the
  // side that drops. Drawn beyond the guardrail (which goes in below), so
  // the rail reads as standing at the lip of it.
  if (P.valleyDrop && WH != null && OWN) {
    const vd = P.valleyDrop;
    const drop = outsideDropAmount(path, vd.from, vd.full);
    const start = (k) => WH(k) + 66;
    for (const side of [1, -1]) {
      const width = (k) => Math.max(0, side * drop[k]) * vd.reach;
      // A flat dark band just reads as a shadow. edge_shadow is a gradient
      // ACROSS the strip, so used from the lip outward it goes from deep
      // shade at the road's edge to nothing further out -- which is what
      // ground falling away from under you looks like from above.
      layer.addChild(ribbonMesh(path, tex.edge_shadow, {
        ...OWN,
        innerOffset: G((k) => side * (start(k) + width(k) * 0.05)),
        outerOffset: G((k) => side * (start(k) + width(k))),
        uInner: 0, uOuter: 1, vPerWorldUnit: 1 / 2048,
        tint: vd.tint, alpha: vd.alpha,
      }));
      // the built-out lip itself, catching the light -- without it the
      // shade starts from nothing and the edge has no edge
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        ...OWN,
        innerOffset: G((k) => side * (start(k) - vd.lip * Math.min(1, width(k) / vd.reach))),
        outerOffset: G((k) => side * (start(k) + vd.lip * 0.35 * Math.min(1, width(k) / vd.reach))),
        tint: vd.lipTint, alpha: 0.85,
      }));
    }
  }

  // --- elevated highway concrete crash walls ---
  if (P.concreteWalls && WH != null && OWN) {
    const wallGfx = new Graphics();
    const offset = (k) => WH(k) + 8;
    for (const side of [1, -1]) {
      // broad cast shadow under the wall
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        ...OWN,
        innerOffset: G((k) => side * (offset(k) - 18)), outerOffset: G((k) => side * (offset(k) + 34)),
        tint: 0x101418, alpha: 0.30,
      }));
      // dark wall base + bright concrete cap create height in top-down view
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        ...OWN,
        innerOffset: G((k) => side * (offset(k) - 11)), outerOffset: G((k) => side * (offset(k) + 17)),
        tint: 0x555b60, alpha: 1,
      }));
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        ...OWN,
        innerOffset: G((k) => side * (offset(k) - 8)), outerOffset: G((k) => side * (offset(k) + 7)),
        tint: 0xc9cdd0, alpha: 1,
      }));
    }
    // expansion joints / posts make the continuous wall read as constructed
    // concrete rather than a flat grey stripe.
    const step = Math.max(1, Math.round(115 / path.spacing));
    for (const i of ownIndices(step)) {
      const px=path.points[i][0], py=path.points[i][1];
      const nx=path.normals[i*2], ny=path.normals[i*2+1];
      const tx=-ny, ty=nx;
      for (const side of [1,-1]) {
        const o = Math.abs(guard(i, side * offset(i)));
        const cx=px+nx*side*o, cy=py+ny*side*o;
        wallGfx.poly([
          cx-tx*4-nx*side*13, cy-ty*4-ny*side*13,
          cx+tx*4-nx*side*13, cy+ty*4-ny*side*13,
          cx+tx*4+nx*side*13, cy+ty*4+ny*side*13,
          cx-tx*4+nx*side*13, cy-ty*4+ny*side*13,
        ]).fill({color:0x777d82,alpha:0.85});
      }
    }
    layer.addChild(wallGfx);
  }

  // --- continuous guardrail (mountain preset) -- a ribbon that follows
  // the path exactly, not individually placed sprites. Discrete rail
  // segments left gaps wherever a curve made two neighbours' own
  // collision checks conflict, which is exactly at the hairpins a real
  // rail is most needed; a ribbon can't gap, since it's drawn from the
  // path's own points the same way every other layer here is. `inset` is
  // measured from wallHalf (the player's actual physical limit), not any
  // particular band, since what has to stay clear is the player's own
  // reach, not a fixed surface layer.
  if (P.guardrail && WH != null && OWN) {
    const rail = P.guardrail;
    // At a sector hand-over the rail ends the way a real one does: flared
    // away from the road over its last few metres to a terminal, not cut.
    const FLARE = 8, FLARE_OUT = 46;
    const flare = (k) => {
      if (!S) return 0;
      const o = so(k);
      let d = Infinity;
      if (S.fadeIn) d = Math.min(d, o - ownFrom);
      if (S.fadeOut) d = Math.min(d, ownTo - 1 - o);
      return d < FLARE ? FLARE_OUT * (1 - Math.max(0, d) / FLARE) ** 2 : 0;
    };
    const offset = (k) => WH(k) + rail.inset + flare(k);
    for (const side of [1, -1]) {
      // soft shadow first, wider and darker, so the rail reads as
      // standing proud of the shoulder rather than painted flat onto it
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        ...OWN,
        innerOffset: G((k) => side * (offset(k) - rail.width * 0.8)), outerOffset: G((k) => side * (offset(k) + rail.width * 0.8)),
        tint: 0x000000, alpha: 0.16,
      }));
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        ...OWN,
        innerOffset: G((k) => side * (offset(k) - rail.width / 2)), outerOffset: G((k) => side * (offset(k) + rail.width / 2)),
        tint: rail.tint, alpha: 0.95,
      }));
    }

    // posts: short perpendicular ticks at a regular step, straddling the
    // rail -- same "sample the path's own points/normals directly"
    // technique as the crosswalk bars above.
    const postGfx = new Graphics();
    const postStep = Math.max(1, Math.round(rail.postEvery / path.spacing));
    const hw = rail.postWidth / 2, hl = rail.width * 0.7;
    for (const i of ownIndices(postStep)) {
      const px = path.points[i][0], py = path.points[i][1];
      const nx = path.normals[i * 2], ny = path.normals[i * 2 + 1];
      const tx = -ny, ty = nx;
      for (const side of [1, -1]) {
        const o = Math.abs(guard(i, side * offset(i)));
        const cx = px + nx * side * o, cy = py + ny * side * o;
        postGfx.poly([
          cx - tx * hw - nx * side * hl, cy - ty * hw - ny * side * hl,
          cx + tx * hw - nx * side * hl, cy + ty * hw - ny * side * hl,
          cx + tx * hw + nx * side * hl, cy + ty * hw + ny * side * hl,
          cx - tx * hw + nx * side * hl, cy - ty * hw + ny * side * hl,
        ]).fill({ color: rail.postTint, alpha: 0.9 });
      }
    }

    // Delineator posts: white markers with a reflector on top, set a little
    // outside the rail and spaced much wider than its own posts. On a real
    // pass these are what your headlights pick out through a corner, and
    // from overhead they break up what is otherwise an unvarying white line.
    if (P.delineator) {
      const del = P.delineator;
      const delStep = Math.max(1, Math.round(del.every / path.spacing));
      for (const i of ownIndices(delStep)) {
        const px = path.points[i][0], py = path.points[i][1];
        const nx = path.normals[i * 2], ny = path.normals[i * 2 + 1];
        const tx = -ny, ty = nx;
        for (const side of [1, -1]) {
          const dOff = Math.abs(guard(i, side * (offset(i) + del.out)));
          const cx = px + nx * side * dOff, cy = py + ny * side * dOff;
          postGfx.poly([
            cx - tx * 5 - nx * side * 5, cy - ty * 5 - ny * side * 5,
            cx + tx * 5 - nx * side * 5, cy + ty * 5 - ny * side * 5,
            cx + tx * 5 + nx * side * 20, cy + ty * 5 + ny * side * 20,
            cx - tx * 5 + nx * side * 20, cy - ty * 5 + ny * side * 20,
          ]).fill({ color: del.tint, alpha: 0.95 });
          postGfx.circle(cx + nx * side * 17, cy + ny * side * 17, 6)
            .fill({ color: del.reflector, alpha: 0.95 });
        }
      }
    }

    layer.addChild(postGfx);
  }

  return layer;
}

/** Signed heading change from route index `a` to `b`, radians. */
function turnBetween(path, a, b) {
  let d = path.tangents[b] - path.tangents[a];
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** The furthest anything of preset `P` is drawn from the centreline. */
function outerExtent(P, rh, wh) {
  let e = rh + (P.bands || []).reduce((a, b) => a + b.width, 0);
  // The rail, not the delineators beyond it: they are posts, not a strip,
  // so they cannot fold, and counting them squeezed the rail ~50 further
  // in than it needs to be.
  if (P.guardrail && wh != null) e = Math.max(e, wh + P.guardrail.inset + P.guardrail.width);
  if (P.concreteWalls && wh != null) e = Math.max(e, wh + 42);
  return e;
}

/** Share (0..1) of its width beyond the road edge that preset `P` keeps
 *  where the inside of a bend allows it only out to `lim`. */
function squeezeAt(P, lim, rh, wh) {
  const e = outerExtent(P, rh, wh);
  return e > rh ? Math.max(0, Math.min(1, (lim - rh) / (e - rh))) : 1;
}

/** The barrier of preset `preset` on one side (`lim`: that side's fold
 *  limit) for a visible barrier `vb` on open ground: squeezed exactly as
 *  the drawing is (see buildSurface's `fold`). */
export function squeezedBarrier(preset, lim, rh, wh, vb) {
  const P = SURFACE_PRESETS[preset] || SURFACE_PRESETS.circuit;
  return vb <= rh ? vb : rh + (vb - rh) * squeezeAt(P, lim, rh, wh);
}

/**
 * Per route index, for each side of the road (`pos`: the +normal side,
 * `neg`: the other), how far out anything may be drawn there: where that
 * side is the inside of a bend, the local radius less `keep`, so the
 * innermost thing drawn never runs round a tighter loop than that;
 * elsewhere unlimited. Each side is eased along the route on its own, so a
 * cap never steps and never leaks across to the outside of the same bend.
 * See buildSurface's `fold`.
 */
// keep 80: every stage-5 corner but the pass's hairpins is left exactly as
// drawn (a 520 city junction still clears the 416 its footpath reaches; at
// keep 150 those were being squeezed too), and on the hairpins the rail
// gives up only what it must. The squeezed rail is also a wall the rival
// has to live with, and it runs well inside its own line into a hairpin
// (it steers for where the line will be a dozen points on): at keep 100
// with a long ease it met the inside rail at every hairpin, every lap;
// here it is back to about what it scraped before any of this.
export function foldLimits(path, { keep = 80 } = {}) {
  const n = path.count;
  const W = 3;
  const rawP = new Float32Array(n).fill(1e5);
  const rawN = new Float32Array(n).fill(1e5);
  for (let i = 0; i < n; i++) {
    const a = path.points[path.wrap(i - W)], b = path.points[path.wrap(i + W)], p = path.points[i];
    // towards the centre of curvature, over the same window as the radius
    const cx = a[0] + b[0] - 2 * p[0], cy = a[1] + b[1] - 2 * p[1];
    const along = cx * path.normals[i * 2] + cy * path.normals[i * 2 + 1];
    const d = turnBetween(path, path.wrap(i - W), path.wrap(i + W));
    if (Math.abs(d) < 1e-6) continue;
    const r = Math.max(0, (2 * W * path.spacing) / Math.abs(d) - keep);
    if (along > 0) rawP[i] = r; else rawN[i] = r;
  }
  // Tightest within +/-10 points, then averaged over +/-14 (~360 units):
  // over much less, a hairpin's two legs kept their full roadside right up
  // to the apex and the squeeze all happened at it, which drew the inside
  // as a keyhole -- a narrow neck between the legs opening into a round
  // island; over more, the rail started coming in far enough before the
  // apex to meet the rival there on the way in.
  const ease = (raw) => {
    const Rm = 10, Ra = 14;
    const lo = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = Infinity;
      for (let k = -Rm; k <= Rm; k++) m = Math.min(m, raw[path.wrap(i + k)]);
      lo[i] = m;
    }
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -Ra; k <= Ra; k++) sum += lo[path.wrap(i + k)];
      out[i] = sum / (2 * Ra + 1);
    }
    return out;
  };
  return { pos: ease(rawP), neg: ease(rawN) };
}

/**
 * Per-point "how far does the ground fall away, and on which side".
 *
 * Signed: a positive value means the drop is on the +normal side, negative
 * the other way, and the magnitude (0..1) is how committed the corner is.
 * The drop is always on the OUTSIDE of the bend, because that is where a
 * mountain road is built out on fill; the inside is cut into the hill.
 *
 * Smoothed along the route afterwards so the apron grows and fades with the
 * corner instead of switching on at one point, and so the sign change
 * between two opposite bends passes through zero rather than flipping.
 */
export function outsideDropAmount(path, from = 0.20, full = 0.48) {
  const n = path.count;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let turn = path.tangents[path.wrap(i + 3)] - path.tangents[path.wrap(i - 3)];
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    const amount = Math.max(0, Math.min(1, (path.curvature[i] - from) / (full - from)));
    // outside of the bend is opposite the direction it turns
    raw[i] = -Math.sign(turn) * amount;
  }
  const half = Math.max(1, Math.round(160 / path.spacing));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -half; k <= half; k++) sum += raw[path.wrap(i + k)];
    out[i] = sum / (2 * half + 1);
  }
  return out;
}

/**
 * Visual-only elevated/lower expressway deck.
 * This is deliberately NOT registered with TrackPath, nearest(), race progress,
 * wall collision, or AI. Therefore a bridge may cross the live road at the
 * same XY coordinates without corrupting gameplay. zOrder is controlled by
 * the caller's container ordering.
 */
export function buildVisualHighwayDeck(points, {
  roadHalf=300, wallHalf=355, upper=false,
}={}) {
  const layer=new Container();
  layer.label=upper?'visual-upper-deck':'visual-lower-deck';
  if(!points||points.length<2)return layer;

  function normals(){
    return points.map((p,i)=>{
      const a=points[Math.max(0,i-1)], b=points[Math.min(points.length-1,i+1)];
      const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy)||1;
      return [-dy/L,dx/L];
    });
  }
  const ns=normals();

  // One continuous polygon = no anti-aliased seam at every path sample.
  function continuousStrip(a,b,color,alpha=1){
    const poly=[];
    for(let i=0;i<points.length;i++){
      poly.push(points[i][0]+ns[i][0]*a,points[i][1]+ns[i][1]*a);
    }
    for(let i=points.length-1;i>=0;i--){
      poly.push(points[i][0]+ns[i][0]*b,points[i][1]+ns[i][1]*b);
    }
    const g=new Graphics();
    g.poly(poly).fill({color,alpha});
    layer.addChild(g);
  }

  continuousStrip(-wallHalf-26,wallHalf+26,0x4b5156,1);
  continuousStrip(-roadHalf,roadHalf,0x34383c,1);
  continuousStrip(-roadHalf+14,-roadHalf+25,0xf1f2ef,.92);
  continuousStrip( roadHalf-25, roadHalf-14,0xf1f2ef,.92);

  // Dashed lane separators: isolated short quads, never touching each other,
  // so they cannot create full-width transverse seams.
  const dash=new Graphics();
  for(const o of [-roadHalf/3,roadHalf/3]){
    for(let i=0;i<points.length-1;i+=4){
      const j=Math.min(points.length-1,i+2);
      if(j<=i)continue;
      const p0=points[i],p1=points[j],n0=ns[i],n1=ns[j],w=4;
      dash.poly([
        p0[0]+n0[0]*(o-w),p0[1]+n0[1]*(o-w),
        p1[0]+n1[0]*(o-w),p1[1]+n1[1]*(o-w),
        p1[0]+n1[0]*(o+w),p1[1]+n1[1]*(o+w),
        p0[0]+n0[0]*(o+w),p0[1]+n0[1]*(o+w),
      ]).fill({color:0xe2e3df,alpha:.9});
    }
  }
  layer.addChild(dash);

  continuousStrip(-wallHalf-18,-wallHalf+18,0x555b60,1);
  continuousStrip( wallHalf-18, wallHalf+18,0x555b60,1);
  continuousStrip(-wallHalf-6,-wallHalf+6,0xc2c6c8,1);
  continuousStrip( wallHalf-6, wallHalf+6,0xc2c6c8,1);
  return layer;
}

/** Total lateral extent of the built surface, for prop placement. */
export function surfaceExtent(roadHalf, preset = 'circuit') {
  const P = SURFACE_PRESETS[preset] || SURFACE_PRESETS.circuit;
  return roadHalf + (P.bands || []).reduce((a, b) => a + b.width, 0);
}

/**
 * Where a car meets something a player can actually SEE, measured from the
 * centreline -- the physics barrier (see main.js's buildBarrier). Reads the
 * same preset numbers the drawing code above uses and draws nothing, so the
 * wall is wherever the course already shows one:
 *
 *  - concrete crash walls (highway presets): wallHalf itself, which is
 *    what those walls were always drawn against (base at wallHalf - 3).
 *  - a guardrail ribbon (mountain presets): the rail's own inner face,
 *    wallHalf + inset - width / 2.
 *  - anything else (circuit / city): no barrier is drawn at all, so the
 *    edge of the drawn run-off -- the gravel trap's outer edge, the
 *    building line -- is the first thing there is to hit.
 */
export function visibleBarrierHalf(roadHalf, wallHalf, preset = 'circuit') {
  const P = SURFACE_PRESETS[preset] || SURFACE_PRESETS.circuit;
  if (P.concreteWalls) return wallHalf;
  if (P.guardrail) return wallHalf + P.guardrail.inset - P.guardrail.width / 2;
  return surfaceExtent(roadHalf, preset);
}

/**
 * Per-point elevation (0..1) derived from TrackPath's own deck/zLevel route
 * metadata: zLevel 0 is ground, zLevel 1 is a ramp run (ascending or
 * descending), zLevel >=2 is the upper deck. Ramp runs are not authored with
 * their own height -- only which end they climb from/to -- so their height is
 * interpolated here from the ground/deck values on either side of the run.
 * This makes no assumption about where a stage's ramps sit or how many there
 * are; it only reads the zLevels array set by setLayerRange().
 */
export function computeElevationProfile(path) {
  const n = path.count;
  const height = new Float32Array(n);
  const known = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const z = path.zLevels[i];
    if (z <= 0) { height[i] = 0; known[i] = 1; }
    else if (z >= 2) { height[i] = 1; known[i] = 1; }
  }
  let i = 0;
  while (i < n) {
    if (known[i]) { i++; continue; }
    let j = i;
    while (j < n && !known[j]) j++;
    const before = known[(i - 1 + n) % n] ? height[(i - 1 + n) % n] : 0;
    const after = known[j % n] ? height[j % n] : 0;
    const len = j - i;
    for (let k = i; k < j; k++) {
      const t = (k - i + 1) / (len + 1);
      height[k] = before + (after - before) * t;
    }
    i = j;
  }
  return height;
}

/**
 * Structure-based ramp reveal, riding directly on the live route (unlike
 * buildVisualHighwayDeck, which paints a separate fixed overpass). As the
 * route's own elevation climbs from 0 to 1, a retaining wall grows out of
 * the shoulder, a girder fascia appears just outside it, and the cast
 * shadow slides further out from the road -- all by shrinking their width
 * to zero at height 0, never by an per-point alpha (ribbon meshes only take
 * a single alpha for the whole strip). At height 0 every band collapses to
 * a zero-width strip, i.e. nothing is drawn, so a stage whose path never
 * leaves the ground (height all zero) adds nothing here.
 *
 * Deliberately NOT registered with nearest(), wall collision, AI, or race
 * progress -- purely a visual reveal of the logical deck the player is
 * already on, same non-gameplay footing as buildVisualHighwayDeck.
 */
export function buildRampStructure(path, { wallHalf: wallHalfOpt = 355 } = {}) {
  // `wallHalf` may vary along the route (a stage whose road widens).
  const WH = typeof wallHalfOpt === 'function' ? wallHalfOpt : () => wallHalfOpt;
  const layer = new Container();
  layer.label = 'ramp-structure';
  const height = computeElevationProfile(path);
  let any = false;
  for (let i = 0; i < height.length; i++) { if (height[i] > 0.001) { any = true; break; } }
  if (!any) return layer;

  const wallReach = 55;   // retaining wall's max outward thickness at full height
  const girderReach = 46; // fascia band's max outward thickness at full height
  const girderGap = 8;    // gap between wall and fascia
  const shadowNear = 14;  // shadow inner edge distance from wallHalf at height 0
  const shadowFar = 78;   // extra outward slide of the shadow at full height
  const shadowWidth = 60; // shadow band width (scales with height like the rest)

  // Only the stretches that actually have height; elsewhere these ribbons
  // were zero-width but still cost a vertex pair per point of the lap.
  const runs = activeRuns(path, (i) => height[i] > 0.001) ?? [[0, path.count]];

  for (const side of [1, -1]) for (const [from, span] of runs) {
    const range = { fromIndex: from, spanIndices: span };
    // cast shadow: slides outward and widens as the deck climbs, reading as
    // the structure lifting away from the ground plane underneath it.
    layer.addChild(ribbonMesh(path, Texture.WHITE, {
      innerOffset: (k) => side * (WH(k) + shadowNear + height[k] * shadowFar),
      outerOffset: (k) => side * (WH(k) + shadowNear + height[k] * (shadowFar + shadowWidth)),
      tint: 0x020304, alpha: 0.78, ...range,
    }));

    // retaining wall: dark base then a bright concrete cap, both widening
    // from zero as height rises -- this alone reads as "climbing" even
    // before the girder fascia appears. wallHalf+8 sits inside the highway
    // preset's own pavement band (tint 0x73777a out to roadHalf+104), so a
    // subtle grey here reads as almost no change at all -- tints are pushed
    // to near-white/near-black, well outside that band's own tonal range,
    // specifically to read against it (confirmed against a temporary
    // bright-colour pass, which showed the geometry itself was always
    // correct -- only the tint contrast was insufficient).
    layer.addChild(ribbonMesh(path, Texture.WHITE, {
      innerOffset: (k) => side * (WH(k) + 8),
      outerOffset: (k) => side * (WH(k) + 8 + height[k] * wallReach),
      tint: 0x767d84, alpha: 1, ...range,
    }));
    layer.addChild(ribbonMesh(path, Texture.WHITE, {
      innerOffset: (k) => side * (WH(k) + 8),
      outerOffset: (k) => side * (WH(k) + 8 + height[k] * wallReach * 0.42),
      tint: 0xf0f2f2, alpha: 1, ...range,
    }));

    // girder fascia: a second, darker band just outside the wall, only
    // reaching its full thickness once the deck is fully elevated --
    // together with the wall this is what makes the upper deck read as a
    // constructed bridge rather than a wide road. Kept far darker than the
    // ground tint (not just a shade off it) for the same visibility reason
    // as the wall base above.
    layer.addChild(ribbonMesh(path, Texture.WHITE, {
      innerOffset: (k) => side * (WH(k) + 8 + height[k] * (wallReach + girderGap)),
      outerOffset: (k) => side * (WH(k) + 8 + height[k] * (wallReach + girderGap + girderReach)),
      tint: 0x0e1012, alpha: 1, ...range,
    }));
  }

  // Rectangular piers at a regular interval, only where the deck is
  // substantially elevated (height > 0.5) -- a ramp mid-climb doesn't need
  // its own support shown yet, but a long upper-deck run reads as an
  // unsupported floating road without them. Offset sits just outside the
  // girder fascia so a pier never overlaps the bridge structure above it.
  // Each pier fades in with the same height value used everywhere else
  // above (no per-vertex alpha on a Graphics fill, so it is baked in per
  // pier instead of interpolated along its own length -- piers are discrete
  // objects, not a continuous ribbon, so this reads the same either way).
  const pierGfx = new Graphics();
  const pierExtra = 8 + wallReach + girderGap + girderReach + 42;
  const pierStep = Math.max(1, Math.round(260 / path.spacing));
  const pierHalfW = 30, pierHalfL = 46;
  for (let i = 0; i < path.count; i += pierStep) {
    if (height[i] < 0.5) continue;
    const alpha = Math.min(1, (height[i] - 0.5) * 2); // fades in over the back half of the climb
    const px = path.points[i][0], py = path.points[i][1];
    const nx = path.normals[i * 2], ny = path.normals[i * 2 + 1];
    const tx = -ny, ty = nx;
    for (const side of [1, -1]) {
      const pierOffset = WH(i) + pierExtra;
      const cx = px + nx * side * pierOffset, cy = py + ny * side * pierOffset;
      // cast shadow, offset toward the road so the pier reads as standing
      // proud of the ground rather than painted flat onto it
      pierGfx.poly([
        cx - tx * pierHalfW - nx * side * pierHalfL + 10, cy - ty * pierHalfW - ny * side * pierHalfL + 14,
        cx + tx * pierHalfW - nx * side * pierHalfL + 10, cy + ty * pierHalfW - ny * side * pierHalfL + 14,
        cx + tx * pierHalfW + nx * side * pierHalfL + 10, cy + ty * pierHalfW + ny * side * pierHalfL + 14,
        cx - tx * pierHalfW + nx * side * pierHalfL + 10, cy - ty * pierHalfW + ny * side * pierHalfL + 14,
      ]).fill({ color: 0x05080a, alpha: alpha * 0.32 });
      // dark base
      pierGfx.poly([
        cx - tx * pierHalfW - nx * side * pierHalfL, cy - ty * pierHalfW - ny * side * pierHalfL,
        cx + tx * pierHalfW - nx * side * pierHalfL, cy + ty * pierHalfW - ny * side * pierHalfL,
        cx + tx * pierHalfW + nx * side * pierHalfL, cy + ty * pierHalfW + ny * side * pierHalfL,
        cx - tx * pierHalfW + nx * side * pierHalfL, cy - ty * pierHalfW + ny * side * pierHalfL,
      ]).fill({ color: 0x6f757a, alpha });
      // brighter face, inset, for a readable top-down sense of a rectangular column
      const iw = pierHalfW * 0.7, il = pierHalfL * 0.72;
      pierGfx.poly([
        cx - tx * iw - nx * side * il, cy - ty * iw - ny * side * il,
        cx + tx * iw - nx * side * il, cy + ty * iw - ny * side * il,
        cx + tx * iw + nx * side * il, cy + ty * iw + ny * side * il,
        cx - tx * iw + nx * side * il, cy - ty * iw + ny * side * il,
      ]).fill({ color: 0xa9aeb1, alpha });
    }
  }
  layer.addChild(pierGfx);

  return layer;
}

/**
 * Redraws just the fully-elevated stretches of road, on top of everything
 * already laid down at ground level.
 *
 * This is what makes a grade separation actually read as one. buildSurface()
 * lays the entire route down as single full-loop ribbons, so where the
 * course crosses over itself both passes live in the same meshes and
 * whichever triangles happen to come later win -- the bridge and the road
 * under it interleave. Re-laying the raised run afterwards puts it
 * unambiguously above the stretch it spans.
 *
 * Only the road surface itself (asphalt, wear, edge shading, paint, lane
 * markings). The raised deck's walls, girder fascia, piers and cast shadow
 * are buildRampStructure's job and are drawn after this, so they frame the
 * deck rather than being buried under it.
 *
 * Ramp runs (zLevel 1) are deliberately NOT redrawn: a ramp is mid-climb and
 * should blend into the ground surface it is rising out of, otherwise its
 * start reads as a step rather than a slope.
 */
/**
 * Contiguous [from, span] runs where `active(i)` holds, padded by `pad`
 * points at each end and merged if the padding makes them touch.
 *
 * Structures that only exist along part of the route (ramp walls, tunnel
 * walls, the raised deck) used to be drawn as full-loop ribbons whose width
 * collapsed to zero everywhere they were absent. That renders correctly but
 * pays for a vertex pair at every point of the entire lap for a structure
 * covering a fraction of it -- on the 3455-point course, the tunnel's four
 * wall ribbons alone carried ~27k vertices to show 5% of a lap. Restricting
 * each ribbon to the span it actually occupies is the same picture for a
 * fraction of the geometry.
 *
 * The padding matters: a run's ribbon still has to start and end at zero
 * width, or the structure begins with a visible step instead of growing out
 * of the shoulder.
 */
function activeRuns(path, active, pad = 2) {
  const n = path.count;
  const raw = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    const on = active(i);
    if (on && start < 0) start = i;
    else if (!on && start >= 0) { raw.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) raw.push([start, n - 1]);
  if (!raw.length) return [];

  // pad, clamp to the loop, then merge anything that now overlaps
  const padded = raw.map(([a, b]) => [Math.max(0, a - pad), Math.min(n - 1, b + pad)]);
  const merged = [padded[0]];
  for (let i = 1; i < padded.length; i++) {
    const last = merged[merged.length - 1];
    if (padded[i][0] <= last[1] + 1) last[1] = Math.max(last[1], padded[i][1]);
    else merged.push(padded[i]);
  }
  // a run covering effectively the whole loop is better drawn as a full loop
  if (merged.length === 1 && merged[0][0] === 0 && merged[0][1] >= n - 2) return null;
  return merged.map(([a, b]) => [a, b - a + 1]);
}

export function elevatedRuns(path) {
  const runs = activeRuns(path, (i) => path.zLevels[i] >= 2, 0);
  return runs === null ? [[0, path.count]] : runs;
}

/**
 * Cut one index range into consecutive pieces that are each wholly on the
 * raised deck or wholly on the ground, as `[fromIndex, spanIndices, up]`.
 *
 * This is what lets a grade separation actually read as one: the raised
 * pieces are built into a container of their own that fades while the
 * player drives underneath, and because the road there exists ONLY in that
 * container there is nothing opaque left behind when it does. Building the
 * whole route in one pass and re-laying the deck over it cannot work --
 * the first pass's copy of the deck does not fade, so the bridge stays
 * solid however far the overlay is taken down.
 *
 * Pieces meet on a shared index rather than an index apart, because a
 * ribbon of span n spans point `from` to `from + n` inclusive; abutting
 * them anywhere else leaves a one-quad hole along the join.
 */
export function deckRuns(path, fromIndex, spanIndices) {
  const up = (o) => path.zLevels[path.wrap(fromIndex + o)] >= 2;
  const out = [];
  let start = 0;
  let cur = up(0);
  for (let o = 1; o < spanIndices; o++) {
    if (up(o) === cur) continue;
    out.push([path.wrap(fromIndex + start), o - start, cur]);
    start = o;
    cur = !cur;
  }
  out.push([path.wrap(fromIndex + start), spanIndices - start, cur]);
  return out;
}

/**
 * The elevated deck's cast shadow, as its own layer so it can sit on the
 * ground surface while the deck road itself (which fades when the player
 * drives underneath -- see main.js) is drawn separately above it.
 *
 * At the crossing this is what darkens the ground-level road passing
 * beneath; without it the bridge reads as painted onto the road it is
 * supposed to span. Slightly wider than the carriageway so a sliver shows
 * past the deck edge, which is what makes the deck stand off the ground
 * rather than lie on it. buildRampStructure's own cast shadow sits further
 * out still (from wallHalf outward, about the deck lifting away from the
 * shoulder), so the two do not overlap.
 */
export function buildElevatedDeckShadow(path, { roadHalf = 360 } = {}) {
  const layer = new Container();
  layer.label = 'elevated-deck-shadow';
  const RH = typeof roadHalf === 'function' ? roadHalf : () => roadHalf;
  for (const [from, span] of elevatedRuns(path)) {
    layer.addChild(ribbonMesh(path, Texture.WHITE, {
      innerOffset: (k) => -(RH(k) + 46), outerOffset: (k) => RH(k) + 46,
      tint: 0x04060a, alpha: 0.55, fromIndex: from, spanIndices: span,
    }));
  }
  return layer;
}

/**
 * Per-point tunnel "depth" (0..1), derived from TrackPath's own tunnelFlags:
 * ramps up from 0 over `fadeDist` world units at the start of each tunnel
 * run, holds at 1 through the middle, ramps back down to 0 over the same
 * distance at the end. A run shorter than 2*fadeDist never reaches full
 * depth, which reads correctly as a short tunnel rather than a jump cut.
 * Independent of computeElevationProfile -- a tunnel can sit anywhere a
 * stage marks one, ground-level or elevated.
 */
export function computeTunnelDepth(path, fadeDist = 220) {
  const n = path.count;
  const depth = new Float32Array(n);
  const fadeSteps = Math.max(1, fadeDist / path.spacing);

  let i = 0;
  while (i < n) {
    if (!path.tunnelFlags[i]) { i++; continue; }
    let j = i;
    while (j < n && path.tunnelFlags[j]) j++;
    // run is [i, j). Handle a run that wraps past index n-1 back to 0 by
    // just treating it as ending at the array boundary -- stages are
    // expected to keep a tunnel's start/end away from index 0 (the
    // start/finish line), so this edge case does not occur in practice.
    const runLen = j - i;
    for (let k = i; k < j; k++) {
      const fromStart = k - i;
      const fromEnd = j - 1 - k;
      depth[k] = Math.min(1, fromStart / fadeSteps, fromEnd / fadeSteps, runLen / fadeSteps);
    }
    i = j;
  }
  return depth;
}

/**
 * Tunnel treatment: darkens the road, raises solid side walls and adds
 * ceiling-light points, purely as a visual read of an existing stretch of
 * route -- not a different road, not registered with nearest()/collision/
 * AI/race progress (same footing as buildRampStructure/
 * buildVisualHighwayDeck). Fades in/out with computeTunnelDepth so there is
 * no hard cut at the tunnel mouth.
 *
 * The dark overlay and light points are drawn as discrete quads/circles
 * rather than a ribbon, since ribbonMesh only takes one alpha for its whole
 * strip -- a per-point fade needs per-segment alpha, which only a Graphics
 * fill can give here.
 */
export function buildTunnelStructure(path, { roadHalf = 300, wallHalf = 355 } = {}) {
  const layer = new Container();
  layer.label = 'tunnel';
  const depth = computeTunnelDepth(path);
  const runs = activeRuns(path, (i) => depth[i] > 0.001);
  // no tunnel on this stage at all, or (null) one covering the whole loop
  if (runs !== null && runs.length === 0) return layer;
  const spans = runs ?? [[0, path.count]];

  const wallReach = 30;

  // side walls: solid, well-lit concrete, widening from zero with depth --
  // same zero-width-when-absent trick as buildRampStructure. Drawn only
  // over the spans the tunnel actually occupies; a full-loop ribbon here
  // spent ~6900 vertices per side to show a few per cent of a lap.
  for (const side of [1, -1]) for (const [from, span] of spans) {
    const range = { fromIndex: from, spanIndices: span };
    layer.addChild(ribbonMesh(path, Texture.WHITE, {
      innerOffset: side * (roadHalf + 6),
      outerOffset: (k) => side * (roadHalf + 6 + depth[k] * wallReach),
      tint: 0x54585c, alpha: 1, ...range,
    }));
    layer.addChild(ribbonMesh(path, Texture.WHITE, {
      innerOffset: side * (roadHalf + 6),
      outerOffset: (k) => side * (roadHalf + 6 + depth[k] * wallReach * 0.3),
      tint: 0x2b2e31, alpha: 1, ...range,
    }));
  }

  // dark overlay across the full carriageway width, opacity following
  // depth -- fine-grained quads (not the ribbon's single alpha) so the
  // mouth fades smoothly rather than cutting hard.
  const overlay = new Graphics();
  const overlayStep = Math.max(1, Math.round(40 / path.spacing));
  const overlayHalf = wallHalf + wallReach + 20;
  for (const [from, span] of spans) for (let i = from; i < from + span; i += overlayStep) {
    if (depth[i] < 0.02) continue;
    const j = Math.min(path.count - 1, i + overlayStep);
    const a = path.points[i], b = path.points[j];
    const an = [path.normals[i * 2], path.normals[i * 2 + 1]];
    const bn = [path.normals[j * 2], path.normals[j * 2 + 1]];
    overlay.poly([
      a[0] - an[0] * overlayHalf, a[1] - an[1] * overlayHalf,
      b[0] - bn[0] * overlayHalf, b[1] - bn[1] * overlayHalf,
      b[0] + bn[0] * overlayHalf, b[1] + bn[1] * overlayHalf,
      a[0] + an[0] * overlayHalf, a[1] + an[1] * overlayHalf,
    ]).fill({ color: 0x05060a, alpha: depth[i] * 0.72 });
  }
  layer.addChild(overlay);

  // ceiling lights: evenly spaced points down the centreline, only where
  // the tunnel is substantially dark (depth > 0.6) so they never appear to
  // float at the mouth before the walls/overlay have caught up.
  const lights = new Graphics();
  const lightStep = Math.max(1, Math.round(140 / path.spacing));
  for (const [from, span] of spans) for (let i = from; i < from + span; i += lightStep) {
    if (depth[i] < 0.6) continue;
    const p = path.points[i];
    const a = Math.min(1, (depth[i] - 0.6) / 0.4);
    lights.circle(p[0], p[1], 14).fill({ color: 0xfff3c4, alpha: a * 0.85 });
    lights.circle(p[0], p[1], 30).fill({ color: 0xfff3c4, alpha: a * 0.22 });
  }
  layer.addChild(lights);

  return layer;
}


/**
 * A zebra crossing painted across the road at one centreline index.
 *
 * The stripes run WITH the traffic, side by side across the road -- the
 * way a pedestrian crossing is painted. They used to be drawn as bars
 * lying across the carriageway, stacked along it, which from above is a
 * ladder of stop lines rather than a crossing.
 *
 * `stop: 'approach'` adds the driver's stop line, behind the crossing on
 * the left-hand lane (traffic keeps left; the path's +normal is the
 * driver's RIGHT).
 */
function paintCrossing(g, path, k, half, { depth = 240, stripe = 30, gap = 30, stop = null } = {}) {
  const nx = path.normals[k * 2], ny = path.normals[k * 2 + 1];
  const tx = -ny, ty = nx;
  const cx = path.points[k][0], cy = path.points[k][1];
  // a quad from lateral l0..l1 and along a0..a1
  const quad = (l0, l1, a0, a1, alpha) => g.poly([
    cx + nx * l0 + tx * a0, cy + ny * l0 + ty * a0,
    cx + nx * l1 + tx * a0, cy + ny * l1 + ty * a0,
    cx + nx * l1 + tx * a1, cy + ny * l1 + ty * a1,
    cx + nx * l0 + tx * a1, cy + ny * l0 + ty * a1,
  ]).fill({ color: 0xffffff, alpha });
  const n = Math.max(1, Math.floor((2 * half + gap) / (stripe + gap)));
  const span = n * stripe + (n - 1) * gap;
  for (let i = 0; i < n; i++) {
    const l0 = -span / 2 + i * (stripe + gap);
    quad(l0, l0 + stripe, -depth / 2, depth / 2, 0.88);
  }
  const back = depth / 2 + 70;
  // Only ever the driver's own, BEFORE the crossing. The oncoming lane's
  // (beyond the crossing, on the right) is where a real one is, but from
  // this seat it reads as a stop line on the far side of the zebra.
  if (stop === 'approach') quad(-half, -4, -back - 22, -back, 0.9);
}

/**
 * Start and end index of every sustained turn on the path, as [enter, exit]
 * pairs. A "corner" is a run of points whose curvature stays above
 * `threshold`; short flickers between two straights are ignored.
 */
export function cornerRuns(path, threshold = 0.16, minLength = 300) {
  const n = path.count;
  const runs = [];
  let start = -1;
  // begin the scan on a straight so one corner is never split at the seam
  let from = 0;
  for (let i = 0; i < n; i++) if (path.curvature[i] < threshold) { from = i; break; }
  for (let o = 0; o < n; o++) {
    const i = path.wrap(from + o);
    const on = path.curvature[i] >= threshold;
    if (on && start < 0) start = o;
    else if (!on && start >= 0) {
      if ((o - start) * path.spacing >= minLength) runs.push([path.wrap(from + start), path.wrap(from + o - 1)]);
      start = -1;
    }
  }
  if (start >= 0 && (n - start) * path.spacing >= minLength) runs.push([path.wrap(from + start), path.wrap(from + n - 1)]);
  return runs;
}

/**
 * A traffic signal on a cantilever arm over the carriageway, beside a
 * crossing. Drawn rather than placed as a prop because it belongs to the
 * junction, and the junctions are found from the path's own curvature --
 * there is no lap fraction to hang a prop on that would survive the course
 * being regenerated.
 *
 * On an arm, not on the shoulder. A post standing at the kerb has to sit
 * past the player's reach or it reads as something the car drives through
 * -- and at that distance it falls outside the visible half-width at the
 * player's own row, so the first version of this was invisible in play.
 * Reaching the head out over the road is both what a real signal at a
 * Japanese junction does and the only way it is actually in shot.
 *
 * Which is why it is split in two. The head hangs over the carriageway, so
 * painting it into the road layer put it UNDER the cars and the car drove
 * over the signal -- from directly above, the one thing that reads as is a
 * lamp lying in the road. `paintSignalOverhead` goes into the surface's
 * `overhead` container, which main.js parents above the actors, so the car
 * passes beneath the head exactly as it would in life; `paintSignalShadow`
 * stays down on the road, and the offset between the two is what gives the
 * gantry its height.
 */
const SIGNAL_LAMPS = [[-32, 0xd9463c], [0, 0xe0a83a], [32, 0x35b45f]];

/** Local frame at centreline index `k`: (lateral, along) -> world. */
function signalFrame(path, k) {
  const nx = path.normals[k * 2], ny = path.normals[k * 2 + 1];
  const tx = -ny, ty = nx;
  const cx = path.points[k][0], cy = path.points[k][1];
  return (lat, along) => [cx + nx * lat + tx * along, cy + ny * lat + ty * along];
}

function signalQuad(g, at, lat0, lat1, a0, a1, colour, alpha) {
  const p0 = at(lat0, a0), p1 = at(lat1, a0), p2 = at(lat1, a1), p3 = at(lat0, a1);
  g.poly([p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]]).fill({ color: colour, alpha });
}

/** The gantry's shadow on the road, offset from the structure itself. */
function paintSignalShadow(g, path, k, out, reach) {
  const at = signalFrame(path, k);
  const dLat = -46 * Math.sign(out), dAlong = 34;   // offset of the shadow from the structure
  const q = (l0, l1, a0, a1, alpha) =>
    signalQuad(g, at, l0 + dLat, l1 + dLat, a0 + dAlong, a1 + dAlong, 0x0a0d10, alpha);
  q(out - 16, out + 16, -16, 16, 0.22);
  q(reach, out, -9, 9, 0.18);
  q(reach - 18, reach + 18, -56, 56, 0.26);
}

/** The gantry itself: post, arm and lamp head, all of it above the cars. */
function paintSignalOverhead(g, path, k, out, reach) {
  const at = signalFrame(path, k);
  const q = (l0, l1, a0, a1, colour, alpha) => signalQuad(g, at, l0, l1, a0, a1, colour, alpha);
  // post at the back of the pavement, then the arm reaching in over the road
  q(out - 16, out + 16, -16, 16, 0x33383d, 0.95);
  q(reach, out, -7, 7, 0x3a3f45, 0.92);
  // head, across the arm's inner end, with three lamps down it
  q(reach - 16, reach + 16, -52, 52, 0x23262a, 0.96);
  for (const [off, colour] of SIGNAL_LAMPS) {
    const c = at(reach, off);
    g.circle(c[0], c[1], 11).fill({ color: colour, alpha: 0.92 });
  }
  // green lit, so the junction reads as live rather than as a model of one
  const lit = at(reach, 32);
  g.circle(lit[0], lit[1], 22).fill({ color: 0x35b45f, alpha: 0.2 });
}
