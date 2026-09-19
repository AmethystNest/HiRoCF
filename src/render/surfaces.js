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
    groundTint: 0x767c84,
    asphalt: { texture: 'road_asphalt', uRepeat: 3, vPer: 1 / 520, tint: 0xb2b6bc },
    ruts: { offset: 82, width: 74, alpha: 0.32, vPer: 1 / 900 },
    edgeLine: { inset: 14, width: 11, tint: 0xffffff, alpha: 0.85 },
    centreLine: { texture: 'dash_yellow', width: 11, vPer: 1 / 120 },
    paintStart: false, // an ordinary street has no painted chequer
    startMarker: 'crosswalk', // ...it gets a crosswalk instead, see buildSurface
    // no racing kerb -- just a plain gutter strip into the sidewalk, the
    // way an actual public road meets its pavement. Pavement is kept wide
    // (230, up from a first pass at 150) so kerbside decoration -- cones,
    // parked cars, fences -- has room to sit clear of wallHalf without
    // spilling off the paved surface into the dirt.
    bands: [
      { texture: null, width: 18, tint: 0x6b7075, alpha: 0.9 },      // gutter
      { texture: null, width: 230, tint: 0x8b9198, alpha: 0.95 },    // pavement / sidewalk
    ],
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
    cutSlope: { crest: 34, tint: 0xb5ab9c, alpha: 0.8 },
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

};

/**
 * @param {TrackPath} path
 * @param {object} tex loaded texture map keyed by base name
 * @param {object} cfg { roadHalf, wallHalf, preset }
 */
