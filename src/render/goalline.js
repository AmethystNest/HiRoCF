/**
 * The start / finish line as light: a glowing bar across the road with a
 * highlight that runs along it now and then.
 *
 * The painted chequer on the tarmac is only 78 units deep and the same
 * grey-and-white as everything around it, so it disappears at speed. A line
 * of light on the ground reads from far down the straight, on the grid and
 * again on the last lap, and -- being laid on the road and drawn under the
 * cars, additively -- it never hides anything.
 *
 * Two sprites with generated textures (nothing is a picture); the only
 * per-frame work is two alphas and one position.
 */
import { Container, Sprite, Texture } from '../pixi.js';

const BAR_THICK = 210;       // world units across the glow (the white core is ~1/6 of it)
const SHEEN_LEN = 380;       // the travelling highlight, along the bar
const SHEEN_PERIOD = 2.8;    // seconds between passes
const SHEEN_TRAVEL = 1.5;    // seconds a pass takes

/** Soft bar: bright thin core, wide gold falloff, faded out toward both ends. */
function makeBarTexture() {
  const W = 512, H = 96;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const v = x.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0.00, 'rgba(255,196,64,0)');
  v.addColorStop(0.30, 'rgba(255,196,64,0.22)');
  v.addColorStop(0.40, 'rgba(255,214,110,0.6)');
  v.addColorStop(0.44, 'rgba(255,246,214,0.98)');
  v.addColorStop(0.47, 'rgba(255,255,255,1)');
  v.addColorStop(0.53, 'rgba(255,255,255,1)');
  v.addColorStop(0.56, 'rgba(255,246,214,0.98)');
  v.addColorStop(0.60, 'rgba(255,214,110,0.6)');
  v.addColorStop(0.70, 'rgba(255,196,64,0.22)');
  v.addColorStop(1.00, 'rgba(255,196,64,0)');
  x.fillStyle = v;
  x.fillRect(0, 0, W, H);
  // fade the two ends so the bar does not stop dead at the kerb
  x.globalCompositeOperation = 'destination-in';
  const h = x.createLinearGradient(0, 0, W, 0);
  h.addColorStop(0.00, 'rgba(0,0,0,0)');
  h.addColorStop(0.10, 'rgba(0,0,0,1)');
  h.addColorStop(0.90, 'rgba(0,0,0,1)');
  h.addColorStop(1.00, 'rgba(0,0,0,0)');
  x.fillStyle = h;
  x.fillRect(0, 0, W, H);
  return Texture.from(c);
}

/** The highlight: the same cross-section, bright in the middle along its length too. */
function makeSheenTexture() {
  const W = 128, H = 96;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const v = x.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0.00, 'rgba(255,255,255,0)');
  v.addColorStop(0.36, 'rgba(255,255,255,0.35)');
  v.addColorStop(0.50, 'rgba(255,255,255,1)');
  v.addColorStop(0.64, 'rgba(255,255,255,0.35)');
  v.addColorStop(1.00, 'rgba(255,255,255,0)');
  x.fillStyle = v;
  x.fillRect(0, 0, W, H);
  x.globalCompositeOperation = 'destination-in';
  const h = x.createLinearGradient(0, 0, W, 0);
  h.addColorStop(0.0, 'rgba(0,0,0,0)');
  h.addColorStop(0.5, 'rgba(0,0,0,1)');
  h.addColorStop(1.0, 'rgba(0,0,0,0)');
  x.fillStyle = h;
  x.fillRect(0, 0, W, H);
  return Texture.from(c);
}

let barTexture = null, sheenTexture = null;

/**
 * @param path      the course (sample(), spacing)
 * @param roadHalf  half the road's width at the line
 * @param at        distance along the course the line sits at
 * @returns {{ view: Container, update(dt: number): void }}
 */
export function buildGoalLine(path, { roadHalf, at = path.spacing * 1.5 } = {}) {
  barTexture ||= makeBarTexture();
  sheenTexture ||= makeSheenTexture();
  const s = path.sample(at);
  const reach = roadHalf + 40;                 // a little past the kerb

  const view = new Container();
  view.label = 'goalline';
  view.position.set(s.x, s.y);
  view.rotation = s.angle + Math.PI / 2;       // +x of the children runs across the road

  const bar = new Sprite(barTexture);
  bar.anchor.set(0.5);
  bar.width = reach * 2;
  bar.height = BAR_THICK;
  bar.blendMode = 'add';
  view.addChild(bar);

  const sheen = new Sprite(sheenTexture);
  sheen.anchor.set(0.5);
  sheen.width = SHEEN_LEN;
  sheen.height = BAR_THICK * 0.8;
  sheen.blendMode = 'add';
  sheen.alpha = 0;
  view.addChild(sheen);

  // never the same beat at every stage's start
  let t = Math.random() * SHEEN_PERIOD;

  return {
    view,
    update(dt) {
      t += dt;
      bar.alpha = 0.82 + 0.18 * Math.sin(t * 3.2);
      const p = (t % SHEEN_PERIOD) / SHEEN_TRAVEL;
      if (p < 1) {
        sheen.x = -reach + (reach * 2) * p;
        sheen.alpha = Math.sin(Math.PI * p);
      } else {
        sheen.alpha = 0;
      }
    },
  };
}
