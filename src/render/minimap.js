/**
 * Fixed-to-screen course minimap, top-right corner -- ported from the
 * reference Canvas build's `drawMiniMap()`, same box layout and same bounds
 * math (course bbox padded by roadHalf, uniform scale to fit the box).
 *
 * The Canvas build redrew the whole outline every frame because it shared
 * one 2D context with the rest of the scene. Here the static geometry (road
 * footprint, centreline, start marker, direction arrow) is built once into a
 * cached Graphics object; only the two position dots move each frame.
 */
import { Container, Graphics, Text } from '../pixi.js';

const BOX_W = 132, BOX_H = 92, PAD = 8, MARGIN = 12, TOP = 44;

export function buildMiniMap(path, cfg) {
  const holder = new Container();
  holder.label = 'minimap';

  const bg = new Graphics()
    .rect(0, 0, BOX_W, BOX_H).fill({ color: 0x000000, alpha: 0.36 })
    .rect(0.5, 0.5, BOX_W - 1, BOX_H - 1).stroke({ width: 1, color: 0xffffff, alpha: 0.18 });
  holder.addChild(bg);

  // --- course bounds, including road width, in box-local space ---
  const roadHalf = cfg.roadHalf;
  const pts = path.points;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  minX -= roadHalf; maxX += roadHalf;
  minY -= roadHalf; maxY += roadHalf;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((BOX_W - PAD * 2) / spanX, (BOX_H - PAD * 2) / spanY);
  const ox = (BOX_W - spanX * scale) / 2 - minX * scale;
  const oy = (BOX_H - spanY * scale) / 2 - minY * scale;
  const toBox = (p) => [ox + p[0] * scale, oy + p[1] * scale];

  // --- static road footprint + centreline ---
  const track = new Graphics();
  track.moveTo(...toBox(pts[0]));
  for (let i = 1; i <= pts.length; i++) track.lineTo(...toBox(pts[i % pts.length]));
  track.stroke({ width: Math.max(3, roadHalf * 2 * scale), color: 0x73787d, alpha: 0.92, cap: 'round', join: 'round' });

  track.moveTo(...toBox(pts[0]));
  for (let i = 1; i <= pts.length; i++) track.lineTo(...toBox(pts[i % pts.length]));
  track.stroke({ width: 1, color: 0xffffff, alpha: 0.58 });

  // --- start/finish marker + direction arrow ---
  const [sx, sy] = toBox(pts[0]);
  track.rect(sx - 2.5, sy - 2.5, 5, 5).fill({ color: 0xffffff });

  const [tx, ty] = toBox(pts[6 % pts.length]);
  let dx = tx - sx, dy = ty - sy;
  const dl = Math.hypot(dx, dy) || 1;
  dx /= dl; dy /= dl;
  const ax = sx + dx * 12, ay = sy + dy * 12;
  track.moveTo(sx, sy).lineTo(ax, ay).stroke({ width: 1.5, color: 0xffffff });
  track.poly([
    ax, ay,
    ax - dx * 5 - dy * 3, ay - dy * 5 + dx * 3,
    ax - dx * 5 + dy * 3, ay - dy * 5 - dx * 3,
  ]).fill({ color: 0xffffff });

  holder.addChild(track);

  const labelStyle = { fontFamily: 'Arial, sans-serif', fontWeight: '900', fontSize: 10 };
  const mapLabel = new Text({ text: 'MAP', style: { ...labelStyle, fill: 0xffffff } });
  mapLabel.position.set(8, 5);
  holder.addChild(mapLabel);

  const rivalLabel = new Text({ text: 'RIVAL', style: { ...labelStyle, fill: 0xff4a4a } });
  rivalLabel.position.set(BOX_W - 8, 5);
  rivalLabel.anchor.set(1, 0);
  holder.addChild(rivalLabel);

  const rivalDot = new Graphics().circle(0, 0, 3.2).fill({ color: 0xff4a4a }).stroke({ width: 1.1, color: 0x000000, alpha: 0.75 });
  holder.addChild(rivalDot);

  const playerDot = new Graphics().circle(0, 0, 4.5).fill({ color: 0xffffff }).stroke({ width: 1.3, color: 0x000000, alpha: 0.75 });
  holder.addChild(playerDot);

  return {
    view: holder,
    /** Reposition against the current screen size, then move the two dots. */
    update(screenW, player, rival) {
      holder.position.set(screenW - BOX_W - MARGIN, TOP);
      playerDot.position.set(ox + player.x * scale, oy + player.y * scale);
      rivalDot.position.set(ox + rival.x * scale, oy + rival.y * scale);
    },
  };
}
