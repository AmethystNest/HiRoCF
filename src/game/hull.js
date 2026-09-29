/**
 * Collision hulls cut from the car that is actually drawn.
 *
 * The old hull was a chain of circles sized by hand per car (CAR_HULL_SCALE,
 * CAR_HULL_OFFSET in config.js). Measured against the drawn silhouettes
 * (build/tools/hullgauge.mjs) it left up to 44 world units of daylight
 * between two cars nose to tail and buried the stage 4 truck by up to 40.
 * Here the hull is the convex outline of the sprite's own opaque pixels,
 * reduced to a handful of vertices, and two hulls are tested with the
 * separating axis theorem -- so "touching" means the drawn bodies touch.
 *
 * Coordinates are the sprite's: texture axes, +x across the car and +y
 * toward its tail (the same convention as hullCircles' ox/oy and
 * bodyPastBarrier's body offset), origin at the sprite's anchor.
 */

/** Cross product of (b - a) and (c - a). */
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** Convex hull of points (Andrew's monotone chain), counter-clockwise. */
export function convexHull(points) {
  const p = points.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/**
 * Drop vertices of a convex polygon, smallest triangle first, until `max`
 * are left. Each removal cuts a corner, so the result sits inside the
 * outline it came from by a fraction of a pixel at these counts.
 */
export function simplify(poly, max) {
  const pts = poly.slice();
  while (pts.length > max) {
    let best = -1, bestArea = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const area = Math.abs(cross(a, b, c));
      if (area < bestArea) { bestArea = area; best = i; }
    }
    pts.splice(best, 1);
  }
  return pts;
}

/**
 * The hull of an image's opaque pixels, as vertices in fractions of the
 * image (x across, -0.5..0.5; y down the picture, -0.5..0.5). `rgba` is
 * ImageData.data. Only the edge pixels matter, so it walks each row for its
 * first and last opaque pixel.
 */
export function silhouetteFractions(rgba, width, height, { alpha = 12, maxVertices = 24 } = {}) {
  const pts = [];
  for (let y = 0; y < height; y++) {
    let first = -1, last = -1;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (rgba[(row + x) * 4 + 3] > alpha) { if (first < 0) first = x; last = x; }
    }
    if (first >= 0) {
      pts.push([first / width - 0.5, y / height - 0.5], [(last + 1) / width - 0.5, y / height - 0.5],
        [first / width - 0.5, (y + 1) / height - 0.5], [(last + 1) / width - 0.5, (y + 1) / height - 0.5]);
    }
  }
  if (!pts.length) return null;
  return simplify(convexHull(pts), maxVertices);
}

/** The hull in world units for a sprite drawn `w` x `h`: [[tx, ty], ...]. */
export function scalePolygon(fractions, w, h) {
  return fractions.map(([x, y]) => [x * w, y * h]);
}

/**
 * A hull placed in the world: `car` = { x, y, angle, driftVisualAngle }, the
 * angle it is DRAWN at (heading plus the visual slide), for the same reason
 * hullCircles uses it -- a body this long swings a lot of width out when it
 * yaws. The transform is bodyPastBarrier's.
 */
export function worldPolygon(car, poly) {
  const ang = car.angle + (car.driftVisualAngle ?? 0);
  const s = Math.sin(ang), c = Math.cos(ang);
  return poly.map(([tx, ty]) => [car.x - tx * s - ty * c, car.y + tx * c - ty * s]);
}

/** Centroid of a polygon's vertices (their mean: enough to orient a normal). */
function mean(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

/**
 * Separating axis test of two convex polygons in the world. Returns null if
 * they are apart, else { overlap, nx, ny, x, y }: the shallowest way out,
 * `overlap` deep along the unit normal (nx, ny) pointing from `a` to `b`,
 * and a contact point in the middle of the overlap along it.
 */
export function polygonContact(A, B) {
  let depth = Infinity, nx = 0, ny = 0;
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length];
      let ax = q[1] - p[1], ay = p[0] - q[0];
      const len = Math.hypot(ax, ay);
      if (len < 1e-9) continue;
      ax /= len; ay /= len;
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const v of A) { const d = v[0] * ax + v[1] * ay; if (d < aMin) aMin = d; if (d > aMax) aMax = d; }
      for (const v of B) { const d = v[0] * ax + v[1] * ay; if (d < bMin) bMin = d; if (d > bMax) bMax = d; }
      const o = Math.min(aMax, bMax) - Math.max(aMin, bMin);
      if (o <= 0) return null;
      if (o < depth) { depth = o; nx = ax; ny = ay; }
    }
  }
  // point the normal from A toward B
  const ca = mean(A), cb = mean(B);
  if ((cb[0] - ca[0]) * nx + (cb[1] - ca[1]) * ny < 0) { nx = -nx; ny = -ny; }
  // extremes along it: A's leading vertex and B's trailing one, and between
  let va = A[0], vb = B[0], aMax = -Infinity, bMin = Infinity;
  for (const v of A) { const d = v[0] * nx + v[1] * ny; if (d > aMax) { aMax = d; va = v; } }
  for (const v of B) { const d = v[0] * nx + v[1] * ny; if (d < bMin) { bMin = d; vb = v; } }
  return { overlap: depth, nx, ny, x: (va[0] + vb[0]) / 2, y: (va[1] + vb[1]) / 2 };
}

/** How deep car `a` (drawn `sa.poly`) is into car `b` (`sb.poly`); 0 if apart. */
export function overlapDepth(a, sa, b, sb) {
  const hit = polygonContact(worldPolygon(a, sa.poly), worldPolygon(b, sb.poly));
  return hit ? hit.overlap : 0;
}
