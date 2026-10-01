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
 *   0.00  impact   -- flash, two thin shock rings widening off the car and
 *                     (a win) a scatter of four-point glints
 *   0.10  banner   -- a chequered band sweeps across and holds, waving
 *   0.15  title    -- FINISH slams down from above and settles
 *   1.30  clear    -- title and banner leave, vignette stays under the card
 *
 * Win and lose share the staging and differ in grade: gold and bright with
 * confetti off the banner, or cold and closing-in with the screen pinched
 * to a letterbox.
 */
import { Container, FillGradient, Graphics, Text } from '../pixi.js';

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

  const under = new Graphics();      // grade, behind everything
  const burst = new Graphics();      // rings and glints, over the grade, under the banner
  const banner = new Graphics();     // chequered flag, behind the title
  const over = new Graphics();       // confetti, in front of everything
  view.addChild(under);
  view.addChild(burst);
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
  let glints = [];

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

    // Glints are placed once and only twinkle in place: re-rolling them per
    // frame would read as noise, not as light catching the chrome.
    glints = [];
    if (win) {
      for (let i = 0; i < 16; i++) {
        glints.push({
          x: screenW * (0.06 + Math.random() * 0.88),
          y: screenH * (0.10 + Math.random() * 0.62),
          size: 10 + Math.random() * 18,
          delay: 0.08 + Math.random() * 0.6,
          life: 0.45 + Math.random() * 0.35,
          gold: Math.random() < 0.55,
        });
      }
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
    glints = [];
    under.clear();
    burst.clear();
    banner.clear();
    over.clear();
    titleMain.text = '';
    titleSub.text = '';
  }

  function update(dt, screenW, screenH) {
    if (!active) return;
    timer += dt;
    const t = timer;
    const cx = screenW / 2;
    under.clear();
    burst.clear();
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

    // --- shock rings ---------------------------------------------------
    // Two thin rings off the car (the camera holds the winner a little
    // below centre), each a soft wide pass under a fine bright core. They
    // thin as they widen and are gone in under a second -- the impact as a
    // clean shape rather than a spray of lines.
    const ringY = screenH * 0.6;
    const reach = Math.hypot(screenW, screenH) * 0.62;
    const ringHue = win ? { core: 0xfff6d6, glow: 0xffd45a } : { core: 0xd7e1ea, glow: 0x6f8aa3 };
    for (let k = 0; k < (win ? 2 : 1); k++) {
      const p = clamp01((t - 0.02 - k * 0.14) / 0.95);
      if (p <= 0 || p >= 1) continue;
      const r = easeOut(p) * reach * (1 - k * 0.22);
      const fade = (1 - p) * (1 - p);
      burst.circle(cx, ringY, r).stroke({ width: 5 + 22 * (1 - p), color: ringHue.glow, alpha: 0.22 * fade });
      burst.circle(cx, ringY, r).stroke({ width: 1 + 2.4 * (1 - p), color: ringHue.core, alpha: 0.85 * fade });
    }

    // --- glints ----------------------------------------------------------
    // Four-point stars that swell and shrink in place, a pale halo star
    // behind a bright one.
    for (const g of glints) {
      const p = (t - g.delay) / g.life;
      if (p <= 0 || p >= 1) continue;
      const k = Math.sin(Math.PI * p);
      const r = g.size * k;
      const star = (rad, pinch) => {
        const pts = [];
        for (let i = 0; i < 8; i++) {
          const ang = (Math.PI / 4) * i - Math.PI / 2;
          const rr = i % 2 === 0 ? rad : rad * pinch;
          pts.push(g.x + Math.cos(ang) * rr, g.y + Math.sin(ang) * rr);
        }
        return pts;
      };
      burst.poly(star(r * 1.7, 0.12)).fill({ color: g.gold ? 0xffd45a : 0xbfeaff, alpha: 0.28 * k });
      burst.poly(star(r, 0.16)).fill({ color: 0xffffff, alpha: 0.95 * k });
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
