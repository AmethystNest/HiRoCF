/**
 * The start / finish gate: a chequered bar spanning the road at the line,
 * with a post at each end. The painted chequer on the tarmac is easy to
 * miss at speed (it is only 78 units deep and the same grey-and-white as
 * everything else); a gate standing across it, drawn over the cars like any
 * other overhead structure, is what says "the line is here" from a long way
 * off, on the grid and again on the last straight.
 *
 * Drawn once into a Graphics -- nothing here changes per frame -- in the
 * world's own coordinates, rotated to the road's heading at the line.
 */
import { Container, Graphics } from '../pixi.js';

const BAR_DEPTH = 30;      // along the road
const SQUARE = 15;         // chequer square, half of BAR_DEPTH (two rows)
const POST_R = 34;

/**
 * @param path      the course (sample(), spacing)
 * @param roadHalf  half the road's width at the line
 * @param at        distance along the course the bar's middle sits at
 */
export function buildGantry(path, { roadHalf, at = path.spacing * 1.5 } = {}) {
  const s = path.sample(at);
  const g = new Graphics();
  const reach = roadHalf + 46;          // out past the kerb to the posts

  // everything below is laid out with +x along the bar (across the road)
  // and +y along the road, then the whole thing is rotated into place
  const bar = (dx, dy, alpha, color) => {
    g.rect(-reach + dx, -BAR_DEPTH / 2 + dy, reach * 2, BAR_DEPTH).fill({ color, alpha });
  };
  // soft shadow on the road, offset the way the other overheads' are
  bar(14, 16, 0.28, 0x000000);
  bar(8, 9, 0.22, 0x000000);
  // the bar: a frame, then two rows of chequer
  g.rect(-reach - 3, -BAR_DEPTH / 2 - 3, reach * 2 + 6, BAR_DEPTH + 6).fill({ color: 0x15171a });
  const cols = Math.ceil((reach * 2) / SQUARE);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 2; r++) {
      const light = (c + r) % 2 === 0;
      g.rect(-reach + c * SQUARE, -BAR_DEPTH / 2 + r * SQUARE, Math.min(SQUARE, reach * 2 - c * SQUARE), SQUARE)
        .fill({ color: light ? 0xf4f4f2 : 0x1c1e22 });
    }
  }
  // posts: shadow, red body, white ring, bright top
  for (const side of [-1, 1]) {
    const px = side * reach;
    g.circle(px + 12, 14, POST_R).fill({ color: 0x000000, alpha: 0.3 });
    g.circle(px, 0, POST_R).fill({ color: 0xc8261f });
    g.circle(px, 0, POST_R * 0.72).fill({ color: 0xf4f4f2 });
    g.circle(px, 0, POST_R * 0.5).fill({ color: 0xe0342c });
    g.circle(px - POST_R * 0.16, -POST_R * 0.18, POST_R * 0.2).fill({ color: 0xff9a90, alpha: 0.8 });
  }

  g.position.set(s.x, s.y);
  g.rotation = s.angle + Math.PI / 2;     // +x of the drawing runs across the road
  g.alpha = 0.94;
  const view = new Container();
  view.label = 'gantry';
  view.addChild(g);
  return view;
}
