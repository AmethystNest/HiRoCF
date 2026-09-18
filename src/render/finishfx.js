/**
 * Finish-line celebration -- ported from the reference Canvas build's
 * `triggerFinishFX`/`updateFinishFX`/`drawFinishCelebration`: checkered
 * bars, falling confetti, and a distinct win/lose treatment (bright flash +
 * radial burst + rings for a win; darkening shutters + red diagonal slashes
 * for a loss), plus the big WIN!/LOSE title.
 *
 * Screen-fixed, like the minimap -- added directly to app.stage so it draws
 * over the world regardless of camera rotation/zoom.
 */
import { Container, Graphics, Text } from '../pixi.js';

export function buildFinishFX() {
  const view = new Container();
  view.label = 'finishfx';
  view.visible = false;

  const gfx = new Graphics();
  view.addChild(gfx);

  const titleMain = new Text({
    text: '', style: {
      fontFamily: 'Arial, sans-serif', fontWeight: '900', fontSize: 58,
      fill: 0xffffff, stroke: { color: 0x000000, width: 5 },
    },
  });
  titleMain.anchor.set(0.5);
  view.addChild(titleMain);

  const titleSub = new Text({
    text: '', style: {
      fontFamily: 'Arial, sans-serif', fontWeight: '900', fontSize: 20,
      fill: 0xffe470, letterSpacing: 2,
    },
  });
  titleSub.anchor.set(0.5);
  view.addChild(titleSub);

  let active = false;
  let win = true;
  let timer = 0;
  let flash = 0;
  let confetti = [];

  function trigger(place, screenW, screenH) {
    active = true;
    view.visible = true;
    timer = 0;
    win = place === 1;
    flash = win ? 1 : 0;
    confetti = [];
    const count = win ? 130 : 24;
    const palette = win
      ? [0xffffff, 0x111111, 0xf2d14a, 0xff6b4a, 0x79d7ff, 0x7dff9b]
      : [0x15181b, 0x272c31, 0x3a4046, 0x6a2b2b];
    for (let i = 0; i < count; i++) {
      confetti.push({
        x: Math.random() * screenW,
        y: -20 - Math.random() * screenH * 0.45,
        vx: (Math.random() - 0.5) * (win ? 240 : 110),
        vy: 80 + Math.random() * (win ? 340 : 180),
        size: 5 + Math.random() * (win ? 9 : 5),
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * (win ? 7 : 4),
        color: palette[(Math.random() * palette.length) | 0],
      });
    }
  }

  function reset() {
    active = false;
    view.visible = false;
    confetti = [];
    gfx.clear();
    titleMain.text = '';
    titleSub.text = '';
  }

  function update(dt, screenW, screenH) {
    if (!active) return;
    timer += dt;
    flash = Math.max(0, flash - dt * 1.8);

    for (const p of confetti) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 280 * dt; p.rot += p.vr * dt;
    }
    confetti = confetti.filter((p) => p.y < screenH + 80 && p.x > -80 && p.x < screenW + 80);

    const t = timer;
    const cx = screenW / 2, cy = screenH * 0.64;
    gfx.clear();

    // checkered celebration bars, top and bottom
    const barH = 18, cell = 28;
    const cols = Math.ceil(screenW / cell) + 1;
    for (let band = 0; band < 2; band++) {
      const y = band === 0 ? 0 : screenH - barH;
      for (let i = 0; i < cols; i++) {
        gfx.rect(i * cell, y, cell, barH).fill({ color: ((i + band) & 1) ? 0x111111 : 0xffffff });
      }
    }

    // confetti pieces
    for (const p of confetti) {
      const hw = p.size * 0.5, hh = p.size * 0.35;
      const cos = Math.cos(p.rot), sin = Math.sin(p.rot);
      const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
        .map(([x, y]) => [p.x + x * cos - y * sin, p.y + x * sin + y * cos])
        .flat();
      gfx.poly(corners).fill({ color: p.color, alpha: 0.95 });
    }

    if (win) {
      if (flash > 0) gfx.rect(0, 0, screenW, screenH).fill({ color: 0xffffff, alpha: 0.36 * flash });

      const burstR = 70 + Math.min(220, t * 210);
      const rays = 18;
      for (let i = 0; i < rays; i++) {
        const alpha = Math.max(0, 0.34 - t * 0.1);
        if (alpha <= 0) continue;
        const ang = (Math.PI * 2 / rays) * i + t * 0.9;
        const pts = [[0, -18], [26, -burstR], [-26, -burstR]]
          .map(([x, y]) => [cx + x * Math.cos(ang) - y * Math.sin(ang), cy + x * Math.sin(ang) + y * Math.cos(ang)])
          .flat();
        gfx.poly(pts).fill({ color: (i & 1) ? 0xffe470 : 0xffffff, alpha });
      }

      for (let i = 0; i < 3; i++) {
        const rr = 56 + i * 28 + t * 120;
        const alpha = Math.max(0, 0.42 - i * 0.09 - t * 0.11);
        if (alpha <= 0) continue;
        gfx.circle(cx, cy, rr).stroke({ width: 6 - i * 1.2, color: i === 0 ? 0xffffff : 0xffd64a, alpha });
      }
    } else {
      const darkAlpha = Math.min(0.46, 0.12 + t * 0.18);
      gfx.rect(0, 0, screenW, screenH).fill({ color: 0x000000, alpha: darkAlpha });

      const bar = Math.min(screenH * 0.12, 18 + t * 34);
      gfx.rect(0, 0, screenW, bar).fill({ color: 0x080a0c, alpha: 0.92 });
      gfx.rect(0, screenH - bar, screenW, bar).fill({ color: 0x080a0c, alpha: 0.92 });

      const slashAlpha = Math.max(0, 0.42 - t * 0.09);
      if (slashAlpha > 0) {
        const sweep = (t * 170) % (screenW + 180) - 90;
        for (let i = -2; i < 5; i++) {
          const x = sweep + i * 110;
          gfx.moveTo(x, -20).lineTo(x - 150, screenH + 20)
            .stroke({ width: 5, color: 0x732626, alpha: slashAlpha });
        }
      }

      const rr = 90 + Math.min(110, t * 65);
      const ringAlpha = Math.max(0, 0.30 - t * 0.08);
      if (ringAlpha > 0) gfx.circle(cx, cy, rr).stroke({ width: 3, color: 0x505862, alpha: ringAlpha });
    }

    const titleScale = win
      ? 1 + Math.max(0, Math.sin(t * 12)) * 0.03 + Math.max(0, 0.18 - t * 0.06)
      : 1 + Math.max(0, 0.12 - t * 0.08);
    const loseDrop = win ? 0 : Math.max(0, 42 - t * 115);

    titleMain.text = win ? 'WIN!' : 'LOSE';
    titleMain.style.fill = win ? 0xffffff : 0x9aa0a6;
    titleMain.scale.set(titleScale);
    titleMain.position.set(screenW / 2, screenH * 0.25 + loseDrop);

    titleSub.text = win ? 'VICTORY' : 'DEFEAT';
    titleSub.style.fill = win ? 0xffe470 : 0x747b82;
    titleSub.position.set(screenW / 2, screenH * 0.25 + loseDrop + 40 * titleScale);
  }

  return { view, trigger, update, reset };
}
