/**
 * Screen-space lightning that lances in from the left and right edges.
 *
 * Shared by the two moments that want it: the lights going green, and
 * the line being crossed. Added straight to app.stage like the minimap
 * and the finish effect, so it draws over the world whatever the camera
 * is doing, and under the DOM overlays that carry the actual words.
 *
 * Each strike is a set of bolts entering from both side edges at a
 * shallow angle and reaching toward the middle of the screen, plus a
 * short glow bloom along the edges they came from. Struck once and gone
 * inside half a second -- it is punctuation on a moment, not a state.
 */
import { Container, Graphics } from '../pixi.js';

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * A jagged path from (x0,y0) to (x1,y1) -- straight-line displacement
 * jittered perpendicular to its own direction, more so in the middle
 * than at either end, which is what keeps a bolt's start and finish
 * looking chosen while the middle looks struck.
 */
export function boltPath(x0, y0, x1, y1, segments, jitter) {
  const pts = [[x0, y0]];
  const dx = x1 - x0, dy = y1 - y0;
  const nx = -dy, ny = dx;
  const nlen = Math.hypot(nx, ny) || 1;
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const off = (Math.random() - 0.5) * jitter * (1 - Math.abs(t - 0.5) * 1.3);
    pts.push([x0 + dx * t + (nx / nlen) * off, y0 + dy * t + (ny / nlen) * off]);
  }
  pts.push([x1, y1]);
  return pts;
}

export function buildSideBolts() {
  const view = new Container();
  view.label = 'sidebolts';
  view.visible = false;

  const gfx = new Graphics();
  view.addChild(gfx);

  let shapes = [];
  let timer = 0;
  let life = 0.44;
  let core = 0xf2ffff;
  let glow = 0x9fe8ff;

  /**
   * @param screenW,screenH  the viewport to strike across
   * @param opts.perSide   bolts entering from EACH edge
   * @param opts.reach     how far in, as a fraction of the width, the
   *                       bolts push before they stop (0.5 = they meet
   *                       in the middle)
   * @param opts.band      vertical span they arrive across, as a
   *                       fraction of height, centred on `focusY`
   * @param opts.focusY    where on screen they converge (fraction of H)
   */
  function strike(screenW, screenH, opts = {}) {
    const {
      perSide = 3, reach = 0.52, band = 0.5, focusY = 0.45,
      life: boltLife = 0.44, core: coreColor = 0xf2ffff, glow: glowColor = 0x9fe8ff,
    } = opts;

    life = boltLife;
    core = coreColor;
    glow = glowColor;
    timer = 0;
    shapes = [];
    view.visible = true;

    const cy = screenH * focusY;
    for (const dir of [-1, 1]) {           // -1 enters from the left, 1 from the right
      const edgeX = dir < 0 ? -20 : screenW + 20;
      for (let i = 0; i < perSide; i++) {
        // Spread the entry points across the band so several bolts on
        // the same side read as a barrage rather than one thick stroke.
        const entryY = cy + (Math.random() - 0.5) * screenH * band;
        const tipX = edgeX - dir * screenW * reach * (0.7 + Math.random() * 0.45);
        const tipY = cy + (Math.random() - 0.5) * screenH * band * 0.45;
        const pts = boltPath(edgeX, entryY, tipX, tipY, 7, 52);
        let branch = null;
        if (Math.random() < 0.75) {
          const bi = 2 + ((Math.random() * (pts.length - 4)) | 0);
          const [bx, by] = pts[bi];
          const bAng = Math.atan2(tipY - entryY, tipX - edgeX) + (Math.random() - 0.5) * 1.5;
          const bLen = screenW * (0.08 + Math.random() * 0.13);
          branch = boltPath(bx, by, bx + Math.cos(bAng) * bLen, by + Math.sin(bAng) * bLen, 3, 22);
        }
        shapes.push({
          pts, branch, dir,
          w: 2.6 + Math.random() * 2.8,
          delay: Math.random() * 0.09,
        });
      }
    }
  }

  function reset() {
    shapes = [];
    timer = 0;
    gfx.clear();
    view.visible = false;
  }

  function update(dt, screenW, screenH) {
    if (!view.visible) return;
    timer += dt;
    gfx.clear();

    const fade = 1 - clamp01(timer / life);
    if (fade <= 0) { reset(); return; }

    // The edges the bolts came in over stay lit for the first instant,
    // so the strike reads as coming from off screen rather than as
    // lines that happen to start at the border.
    const bloom = Math.max(0, 1 - timer / (life * 0.45));
    if (bloom > 0) {
      const w = screenW * 0.16;
      for (let i = 0; i < 5; i++) {
        const a = bloom * 0.09 * (1 - i / 5);
        const d = w * (1 - i / 5);
        gfx.rect(0, 0, d, screenH).fill({ color: glow, alpha: a });
        gfx.rect(screenW - d, 0, d, screenH).fill({ color: glow, alpha: a });
      }
    }

    // Each bolt is drawn twice, a wide soft glow pass then a thin bright
    // core -- the same two-pass trick the boost flame and contact sparks
    // use for "hot at the centre".
    const draw = (pts) => {
      gfx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) gfx.lineTo(pts[i][0], pts[i][1]);
    };
    const punch = Math.max(0, 1 - timer / (life * 0.25));
    for (const b of shapes) {
      const struck = clamp01((timer - b.delay) / 0.05);
      if (struck <= 0) continue;
      const alpha = fade * struck;
      draw(b.pts);
      gfx.stroke({ width: b.w * 5.0, color: glow, alpha: alpha * 0.22 * (0.6 + punch * 0.4), cap: 'round', join: 'round' });
      draw(b.pts);
      gfx.stroke({ width: b.w * 2.2, color: glow, alpha: alpha * 0.44 * (0.6 + punch * 0.4), cap: 'round', join: 'round' });
      draw(b.pts);
      gfx.stroke({ width: b.w, color: core, alpha: alpha * (0.82 + punch * 0.18), cap: 'round', join: 'round' });
      if (b.branch) {
        draw(b.branch);
        gfx.stroke({ width: b.w * 2.4, color: glow, alpha: alpha * 0.26, cap: 'round', join: 'round' });
        draw(b.branch);
        gfx.stroke({ width: b.w * 0.7, color: core, alpha: alpha * 0.66, cap: 'round', join: 'round' });
      }
    }
  }

  return { view, strike, update, reset };
}