export function buildSurface(path, tex, { roadHalf, wallHalf, preset = 'circuit' }) {
  const P = SURFACE_PRESETS[preset] || SURFACE_PRESETS.circuit;
  const layer = new Container();
  layer.label = 'surface';

  // --- ground: one world-space tiling plane covering the track bounds ---
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of path.points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const pad = roadHalf + 3200;
  const ground = new TilingSprite({
    texture: tex[P.ground],
    width: (maxX - minX) + pad * 2,
    height: (maxY - minY) + pad * 2,
  });
  ground.position.set(minX - pad, minY - pad);
  ground.tileScale.set(P.groundScale ?? 1.6);
  if (P.groundTint) ground.tint = P.groundTint;
  layer.addChild(ground);

  // --- elevated expressway under-deck / cast shadow ---
  // Oversized dark ribbons underneath the asphalt make the road read as a
  // raised concrete deck instead of paint sitting directly on the ground.
  if (P.elevatedDeck) {
    for (const side of [1, -1]) {
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        innerOffset: side * (roadHalf + 18),
        outerOffset: side * (roadHalf + 155),
        tint: 0x111820, alpha: 0.42,
      }));
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        innerOffset: side * (roadHalf + 6),
        outerOffset: side * (roadHalf + 92),
        tint: 0x3d4247, alpha: 0.98,
      }));
    }
  }

  // --- main asphalt ---
  layer.addChild(ribbonMesh(path, tex[P.asphalt.texture], {
    innerOffset: -roadHalf, outerOffset: roadHalf,
    uInner: 0, uOuter: P.asphalt.uRepeat, vPerWorldUnit: P.asphalt.vPer,
    tint: P.asphalt.tint,
  }));

  // --- wear: two wheel tracks polished into the surface ---
  if (P.ruts) {
    for (const off of [-P.ruts.offset, P.ruts.offset]) {
      layer.addChild(ribbonMesh(path, tex.rut_overlay, {
        innerOffset: off - P.ruts.width / 2, outerOffset: off + P.ruts.width / 2,
        uInner: 0, uOuter: 1, vPerWorldUnit: P.ruts.vPer, alpha: P.ruts.alpha,
      }));
    }
  }

  // --- contact shading on the asphalt beside the boundary ---
  for (const side of [1, -1]) {
    layer.addChild(ribbonMesh(path, tex.edge_shadow, {
      innerOffset: side * roadHalf, outerOffset: side * (roadHalf - 110),
      uInner: 0, uOuter: 1, vPerWorldUnit: 1 / 2048, alpha: 0.9,
    }));
  }

  // --- painted edge lines ---
  if (P.edgeLine) {
    for (const side of [1, -1]) {
      const inner = side * (roadHalf - P.edgeLine.inset);
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        innerOffset: inner, outerOffset: inner - side * P.edgeLine.width,
        tint: P.edgeLine.tint, alpha: P.edgeLine.alpha,
      }));
    }
  }

  // --- dashed centre line (public-road stages) ---
  if (P.centreLine) {
    const cl = P.centreLine;
    layer.addChild(ribbonMesh(path, cl.texture ? tex[cl.texture] : Texture.WHITE, {
      innerOffset: -cl.width / 2, outerOffset: cl.width / 2,
      uInner: 0, uOuter: 1, vPerWorldUnit: cl.vPer ?? 1 / 1024,
      tint: cl.tint, alpha: cl.alpha ?? 0.92,
    }));
  }


  // --- metropolitan expressway lane markings ---
  // Three usable lanes: two dashed white separators at ±1/3 road width.
  if (P.highwayLanes) {
    for (const off of [-roadHalf / 3, roadHalf / 3]) {
      layer.addChild(ribbonMesh(path, tex.dash_white, {
        innerOffset: off - 6, outerOffset: off + 6,
        uInner: 0, uOuter: 1, vPerWorldUnit: 1 / 165, alpha: 0.94,
      }));
    }
  }

  // --- start / finish chequer, painted across the road -- a racing-circuit
  // convention; ordinary street stages opt out (preset.paintStart: false)
  // since a public road has no painted start line ---
  if (P.paintStart !== false) {
    const startSpan = 3;
    layer.addChild(ribbonMesh(path, tex.checker, {
      innerOffset: -roadHalf, outerOffset: roadHalf,
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
  if (P.startMarker === 'crosswalk') {
    const nx = path.normals[0], ny = path.normals[1];
    const tx = -ny, ty = nx;
    const cx0 = path.points[0][0], cy0 = path.points[0][1];
    const half = roadHalf - (P.edgeLine?.inset ?? 14) - 4;
    const barLen = 50, gap = 40, bars = 6;
    const span = bars * barLen + (bars - 1) * gap;
    const g = new Graphics();
    for (let i = 0; i < bars; i++) {
      const d0 = -span / 2 + i * (barLen + gap);
      const d1 = d0 + barLen;
      const p0x = cx0 + tx * d0, p0y = cy0 + ty * d0;
      const p1x = cx0 + tx * d1, p1y = cy0 + ty * d1;
      g.poly([
        p0x - nx * half, p0y - ny * half,
        p0x + nx * half, p0y + ny * half,
        p1x + nx * half, p1y + ny * half,
        p1x - nx * half, p1y - ny * half,
      ]).fill({ color: 0xffffff, alpha: 0.88 });
    }
    layer.addChild(g);
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
  if (P.startMarker === 'gate' && wallHalf != null) {
    const nx = path.normals[0], ny = path.normals[1];
    const tx = -ny, ty = nx;
    const cx0 = path.points[0][0], cy0 = path.points[0][1];
    const g = new Graphics();

    // the line itself: a wide band, plus a thin bright leading edge so it
    // still registers when crossed at full speed
    const band = (from, to, color, alpha) => {
      g.poly([
        cx0 + tx * from - nx * roadHalf, cy0 + ty * from - ny * roadHalf,
        cx0 + tx * to - nx * roadHalf, cy0 + ty * to - ny * roadHalf,
        cx0 + tx * to + nx * roadHalf, cy0 + ty * to + ny * roadHalf,
        cx0 + tx * from + nx * roadHalf, cy0 + ty * from + ny * roadHalf,
      ]).fill({ color, alpha });
    };
    band(-70, 70, 0xf2f4f5, 0.96);
    band(-92, -70, 0xffd34d, 0.9);
    band(70, 92, 0xffd34d, 0.9);

    // lit pylons just outside the barrier on both shoulders
    for (const side of [1, -1]) {
      const px = cx0 + nx * side * (wallHalf + 55);
      const py = cy0 + ny * side * (wallHalf + 55);
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
    layer.addChild(g);
  }

  // --- boundary bands last, outermost first.
  // They must sit ON TOP of the asphalt: each band's inner edge carries a
  // semi-transparent contact shadow that has to fall on the road surface,
  // not on whatever is underneath it.
  // Every band starts back at the road edge rather than where the previous
  // one ended, so each is fully backed by the one under it. Materials with
  // transparent zones (the kerb's contact and cast shadows) then land on a
  // real surface instead of letting the ground show through.
  const bounds = [];
  let cursor = roadHalf;
  for (const band of P.bands || []) {
    cursor += band.width;
    bounds.push({ band, to: cursor });
  }
  for (let i = bounds.length - 1; i >= 0; i--) {
    const { band, to } = bounds[i];
    for (const side of [1, -1]) {
      layer.addChild(ribbonMesh(path, band.texture ? tex[band.texture] : Texture.WHITE, {
        innerOffset: side * (roadHalf - OVERLAP),
        outerOffset: side * to,
        uInner: 0,
        uOuter: band.uRepeat ?? 1,
        vPerWorldUnit: band.vPer ?? 1 / 1024,
        alpha: band.alpha,
        tint: band.tint,
      }));
    }
  }


  // --- mountain cut slope: a lit crest along the top of the rock band ---
  if (P.cutSlope) {
    const outer = roadHalf + (P.bands || []).reduce((a, b) => a + b.width, 0);
    for (const side of [1, -1]) {
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        innerOffset: side * (outer - P.cutSlope.crest),
        outerOffset: side * outer,
        tint: P.cutSlope.tint, alpha: P.cutSlope.alpha,
      }));
    }
  }

  // --- the land falling away on the outside of a switchback ---
  // Only on the outside, only where the road is actually turning hard, and
  // faded in by how hard: a hairpin is built out on fill, so that is the
  // side that drops. Drawn beyond the guardrail (which goes in below), so
  // the rail reads as standing at the lip of it.
  if (P.valleyDrop && wallHalf != null) {
    const vd = P.valleyDrop;
    const drop = outsideDropAmount(path, vd.from, vd.full);
    const start = wallHalf + 66;
    for (const side of [1, -1]) {
      const width = (k) => Math.max(0, side * drop[k]) * vd.reach;
      // A flat dark band just reads as a shadow. edge_shadow is a gradient
      // ACROSS the strip, so used from the lip outward it goes from deep
      // shade at the road's edge to nothing further out -- which is what
      // ground falling away from under you looks like from above.
      layer.addChild(ribbonMesh(path, tex.edge_shadow, {
        innerOffset: (k) => side * (start + width(k) * 0.05),
        outerOffset: (k) => side * (start + width(k)),
        uInner: 0, uOuter: 1, vPerWorldUnit: 1 / 2048,
        tint: vd.tint, alpha: vd.alpha,
      }));
      // the built-out lip itself, catching the light -- without it the
      // shade starts from nothing and the edge has no edge
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        innerOffset: (k) => side * (start - vd.lip * Math.min(1, width(k) / vd.reach)),
        outerOffset: (k) => side * (start + vd.lip * 0.35 * Math.min(1, width(k) / vd.reach)),
        tint: vd.lipTint, alpha: 0.85,
      }));
    }
  }

  // --- elevated highway concrete crash walls ---
  if (P.concreteWalls && wallHalf != null) {
    const wallGfx = new Graphics();
    const offset = wallHalf + 8;
    for (const side of [1, -1]) {
      // broad cast shadow under the wall
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        innerOffset: side * (offset - 18), outerOffset: side * (offset + 34),
        tint: 0x101418, alpha: 0.30,
      }));
      // dark wall base + bright concrete cap create height in top-down view
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        innerOffset: side * (offset - 11), outerOffset: side * (offset + 17),
        tint: 0x555b60, alpha: 1,
      }));
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        innerOffset: side * (offset - 8), outerOffset: side * (offset + 7),
        tint: 0xc9cdd0, alpha: 1,
      }));
    }
    // expansion joints / posts make the continuous wall read as constructed
    // concrete rather than a flat grey stripe.
    const step = Math.max(1, Math.round(115 / path.spacing));
    for (let i = 0; i < path.count; i += step) {
      const px=path.points[i][0], py=path.points[i][1];
      const nx=path.normals[i*2], ny=path.normals[i*2+1];
      const tx=-ny, ty=nx;
      for (const side of [1,-1]) {
        const cx=px+nx*side*offset, cy=py+ny*side*offset;
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
  if (P.guardrail && wallHalf != null) {
    const rail = P.guardrail;
    const offset = wallHalf + rail.inset;
    for (const side of [1, -1]) {
      // soft shadow first, wider and darker, so the rail reads as
      // standing proud of the shoulder rather than painted flat onto it
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        innerOffset: side * (offset - rail.width * 0.8), outerOffset: side * (offset + rail.width * 0.8),
        tint: 0x000000, alpha: 0.16,
      }));
      layer.addChild(ribbonMesh(path, Texture.WHITE, {
        innerOffset: side * (offset - rail.width / 2), outerOffset: side * (offset + rail.width / 2),
        tint: rail.tint, alpha: 0.95,
      }));
    }

    // posts: short perpendicular ticks at a regular step, straddling the
    // rail -- same "sample the path's own points/normals directly"
    // technique as the crosswalk bars above.
    const postGfx = new Graphics();
    const postStep = Math.max(1, Math.round(rail.postEvery / path.spacing));
    const hw = rail.postWidth / 2, hl = rail.width * 0.7;
    for (let i = 0; i < path.count; i += postStep) {
      const px = path.points[i][0], py = path.points[i][1];
      const nx = path.normals[i * 2], ny = path.normals[i * 2 + 1];
      const tx = -ny, ty = nx;
      for (const side of [1, -1]) {
        const cx = px + nx * side * offset, cy = py + ny * side * offset;
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
      const dOff = offset + del.out;
      for (let i = 0; i < path.count; i += delStep) {
        const px = path.points[i][0], py = path.points[i][1];
        const nx = path.normals[i * 2], ny = path.normals[i * 2 + 1];
        const tx = -ny, ty = nx;
        for (const side of [1, -1]) {
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
export function buildRampStructure(path, { wallHalf = 355 } = {}) {
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
      innerOffset: (k) => side * (wallHalf + shadowNear + height[k] * shadowFar),
      outerOffset: (k) => side * (wallHalf + shadowNear + height[k] * (shadowFar + shadowWidth)),
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
      innerOffset: side * (wallHalf + 8),
      outerOffset: (k) => side * (wallHalf + 8 + height[k] * wallReach),
      tint: 0x767d84, alpha: 1, ...range,
    }));
    layer.addChild(ribbonMesh(path, Texture.WHITE, {
      innerOffset: side * (wallHalf + 8),
      outerOffset: (k) => side * (wallHalf + 8 + height[k] * wallReach * 0.42),
      tint: 0xf0f2f2, alpha: 1, ...range,
    }));

    // girder fascia: a second, darker band just outside the wall, only
    // reaching its full thickness once the deck is fully elevated --
    // together with the wall this is what makes the upper deck read as a
    // constructed bridge rather than a wide road. Kept far darker than the
    // ground tint (not just a shade off it) for the same visibility reason
    // as the wall base above.
    layer.addChild(ribbonMesh(path, Texture.WHITE, {
      innerOffset: (k) => side * (wallHalf + 8 + height[k] * (wallReach + girderGap)),
      outerOffset: (k) => side * (wallHalf + 8 + height[k] * (wallReach + girderGap + girderReach)),
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
  const pierOffset = wallHalf + 8 + wallReach + girderGap + girderReach + 42;
  const pierStep = Math.max(1, Math.round(260 / path.spacing));
  const pierHalfW = 30, pierHalfL = 46;
  for (let i = 0; i < path.count; i += pierStep) {
    if (height[i] < 0.5) continue;
    const alpha = Math.min(1, (height[i] - 0.5) * 2); // fades in over the back half of the climb
    const px = path.points[i][0], py = path.points[i][1];
    const nx = path.normals[i * 2], ny = path.normals[i * 2 + 1];
    const tx = -ny, ty = nx;
    for (const side of [1, -1]) {
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
  for (const [from, span] of elevatedRuns(path)) {
    layer.addChild(ribbonMesh(path, Texture.WHITE, {
      innerOffset: -(roadHalf + 46), outerOffset: roadHalf + 46,
      tint: 0x04060a, alpha: 0.55, fromIndex: from, spanIndices: span,
    }));
  }
  return layer;
}

export function buildElevatedRoadOverlay(path, tex, { roadHalf = 360, preset = 'highway' } = {}) {
  const P = SURFACE_PRESETS[preset] || SURFACE_PRESETS.circuit;
  const layer = new Container();
  layer.label = 'elevated-road-overlay';

  const runs = elevatedRuns(path);
  if (!runs.length) return layer;

  for (const [from, span] of runs) {
    const range = { fromIndex: from, spanIndices: span };

    layer.addChild(ribbonMesh(path, tex[P.asphalt.texture], {
      innerOffset: -roadHalf, outerOffset: roadHalf,
      uInner: 0, uOuter: P.asphalt.uRepeat, vPerWorldUnit: P.asphalt.vPer,
      tint: P.asphalt.tint, ...range,
    }));

    if (P.ruts) {
      for (const off of [-P.ruts.offset, P.ruts.offset]) {
        layer.addChild(ribbonMesh(path, tex.rut_overlay, {
          innerOffset: off - P.ruts.width / 2, outerOffset: off + P.ruts.width / 2,
          uInner: 0, uOuter: 1, vPerWorldUnit: P.ruts.vPer, alpha: P.ruts.alpha, ...range,
        }));
      }
    }

    for (const side of [1, -1]) {
      layer.addChild(ribbonMesh(path, tex.edge_shadow, {
        innerOffset: side * roadHalf, outerOffset: side * (roadHalf - 110),
        uInner: 0, uOuter: 1, vPerWorldUnit: 1 / 2048, alpha: 0.9, ...range,
      }));
    }

    if (P.edgeLine) {
      for (const side of [1, -1]) {
        const inner = side * (roadHalf - P.edgeLine.inset);
        layer.addChild(ribbonMesh(path, Texture.WHITE, {
          innerOffset: inner, outerOffset: inner - side * P.edgeLine.width,
          tint: P.edgeLine.tint, alpha: P.edgeLine.alpha, ...range,
        }));
      }
    }

    if (P.highwayLanes) {
      for (const off of [-roadHalf / 3, roadHalf / 3]) {
        layer.addChild(ribbonMesh(path, tex.dash_white, {
          innerOffset: off - 6, outerOffset: off + 6,
          uInner: 0, uOuter: 1, vPerWorldUnit: 1 / 165, alpha: 0.94, ...range,
        }));
      }
    }
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
