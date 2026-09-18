/**
 * Track centreline: authoring primitives plus a uniform-arc-length resample.
 *
 * The Canvas build stored whatever point density each primitive happened to
 * produce, so a "step of N points" meant a different real distance on a
 * corner than on a straight. Every spacing bug in that build traced back to
 * that. Here the authored path is resampled to a fixed world-space spacing,
 * so index and distance are interchangeable and anything spaced by index is
 * automatically spaced evenly on the ground.
 */

/** Authoring helper: collects raw points, then resamples them. */
export class PathBuilder {
  constructor() { this.pts = []; }

  line(x1, y1, x2, y2, steps = 24) {
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      this.pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
    }
    return this;
  }

  arc(cx, cy, r, a0, a1, steps = 24) {
    for (let i = 0; i < steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps);
      this.pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return this;
  }

  /** Straight run with a sine S-bend layered on, fading in and out at the ends. */
  wave(x1, y1, x2, y2, steps, amplitude, waves = 1) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const env = Math.sin(Math.PI * t) ** 2;
      const off = amplitude * env * Math.sin(Math.PI * 2 * waves * t);
      this.pts.push([x1 + dx * t + nx * off, y1 + dy * t + ny * off]);
    }
    return this;
  }

  /** Straight run bulged out to one side — a single wide sweeping corner. */
  bulge(x1, y1, x2, y2, steps, amount) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const off = amount * Math.sin(Math.PI * t);
      this.pts.push([x1 + dx * t + nx * off, y1 + dy * t + ny * off]);
    }
    return this;
  }

  build(spacing = 26, smoothPasses = 2) {
    return new TrackPath(this.pts, spacing, smoothPasses);
  }
}

/** Smooth a closed polyline with a small moving average (kills primitive joins). */
function smoothClosed(pts, passes) {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    const n = cur.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = cur[(i - 1 + n) % n], b = cur[i], c = cur[(i + 1) % n];
      out[i] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4];
    }
    cur = out;
  }
  return cur;
}

