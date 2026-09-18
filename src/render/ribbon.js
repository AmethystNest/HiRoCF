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
 * @param {TrackPath} path
 * @param {object} opts
 *   innerOffset / outerOffset : lateral offsets in world units (may be functions of index)
 *   uInner / uOuter           : texture U at each edge (>1 tiles across the strip)
 *   vPerWorldUnit             : texture repeats per world unit along the track
 */
export function ribbonGeometry(path, {
  innerOffset, outerOffset, uInner = 0, uOuter = 1, vPerWorldUnit = 1 / 512,
  fromIndex = null, spanIndices = null,
}) {
  // A partial ribbon (a decal such as the start line) covers a span of the
  // loop; a full one wraps and must close seamlessly.
  const partial = fromIndex !== null && spanIndices !== null;
  const n = partial ? spanIndices : path.count;
  const base = partial ? fromIndex : 0;
  const verts = (n + 1) * 2;
  const positions = new Float32Array(verts * 2);
  const uvs = new Float32Array(verts * 2);
  const indices = new Uint32Array(n * 6);

  const inner = typeof innerOffset === 'function' ? innerOffset : () => innerOffset;
  const outer = typeof outerOffset === 'function' ? outerOffset : () => outerOffset;

  // snap V to a whole number of repeats so a closed loop has no seam
  const spanLen = n * path.spacing;
  const vTotal = partial
    ? Math.max(1, spanLen * vPerWorldUnit)
    : Math.max(1, Math.round(path.length * vPerWorldUnit));

  for (let i = 0; i <= n; i++) {
    const k = path.wrap(base + i);
    const p = path.points[k];
    const nx = path.normals[k * 2], ny = path.normals[k * 2 + 1];
    const a = inner(k), b = outer(k);
    const v = (i / n) * vTotal;

    positions[i * 4 + 0] = p[0] + nx * a;
    positions[i * 4 + 1] = p[1] + ny * a;
    positions[i * 4 + 2] = p[0] + nx * b;
    positions[i * 4 + 3] = p[1] + ny * b;

    uvs[i * 4 + 0] = uInner; uvs[i * 4 + 1] = v;
    uvs[i * 4 + 2] = uOuter; uvs[i * 4 + 3] = v;
  }

  for (let i = 0; i < n; i++) {
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
