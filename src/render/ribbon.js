/**
 * Ribbon meshes: a textured strip that follows the track centreline.
 *
 * This is what replaces "fill a fat polyline with a flat colour". Because the
 * strip carries real UVs, the surface can use a tiling material and the V axis
 * can be driven by true arc length, so texture density stays constant through
 * corners and the loop closes without a seam.
 */
import { MeshGeometry, Mesh } from '../pixi.js';

/**
 * Largest distance any dropped edge point would sit from the chord that
 * would replace it, over both edges of the strip, for the span [s, e].
 */
function spanDeviation(edge, s, e) {
  let worst = 0;
  for (let lane = 0; lane < 4; lane += 2) {
    const ax = edge[s * 4 + lane], ay = edge[s * 4 + lane + 1];
    const bx = edge[e * 4 + lane], by = edge[e * 4 + lane + 1];
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy;
    for (let k = s + 1; k < e; k++) {
      const px = edge[k * 4 + lane], py = edge[k * 4 + lane + 1];
      const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
      const ex = px - (ax + dx * t), ey = py - (ay + dy * t);
      const d = ex * ex + ey * ey;
      if (d > worst) worst = d;
    }
  }
  return Math.sqrt(worst);
}

/**
 * Which samples along the span a ribbon actually needs a pair of vertices at.
 *
 * TrackPath resamples to a fixed 26-unit spacing because index has to equal
 * distance for the driving code; that is far finer than a strip's geometry
 * needs. A straight is the same shape with two quads as with two hundred.
 *
 * The test is on the strip's own edges, not the centreline's curvature, and
 * it measures the error rather than estimating it: a run of points is
 * collapsed only while every point it drops would sit within `tol` world
 * units of the chord replacing it. That matters because the two are not the
 * same question -- the inside edge of a corner tighter than the lateral
 * offset doubles back on itself, travelling a long way while the centreline
 * barely turns, and a curvature-based rule cuts that corner off. Measuring
 * the edges also makes the rule safe for ribbons whose offsets vary per
 * index (a ramp's height profile, a tunnel's depth fade), whose detail the
 * centreline knows nothing about.
 *
 * Greedy, and bounded by `maxStep`, so the cost stays linear in the number
 * of points: at most maxStep^2 distance tests per emitted sample.
 */
function selectSamples(edge, n, tol = 1.5, maxStep = 48) {
  const keep = [0];
  let s = 0;
  while (s < n) {
    const limit = Math.min(n, s + maxStep);
    let best = s + 1;
    for (let e = s + 2; e <= limit; e++) {
      if (spanDeviation(edge, s, e) > tol) break;
      best = e;
    }
    keep.push(best);
    s = best;
  }
  return keep;
}

/**
 * @param {TrackPath} path
 * @param {object} opts
 *   innerOffset / outerOffset : lateral offsets in world units (may be functions of index)
 *   uInner / uOuter           : texture U at each edge (>1 tiles across the strip)
 *   vPerWorldUnit             : texture repeats per world unit along the track
 *   dense                     : keep a vertex pair at every centreline point
 */
export function ribbonGeometry(path, {
  innerOffset, outerOffset, uInner = 0, uOuter = 1, vPerWorldUnit = 1 / 512,
  fromIndex = null, spanIndices = null, dense = false,
}) {
  // A partial ribbon (a decal such as the start line) covers a span of the
  // loop; a full one wraps and must close seamlessly.
  const partial = fromIndex !== null && spanIndices !== null;
  const n = partial ? spanIndices : path.count;
  const base = partial ? fromIndex : 0;

  const inner = typeof innerOffset === 'function' ? innerOffset : () => innerOffset;
  const outer = typeof outerOffset === 'function' ? outerOffset : () => outerOffset;

  // both strip edges at every centreline point, which is what the sample
  // selection below measures against and what the emitted vertices read
  const edge = new Float64Array((n + 1) * 4);
  for (let i = 0; i <= n; i++) {
    const k = path.wrap(base + i);
    const p = path.points[k];
    const nx = path.normals[k * 2], ny = path.normals[k * 2 + 1];
    const a = inner(k), b = outer(k);
    edge[i * 4 + 0] = p[0] + nx * a;
    edge[i * 4 + 1] = p[1] + ny * a;
    edge[i * 4 + 2] = p[0] + nx * b;
    edge[i * 4 + 3] = p[1] + ny * b;
  }

  const samples = dense ? null : selectSamples(edge, n);
  const segs = samples ? samples.length - 1 : n;

  const verts = (segs + 1) * 2;
  const positions = new Float32Array(verts * 2);
  const uvs = new Float32Array(verts * 2);
  const indices = new Uint32Array(segs * 6);

  // snap V to a whole number of repeats so a closed loop has no seam
  const spanLen = n * path.spacing;
  const vTotal = partial
    ? Math.max(1, spanLen * vPerWorldUnit)
    : Math.max(1, Math.round(path.length * vPerWorldUnit));

  for (let s = 0; s <= segs; s++) {
    // `off` is the distance along the span in centreline points, so V stays
    // true arc length however unevenly the samples are spaced.
    const off = samples ? samples[s] : s;
    const v = (off / n) * vTotal;

    positions[s * 4 + 0] = edge[off * 4 + 0];
    positions[s * 4 + 1] = edge[off * 4 + 1];
    positions[s * 4 + 2] = edge[off * 4 + 2];
    positions[s * 4 + 3] = edge[off * 4 + 3];

    uvs[s * 4 + 0] = uInner; uvs[s * 4 + 1] = v;
    uvs[s * 4 + 2] = uOuter; uvs[s * 4 + 3] = v;
  }

  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices[i * 6 + 0] = a; indices[i * 6 + 1] = b; indices[i * 6 + 2] = c;
    indices[i * 6 + 3] = b; indices[i * 6 + 4] = d; indices[i * 6 + 5] = c;
  }

  return new MeshGeometry({ positions, uvs, indices });
}

export function ribbonMesh(path, texture, opts) {
  const mesh = new Mesh({ geometry: ribbonGeometry(path, opts), texture });
  if (opts.alpha !== undefined) mesh.alpha = opts.alpha;
  if (opts.tint !== undefined) mesh.tint = opts.tint;
  if (opts.blend) mesh.blendMode = opts.blend;
  return mesh;
}

/**
 * A strip whose colour comes from a tint rather than a texture — used for
 * paint lines and soft contact shadows, where a 1px white texture plus a tint
 * is cheaper than authoring an image.
 */
export function solidRibbon(path, whiteTexture, opts) {
  const mesh = ribbonMesh(path, whiteTexture, { ...opts, uInner: 0, uOuter: 1, vPerWorldUnit: 1 / 1024 });
  return mesh;
}
