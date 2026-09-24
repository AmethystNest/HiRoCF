/**
 * Where the camera can ever look.
 *
 * The camera follows the player's car, turned so the car points up the
 * screen, with the car at (W/2, 0.62 H). So from any pose the player can be
 * in, the view is a rectangle round the car: W/zoom wide, 0.62 H/zoom
 * ahead of it and 0.38 H/zoom behind. The widest view is VIEW level 0
 * (zoomLevels[0] = 1); every other level and every camera move in the
 * game zooms IN from it (the grid and finish shots clamp at >= 1).
 *
 * The union of those rectangles over the whole lap -- the car anywhere
 * from one wall to the other, and turned off the road's heading as far as
 * a drift turns it -- is everything the player can ever see. A prop or a
 * building outside it is loaded, placed and drawn for nobody, so the
 * scenery builders ask this before they place anything.
 *
 * Kept as a grid of CELL-sized cells, dilated by one cell, so "can this
 * be seen" is a lookup and errs toward yes.
 */
const CELL = 200;

/**
 * @param path    TrackPath
 * @param barrier per-index wall half-width: where the car can be
 * @param views   [{ w, h }] view sizes in WORLD units (screen / zoom), e.g.
 *                the screen as it is and the same screen turned over
 */
export function buildViewMask(path, barrier, views) {
  const cells = new Set();
  const key = (i, j) => (i + 50000) * 100000 + (j + 50000);
  // car poses: every 4th point (~100 units, against views 1,000+ across),
  // three lateral positions, three headings
  const yaw = [-0.45, 0, 0.45];
  const m = CELL * 0.71;   // cell centre inside the rectangle grown by half a cell diagonal
  for (let k = 0; k < path.count; k += 4) {
    const px = path.points[k][0], py = path.points[k][1];
    const nx = path.normals[k * 2], ny = path.normals[k * 2 + 1];
    const wall = barrier ? barrier[k] : 400;
    for (let l = -1; l <= 1; l++) {
      const cx = px + nx * wall * l, cy = py + ny * wall * l;
      for (const dy of yaw) {
        const a = path.tangents[k] + dy;
        const fx = Math.cos(a), fy = Math.sin(a);   // ahead
        const sx = -fy, sy = fx;                     // across
        for (const v of views) {
          const ahead = v.h * 0.62, behind = v.h * 0.38, half = v.w / 2;
          // bounding box of the rotated rectangle, from its extents
          const ex = Math.abs(sx) * half, ey = Math.abs(sy) * half;
          const x0 = cx + Math.min(fx * ahead, -fx * behind) - ex, x1 = cx + Math.max(fx * ahead, -fx * behind) + ex;
          const y0 = cy + Math.min(fy * ahead, -fy * behind) - ey, y1 = cy + Math.max(fy * ahead, -fy * behind) + ey;
          const i0 = Math.floor(x0 / CELL), i1 = Math.floor(x1 / CELL);
          const j0 = Math.floor(y0 / CELL), j1 = Math.floor(y1 / CELL);
          for (let i = i0; i <= i1; i++) {
            const qx = (i + 0.5) * CELL - cx;
            for (let j = j0; j <= j1; j++) {
              const qy = (j + 0.5) * CELL - cy;
              const f = qx * fx + qy * fy, s = qx * sx + qy * sy;
              if (f <= ahead + m && f >= -behind - m && (s <= half + m && s >= -half - m)) cells.add(key(i, j));
            }
          }
        }
      }
    }
  }
  // dilate by one cell
  const grown = new Set(cells);
  for (const c of cells) {
    const i = Math.floor(c / 100000) - 50000, j = (c % 100000) - 50000;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) grown.add(key(i + di, j + dj));
  }
  return {
    cells: grown.size,
    /** Can anything within `r` of (x, y) ever be on screen? */
    visible(x, y, r = 0) {
      const R = Math.ceil(r / CELL);
      const ci = Math.floor(x / CELL), cj = Math.floor(y / CELL);
      for (let i = ci - R; i <= ci + R; i++) {
        for (let j = cj - R; j <= cj + R; j++) if (grown.has(key(i, j))) return true;
      }
      return false;
    },
  };
}
