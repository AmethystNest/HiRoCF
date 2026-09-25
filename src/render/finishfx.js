/**
 * Finish-line celebration.
 *
 * Screen-fixed, like the minimap -- added directly to app.stage so it draws
 * over the world regardless of camera rotation/zoom.
 *
 * Staged rather than a single sustained effect, because the result card
 * (DOM, see index.html) arrives 1.9s after the line and everything here has
 * to have said its piece and stepped back by then:
 *
 *   0.00  impact   -- flash, radial speed lines and a burst of lightning
 *                     bolts blown out from the centre
 *   0.10  banner   -- a chequered band sweeps across and holds, waving
 *   0.15  title    -- FINISH slams down from above and settles
 *   1.30  clear    -- title and banner leave, vignette stays under the card
 *
 * Win and lose share the staging and differ in grade: gold and bright with
 * confetti off the banner, or cold and closing-in with the screen pinched
 * to a letterbox.
 */
import { Container, FillGradient, Graphics, Text } from '../pixi.js';
import { boltPath } from './boltfx.js';

/**
 * The brushed-metal fill the page's headline type uses in CSS (see
 * .chrome in index.html), rebuilt for canvas text so FINISH belongs to
 * the same family as VS, the countdown numerals and WIN/LOSE rather
 * than being the one flat-white word in the game.
 *
 * textureSpace 'local' maps the stops across the text's own box, so the
 * band sits in the same place whatever the word or the font size.
 */
function chromeFill(stops) {
  return new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: stops,
    textureSpace: 'local',
  });
}

const CHROME_STEEL = [
  { offset: 0.00, color: '#ffffff' },
  { offset: 0.26, color: '#eef4fb' },
  { offset: 0.50, color: '#9fb2c6' },
  { offset: 0.63, color: '#ffffff' },
  { offset: 0.86, color: '#c6d5e6' },
  { offset: 1.00, color: '#8497ab' },
];
const CHROME_GOLD = [
  { offset: 0.00, color: '#fff8de' },
  { offset: 0.24, color: '#ffe488' },
  { offset: 0.50, color: '#d39c27' },
  { offset: 0.62, color: '#fffaea' },
  { offset: 0.85, color: '#ffd64a' },
  { offset: 1.00, color: '#9e6d13' },
];

/** Cubic ease-out: fast arrival, soft landing. Used by every entrance. */
const easeOut = (t) => 1 - (1 - t) ** 3;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** 0 before `from`, eased 0..1 across `dur`, 1 after. */
const phase = (t, from, dur) => easeOut(clamp01((t - from) / dur));

