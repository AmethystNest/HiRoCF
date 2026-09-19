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
 *   0.00  impact   -- flash, radial speed lines blown out from the centre
 *   0.10  banner   -- a chequered band sweeps across and holds, waving
 *   0.15  title    -- FINISH slams down from above and settles
 *   1.30  clear    -- title and banner leave, vignette stays under the card
 *
 * Win and lose share the staging and differ in grade: gold and bright with
 * confetti off the banner, or cold and closing-in with the screen pinched
 * to a letterbox.
 */
import { Container, Graphics, Text } from '../pixi.js';

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
  const banner = new Graphics();     // chequered flag, behind the title
  const over = new Graphics();       // confetti, in front of everything
  view.addChild(under);
  view.addChild(banner);

  const titleMain = new Text({
    text: '', style: {
      fontFamily: 'Arial, sans-serif', fontWeight: '900', fontSize: 72,
      fill: 0xffffff, letterSpacing: 4,
      stroke: { color: 0x05070a, width: 9, join: 'round' },
    },
  });
  titleMain.anchor.set(0.5);
  view.addChild(titleMain);

  const titleSub = new Text({
    text: '', style: {
      fontFamily: 'Arial, sans-serif', fontWeight: '900', fontSize: 17,
      fill: 0xffe470, letterSpacing: 7,
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

  function trigger(place, screenW, screenH) {
    active = true;
    view.visible = true;
    timer = 0;
    win = place === 1;
    confetti = [];

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
    under.clear();
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
    titleMain.style.fill = win ? 0xffffff : 0xaeb6bd;
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