export class TrackPath {
  /**
   * @param rawPts  authored points (closed loop, unevenly spaced)
   * @param spacing target world-space distance between resampled points
   */
  constructor(rawPts, spacing = 26, smoothPasses = 2) {
    const src = smoothClosed(rawPts, smoothPasses);

    // cumulative length of the authored loop
    const n = src.length;
    const cum = [0];
    for (let i = 0; i < n; i++) {
      const a = src[i], b = src[(i + 1) % n];
      cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const rawLen = cum[n];

    // resample to a whole number of evenly spaced points
    const count = Math.max(8, Math.round(rawLen / spacing));
    const step = rawLen / count;
    const pts = new Array(count);
    let seg = 0;
    for (let i = 0; i < count; i++) {
      const d = i * step;
      while (seg < n - 1 && cum[seg + 1] < d) seg++;
      const segLen = cum[seg + 1] - cum[seg] || 1;
      const t = (d - cum[seg]) / segLen;
      const a = src[seg], b = src[(seg + 1) % n];
      pts[i] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }

    this.points = pts;
    this.count = count;
    this.spacing = step;
    this.length = step * count;
    // 2.5D route metadata. Existing stages default to the ground deck.
    this.deckIds = new Int16Array(count);
    this.zLevels = new Int16Array(count);

    // per-point tangent angle and unit normal (left-hand side positive)
    this.tangents = new Float32Array(count);
    this.normals = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const p = pts[(i - 1 + count) % count], q = pts[(i + 1) % count];
      const tx = q[0] - p[0], ty = q[1] - p[1];
      const L = Math.hypot(tx, ty) || 1;
      this.tangents[i] = Math.atan2(ty, tx);
      this.normals[i * 2] = -ty / L;
      this.normals[i * 2 + 1] = tx / L;
    }

    // curvature magnitude per point, 0..1 — drives decoration and AI decisions
    this.curvature = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = this.tangents[(i - 2 + count) % count];
      const b = this.tangents[(i + 2) % count];
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.curvature[i] = Math.min(1, Math.abs(d) / 0.55);
    }
  }

  /** Assign logical road/deck metadata to a normalized route range. */
  setLayerRange(from01, to01, deckId = 0, zLevel = 0) {
    const n=this.count;
    let a=this.wrap(Math.floor(from01*n)), b=Math.min(n,Math.ceil(to01*n));
    if (from01 <= to01) {
      for(let i=a;i<b;i++){ this.deckIds[i]=deckId; this.zLevels[i]=zLevel; }
    } else {
      for(let i=a;i<n;i++){ this.deckIds[i]=deckId; this.zLevels[i]=zLevel; }
      for(let i=0;i<b;i++){ this.deckIds[i]=deckId; this.zLevels[i]=zLevel; }
    }
    return this;
  }

  layerAtIndex(i) {
    const k=this.wrap(Math.round(i));
    return { deckId:this.deckIds[k], zLevel:this.zLevels[k] };
  }

  /** Crossing-safe local centreline lookup for future stacked roads. */
  nearestNearIndex(x,y,hintIndex,window=120,deckId=null) {
    const n=this.count, h=this.wrap(Math.round(hintIndex||0));
    const w=Math.max(8,Math.min(Math.floor(n/2),Math.round(window)));
    let bestI=h,bestD2=Infinity;
    for(let o=-w;o<=w;o++){
      const i=this.wrap(h+o);
      if(deckId!==null && this.deckIds[i]!==deckId) continue;
      const q=this.points[i],dx=x-q[0],dy=y-q[1],d2=dx*dx+dy*dy;
      if(d2<bestD2){bestD2=d2;bestI=i;}
    }
    return {index:bestI,dist2:bestD2};
  }

  /** Index wrapped into range. */
  wrap(i) { return ((i % this.count) + this.count) % this.count; }

  /** World position offset laterally from the centreline at point `i`. */
  offsetPoint(i, lateral) {
    const k = this.wrap(Math.round(i));
    const p = this.points[k];
    return {
      x: p[0] + this.normals[k * 2] * lateral,
      y: p[1] + this.normals[k * 2 + 1] * lateral,
      angle: this.tangents[k],
      curvature: this.curvature[k],
    };
  }

  /** Index for a distance travelled along the loop (index === distance/spacing). */
  indexAtDistance(d) {
    return this.wrap(Math.round(d / this.spacing));
  }

  /** Continuous sample at distance `d` along the loop. */
  sample(d) {
    const total = this.length;
    const dd = ((d % total) + total) % total;
    const f = dd / this.spacing;
    const i = Math.floor(f) % this.count;
    const t = f - Math.floor(f);
    const a = this.points[i], b = this.points[(i + 1) % this.count];
    let ta = this.tangents[i];
    let tb = this.tangents[(i + 1) % this.count];
    let dt = tb - ta;
    while (dt > Math.PI) dt -= Math.PI * 2;
    while (dt < -Math.PI) dt += Math.PI * 2;
    return {
      x: a[0] + (b[0] - a[0]) * t,
      y: a[1] + (b[1] - a[1]) * t,
      angle: ta + dt * t,
      index: i,
    };
  }

  /**
   * Closest point on the centreline. A uniform grid over the points keeps
   * this O(1)-ish instead of scanning the whole loop every frame.
   */
  _buildGrid() {
    const cell = 400;
    const grid = new Map();
    for (let i = 0; i < this.count; i++) {
      const p = this.points[i];
      const key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
      let bucket = grid.get(key);
      if (!bucket) grid.set(key, bucket = []);
      bucket.push(i);
    }
    this._grid = grid;
    this._cell = cell;
  }

  nearest(x, y) {
    if (!this._grid) this._buildGrid();
    const cell = this._cell;
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    let best = Infinity, bestIdx = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = this._grid.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const i of bucket) {
          const p = this.points[i];
          const d2 = (p[0] - x) ** 2 + (p[1] - y) ** 2;
          if (d2 < best) { best = d2; bestIdx = i; }
        }
      }
    }
    if (best === Infinity) {
      // fell outside every populated cell — fall back to a full scan
      for (let i = 0; i < this.count; i++) {
        const p = this.points[i];
        const d2 = (p[0] - x) ** 2 + (p[1] - y) ** 2;
        if (d2 < best) { best = d2; bestIdx = i; }
      }
    }

    // refine against the two adjacent segments for a smooth distance value
    let bx = 0, by = 0, bd2 = Infinity, bt = 0, bi = bestIdx;
    for (const i of [this.wrap(bestIdx - 1), bestIdx]) {
      const a = this.points[i], b = this.points[this.wrap(i + 1)];
      const vx = b[0] - a[0], vy = b[1] - a[1];
      const vv = vx * vx + vy * vy || 1;
      let t = ((x - a[0]) * vx + (y - a[1]) * vy) / vv;
      t = Math.max(0, Math.min(1, t));
      const px = a[0] + vx * t, py = a[1] + vy * t;
      const d2 = (px - x) ** 2 + (py - y) ** 2;
      if (d2 < bd2) { bd2 = d2; bx = px; by = py; bt = t; bi = i; }
    }
    return {
      dist: Math.sqrt(bd2),
      x: bx, y: by,
      index: bi,
      t: bt,
      distance: (bi + bt) * this.spacing,
      angle: this.tangents[bi],
    };
  }

  /** Signed lateral offset of a world point (positive = left of travel). */
  lateralOf(x, y, near = null) {
    const n = near || this.nearest(x, y);
    const k = n.index;
    return (x - n.x) * this.normals[k * 2] + (y - n.y) * this.normals[k * 2 + 1];
  }
}
