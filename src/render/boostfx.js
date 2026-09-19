/**
 * Boost exhaust flame -- three tapered layers per exhaust (blue outer, pale
 * blue-white mid, orange core), all flat polygons. Colour scheme matches the
 * reference build (blue outer / orange inner) by request; unlike the
 * reference build's two flat triangles, an extra mid layer plus additive
 * blending on the inner two layers gives the flame some depth without
 * introducing the round glow blobs/particles that were tried and rejected.
 *
 * The view is pinned to the player and rotated the same way as the car
 * sprite every frame, so the exhaust always sits at the rear regardless of
 * heading -- same convention as the reference build's local (ex, 46)
 * placement, just carried in Pixi's own transform instead of manual
 * screen-space math.
 */
import { Container, Graphics } from '../pixi.js';

// Lateral exhaust spacing as a fraction of the vehicle's own width, so a
// wider vehicle's pipes sit under its body rather than inside its centre
// line. 14/70 and 15/74 are the player's and the car rivals' original
// pixel offsets, unchanged.
const PLAYER_EXHAUST_SPREAD = 14 / 70;
const RIVAL_EXHAUST_SPREAD = 15 / 74;

export function buildBoostFlame() {
  const view = new Container();

  // Outer flame: normal blend, so it reads as a solid blue tongue rather
  // than washing out over bright road/kerb textures.
  const outerGfx = new Graphics();
  view.addChild(outerGfx);

  // Mid + core: additive blend for a bit of glow where they overlap the
  // outer layer, without any separate glow shape of their own.
  const innerGfx = new Graphics();
  innerGfx.blendMode = 'add';
  view.addChild(innerGfx);

  function reset() {
    outerGfx.clear();
    innerGfx.clear();
  }

  /**
   * @param car   anything with x, y, angle, boosting (PlayerCar)
   * @param s     worldScale (1/zoom) -- converts the effect's screen-pixel
   *              authoring sizes into world units, same convention used
   *              everywhere else cars/effects are sized in this file.
   * @param size  the vehicle's drawn {w, h} in screen pixels. The flame was
   *              pinned 45px behind centre, which is the rear of a 98-tall
   *              car and the MIDDLE of stage 4's 318-tall box truck -- an
   *              exhaust plume coming out of the side of a trailer. It is
   *              measured off the vehicle now; 0.46 * 98 is the same 45 the
   *              cars had, so nothing about them changes.
   */
  function update(car, s, size = { w: 70, h: 98 }) {
    view.position.set(car.x, car.y);
    // Follow the visible chassis angle, not only the travel/heading angle.
    // During a drift the body is yawed by driftVisualAngle, so the exhaust
    // must rotate with that rear end for both player and rival cars.
    view.rotation = car.angle + Math.PI / 2 + (car.driftVisualAngle || 0);
    outerGfx.clear();
    innerGfx.clear();
    if (!car.boosting) return;

    const flicker = 1 + Math.random() * 0.3;
    const spread = (car?.constructor?.name === 'PlayerCar' ? PLAYER_EXHAUST_SPREAD : RIVAL_EXHAUST_SPREAD) * size.w;
    for (const ex of [-spread, spread]) {
      const x = ex * s;
      const base = size.h * 0.46 * s;

      const outerTip = base + 36 * flicker * s;
      outerGfx.poly([x - 5.5 * s, base, x, outerTip, x + 5.5 * s, base])
        .fill({ color: 0x84d8ff, alpha: 0.80 });

      const midTip = base + s + 27 * flicker * s;
      innerGfx.poly([x - 3.6 * s, base + s, x, midTip, x + 3.6 * s, base + s])
        .fill({ color: 0xcdefff, alpha: 0.55 });

      const coreTip = base + 2 * s + 16 * flicker * s;
      innerGfx.poly([x - 2 * s, base + 2 * s, x, coreTip, x + 2 * s, base + 2 * s])
        .fill({ color: 0xff9f3a, alpha: 0.95 });
    }
  }

  return { view, update, reset };
}