export function buildFinishFX() {
  const view = new Container();
  view.label = 'finishfx';
  view.visible = false;

  const under = new Graphics();      // grade + speed lines, behind everything
  const bolts = new Graphics();      // lightning burst, over the grade, under the banner
  const banner = new Graphics();     // chequered flag, behind the title
  const over = new Graphics();       // confetti, in front of everything
  view.addChild(under);
  view.addChild(bolts);
  view.addChild(banner);

  const steelFill = chromeFill(CHROME_STEEL);
  const goldFill = chromeFill(CHROME_GOLD);

  const titleMain = new Text({
    text: '', style: {
      fontFamily: 'Arial, sans-serif', fontWeight: '900', fontSize: 74,
      fill: steelFill, letterSpacing: 2,
      stroke: { color: 0x05070a, width: 10, join: 'round' },
      dropShadow: { color: 0x000000, alpha: 0.55, blur: 4, distance: 5, angle: Math.PI / 2 },
    },
  });
  titleMain.anchor.set(0.5);
  // Raked over to the left, same -9deg the CSS headline type uses.
  titleMain.skew.x = -0.157;
  view.addChild(titleMain);

  const titleSub = new Text({
    text: '', style: {
      fontFamily: 'Arial, sans-serif', fontWeight: '900', fontSize: 14,
      fill: 0xffe470, letterSpacing: 11,
      stroke: { color: 0x05070a, width: 4, join: 'round' },
    },
  });
  titleSub.anchor.set(0.5);
  view.addChild(titleSub);
  view.addChild(over);

  let active = false;
  let win = true;
  let timer = 0;
  let confetti = [];
  let lines = [];
  let boltShapes = [];

  function trigger(place, screenW, screenH) {
    active = true;
    view.visible = true;
    timer = 0;
    win = place === 1;
    confetti = [];
    // Set here rather than per frame: a gradient fill is a texture, and
    // rebuilding one 60 times a second to say the same thing would be
    // paying for the look over and over.
    titleMain.style.fill = win ? goldFill : steelFill;

    // Speed lines are struck once at the moment of crossing and then only
    // travel outward -- re-rolling them per frame reads as static noise
    // rather than as the screen being blown apart.
    lines = [];
    const spokes = win ? 46 : 26;
    for (let i = 0; i < spokes; i++) {
      lines.push({
        ang: (Math.PI * 2 / spokes) * i + Math.random() * 0.12,
        near: 40 + Math.random() * 120,
        len: 120 + Math.random() * 420,
        w: 2 + Math.random() * (win ? 7 : 4),
      });
    }

    // Lightning, struck once with the same beat as the speed lines --
    // fewer, cooler-toned forks for a loss than the bright branching
    // burst a win gets, same grade split the rest of this effect draws
    // in. Each origin is offset a little from dead centre so a handful
    // of bolts struck at once do not read as one star pattern.
    boltShapes = [];
    const boltCount = win ? 7 : 3;
    for (let i = 0; i < boltCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 260 + Math.random() * 360;
      const x0 = (Math.random() - 0.5) * 80, y0 = (Math.random() - 0.5) * 60;
      const x1 = x0 + Math.cos(ang) * dist, y1 = y0 + Math.sin(ang) * dist;
      const pts = boltPath(x0, y0, x1, y1, 6, win ? 46 : 30);
      let branch = null;
      if (Math.random() < 0.7) {
        const bi = 2 + ((Math.random() * (pts.length - 4)) | 0);
        const [bx, by] = pts[bi];
        const bAng = ang + (Math.random() - 0.5) * 1.4;
        const bDist = dist * (0.25 + Math.random() * 0.3);
        branch = boltPath(bx, by, bx + Math.cos(bAng) * bDist, by + Math.sin(bAng) * bDist, 3, 20);
      }
      boltShapes.push({ pts, branch, w: 1.6 + Math.random() * 1.6, delay: Math.random() * 0.05 });
    }

    if (!win) return;
    const palette = [0xffffff, 0xffd64a, 0xffe9a8, 0x111111, 0xff8a5c, 0x7fe0ff];
    for (let i = 0; i < 150; i++) {
      confetti.push({
        x: Math.random() * screenW,
        y: screenH * 0.42 + (Math.random() - 0.5) * 60,
        vx: (Math.random() - 0.5) * 300,
        vy: -260 - Math.random() * 300,
        size: 5 + Math.random() * 9,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 9,
        color: palette[(Math.random() * palette.length) | 0],
        delay: Math.random() * 0.35,
      });
    }
  }

  function reset() {
    active = false;
    view.visible = false;
    confetti = [];
    lines = [];
    boltShapes = [];
    under.clear();
    bolts.clear();
    banner.clear();
    over.clear();
    titleMain.text = '';
    titleSub.text = '';
  }

  function update(dt, screenW, screenH) {
    if (!active) return;
    timer += dt;
    const t = timer;
    const cx = screenW / 2, cy = screenH / 2;
    under.clear();
    bolts.clear();
    banner.clear();
    over.clear();

    // --- grade -------------------------------------------------------
    // A win opens on a white blow-out; a loss closes in instead, so the
    // two are told apart before a word is legible.
    if (win) {
      const flash = Math.max(0, 1 - t * 3.4);
      if (flash > 0) under.rect(0, 0, screenW, screenH).fill({ color: 0xffffff, alpha: 0.85 * flash });
    } else {
      under.rect(0, 0, screenW, screenH)
        .fill({ color: 0x05070a, alpha: Math.min(0.5, t * 0.55) });
    }

    // Vignette: four inward bands rather than a radial gradient, which
    // Graphics has no cheap way to draw. Stays up under the result card.
    const vig = Math.min(1, t * 1.6) * (win ? 0.42 : 0.62);
    const band = Math.min(screenH, screenW) * 0.30;
    const edge = win ? 0x1a1206 : 0x05070a;
    for (let i = 0; i < 7; i++) {
      const a = vig * (0.06 + i * 0.03);
      const d = band * (1 - i / 7);
      under.rect(0, 0, screenW, d).fill({ color: edge, alpha: a });
      under.rect(0, screenH - d, screenW, d).fill({ color: edge, alpha: a });
      under.rect(0, 0, d, screenH).fill({ color: edge, alpha: a });
      under.rect(screenW - d, 0, d, screenH).fill({ color: edge, alpha: a });
    }

    // --- speed lines -------------------------------------------------
    const lineLife = Math.max(0, 1 - t / 0.85);
    if (lineLife > 0) {
      const travel = easeOut(Math.min(1, t / 0.85)) * 620;
      for (const s of lines) {
        const cosA = Math.cos(s.ang), sinA = Math.sin(s.ang);
        const n = s.near + travel, f = n + s.len * lineLife;
        const nx = -sinA * s.w * lineLife, ny = cosA * s.w * lineLife;
        under.poly([
          cx + cosA * n + nx, cy + sinA * n + ny,
          cx + cosA * f, cy + sinA * f,
          cx + cosA * n - nx, cy + sinA * n - ny,
        ]).fill({ color: win ? 0xfff3c4 : 0x8e99a4, alpha: 0.5 * lineLife });
      }
    }

    // --- lightning -----------------------------------------------------
    // Struck once, same instant as the speed lines, and gone well before
    // the banner arrives -- an accent on the impact, not a sustained
    // effect. Each bolt is drawn twice, a wide soft glow pass then a
    // thin bright core, the same two-pass trick the boost flame's and
    // contact sparks' textures already lean on for "hot at the centre".
    const boltLife = Math.max(0, 1 - t / 0.34);
    if (boltLife > 0 && boltShapes.length) {
      const core = win ? 0xf2ffff : 0xd7e6ee;
      const glow = win ? 0x9fe8ff : 0x6f8fa8;
      const punch = Math.max(0, 1 - t / 0.10);
      const drawPath = (pts) => {
        bolts.moveTo(cx + pts[0][0], cy + pts[0][1]);
        for (let i = 1; i < pts.length; i++) bolts.lineTo(cx + pts[i][0], cy + pts[i][1]);
      };
      for (const b of boltShapes) {
        const strike = clamp01((t - b.delay) / 0.05);
        if (strike <= 0) continue;
        const alpha = boltLife * strike;
        drawPath(b.pts);
        bolts.stroke({ width: b.w * 3.2, color: glow, alpha: alpha * 0.35 * (0.6 + punch * 0.4), cap: 'round', join: 'round' });
        drawPath(b.pts);
        bolts.stroke({ width: b.w, color: core, alpha: alpha * (0.75 + punch * 0.25), cap: 'round', join: 'round' });
        if (b.branch) {
          drawPath(b.branch);
          bolts.stroke({ width: b.w * 2.4, color: glow, alpha: alpha * 0.28, cap: 'round', join: 'round' });
          drawPath(b.branch);
          bolts.stroke({ width: b.w * 0.75, color: core, alpha: alpha * 0.7, cap: 'round', join: 'round' });
        }
      }
    }

    // --- chequered banner --------------------------------------------
    // Sweeps in from the left, holds, then leaves before the result card
    // lands. The per-column vertical offset is a travelling sine: a flag
    // held out in the wind, not a painted stripe.
    const inT = phase(t, 0.10, 0.45);
    const outT = phase(t, 1.30, 0.35);
    const bannerAlpha = 1 - outT;
    if (bannerAlpha > 0.01) {
      const cell = Math.max(22, screenW / 13);
      const rows = 2;
      const bh = cell * rows;
      const by = screenH * 0.42 - bh / 2 + outT * -90;
      const cols = Math.ceil(screenW / cell) + 2;
      for (let i = 0; i < cols; i++) {
        // each column arrives slightly after the one to its left
        const col = clamp01((inT * (cols + 6) - i) / 6);
        if (col <= 0) continue;
        const x = i * cell;
        const wave = Math.sin(t * 5.5 - i * 0.55) * cell * 0.30 * col;
        const squash = 0.72 + 0.28 * col;
        for (let r = 0; r < rows; r++) {
          const dark = ((i + r) & 1) === 0;
          banner.rect(x, by + wave + r * cell * squash, cell + 1, cell * squash + 1)
            .fill({
              color: dark ? 0x0d1014 : 0xf4f6f8,
              alpha: bannerAlpha * (0.72 + 0.28 * col),
            });
        }
      }
    }

    // --- confetti ------------------------------------------------------
    if (confetti.length) {
      for (const p of confetti) {
        if (t < p.delay) continue;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy += 900 * dt; p.rot += p.vr * dt;
      }
      confetti = confetti.filter((p) => p.y < screenH + 90);
      for (const p of confetti) {
        if (t < p.delay) continue;
        const hw = p.size * 0.5, hh = p.size * 0.34;
        const cos = Math.cos(p.rot), sin = Math.sin(p.rot);
        over.poly([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
          .map(([x, y]) => [p.x + x * cos - y * sin, p.y + x * sin + y * cos])
          .flat()).fill({ color: p.color, alpha: 0.95 });
      }
    }

    // --- title ---------------------------------------------------------
    // Slams down from above and overshoots slightly, then the sub-line
    // wipes in under it. Both clear before the result card.
    const slam = phase(t, 0.15, 0.30);
    const fade = 1 - phase(t, 1.25, 0.30);
    const overshoot = Math.max(0, Math.sin(clamp01((t - 0.45) / 0.45) * Math.PI)) * 0.05;
    // The word is the same either way -- the grade, the sub-line and the
    // card that follows carry the result. A win/lose word here would just
    // say twice what the card says once.
    if (titleMain.text !== 'FINISH') titleMain.text = 'FINISH';
    titleMain.scale.set((3.2 - 2.2 * slam) * (1 + overshoot));
    titleMain.alpha = slam * fade;
    titleMain.position.set(cx, screenH * 0.42 - 150 * (1 - slam));

    const subT = phase(t, 0.55, 0.30);
    const wantSub = win ? 'CHEQUERED FLAG' : 'RACE OVER';
    if (titleSub.text !== wantSub) titleSub.text = wantSub;
    titleSub.style.fill = win ? 0xffd64a : 0x6d757d;
    titleSub.alpha = subT * fade;
    titleSub.position.set(cx, screenH * 0.42 + 62 + 16 * (1 - subT));
  }

  return { view, trigger, update, reset };
}
