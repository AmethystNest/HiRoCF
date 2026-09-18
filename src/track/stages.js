/**
 * Stage centreline definitions.
 *
 * Layouts are carried over from the Canvas build (they played well and were
 * collision-verified); what changes is that every path is now resampled to a
 * uniform spacing, so downstream spacing is even by construction.
 */
import { PathBuilder } from './path.js';

const SPACING = 26;

/**
 * Turtle-style course builder: carries exact position and heading, so a
 * course closes on its start point by construction instead of by
 * hand-solved trig. Stage 2's switchback grid was generated this way
 * offline; stage 4's crossing layout needs it inline, because there the
 * closure AND the crossing point both have to be exact -- a course that
 * crosses over itself has no margin for a few units of drift at the join.
 *
 * Step counts are derived from real distance (matching the ~56-67 world
 * units per authored point the hand-written stages use) rather than being
 * passed in, so a corner never silently becomes a polygon after resampling.
 *
 * Headings are in degrees, screen-space: 0 = +x (east), +90 = +y (south),
 * -90 = -y (north). `turn(r, deg)` with a negative angle turns left.
 */
class Turtle {
  constructor(x, y, headingDeg) {
    this.b = new PathBuilder();
    this.x = x;
    this.y = y;
    this.h = (headingDeg * Math.PI) / 180;
  }

  /** Straight run of `dist` world units along the current heading. */
  fwd(dist) {
    const nx = this.x + Math.cos(this.h) * dist;
    const ny = this.y + Math.sin(this.h) * dist;
    this.b.line(this.x, this.y, nx, ny, Math.max(4, Math.round(dist / 67)));
    this.x = nx;
    this.y = ny;
    return this;
  }

  /**
   * Straight run with a sine S-bend layered on. The bend fades to zero at
   * both ends (PathBuilder.wave), so the turtle's end position and heading
   * are exactly those of a plain fwd() -- an S-curve never affects closure.
   */
  waveFwd(dist, amplitude, waves = 1) {
    const nx = this.x + Math.cos(this.h) * dist;
    const ny = this.y + Math.sin(this.h) * dist;
    this.b.wave(this.x, this.y, nx, ny, Math.max(20, Math.round(dist / 67)), amplitude, waves);
    this.x = nx;
    this.y = ny;
    return this;
  }

  /** Circular turn of `deg` degrees at `radius`; negative turns left. */
  turn(radius, deg) {
    const rad = (deg * Math.PI) / 180;
    const sgn = Math.sign(deg);
    const centreAngle = this.h + (sgn * Math.PI) / 2;
    const cx = this.x + Math.cos(centreAngle) * radius;
    const cy = this.y + Math.sin(centreAngle) * radius;
    const a0 = Math.atan2(this.y - cy, this.x - cx);
    const a1 = a0 + rad;
    const arcLen = Math.abs(rad) * radius;
    this.b.arc(cx, cy, radius, a0, a1, Math.max(12, Math.round(arcLen / 56)));
    this.x = cx + Math.cos(a1) * radius;
    this.y = cy + Math.sin(a1) * radius;
    this.h += rad;
    return this;
  }

  build(spacing) {
    return this.b.build(spacing);
  }
}

export function buildStage1Path() {
  const L = -3400, R = 3400, T = -1500, B = 1500, CR = 520, TOP_MID = 350;
  return new PathBuilder()
    .line(-1700, B, R - CR, B, 64)
    .arc(R - CR, B - CR, CR, Math.PI / 2, 0, 18)
    .wave(R, B - CR, R, T + CR, 60, 145, 1)
    .arc(R - CR, T + CR, CR, 0, -Math.PI / 2, 18)
    .wave(R - CR, T, TOP_MID, T, 58, 150, 1)
    .bulge(TOP_MID, T, L + CR, T, 72, 430)
    .arc(L + CR, T + CR, CR, -Math.PI / 2, -Math.PI, 18)
    .wave(L, T + CR, L, B - CR, 60, -135, 1)
    .arc(L + CR, B - CR, CR, Math.PI, Math.PI / 2, 18)
    .line(L + CR, B, -1700, B, 22)
    .build(SPACING);
}

/**
 * City street loop, take 2: a plain 4-corner rectangle still reads as a
 * purpose-built circuit no matter how it's decorated, so three of the four
 * sides are routed through a "switchback" cluster -- a short lane, a tight
 * hairpin, another lane, another hairpin -- like a street that doubles back
 * on itself, before rejoining the main loop. This was generated and
 * validated offline (turtle-walked: forward/turn ops track exact position
 * and heading so the loop closes exactly, no hand-solved trig) rather than
 * hand-authored, specifically checking two things every corner and hairpin
 * must satisfy:
 *  - every turn radius stays well above roadHalf + the boundary bands'
 *    width (CR below), so the inside-of-turn edge of the pavement ribbon
 *    never pinches -- a tighter corner than that is what collapsed the
 *    kerb mesh in the very first version of this stage.
 *  - no two non-adjacent stretches of the loop pass closer than the road's
 *    full visual swath (both sides' bands, plus margin), so parallel
 *    switchback lanes never visually overlap each other or another part
 *    of the loop.
 * All three hairpin clusters use the same CR, so both rules reduce to one
 * constant.
 */
export function buildStage2Path() {
  const CR = 560; // safe margin over roadHalf(230) + city bands(168) = 398

  return new PathBuilder()
    .line(-1300, 1550, 1000, 1550, 38)
    .arc(1000, 990, CR, 1.571, 0.000, 18)
    .arc(2120, 990, CR, 3.142, 4.712, 18)
    .line(2120, 430, 2430, 430, 5)
    .arc(2430, -130, CR, 1.571, -1.571, 35)
    .line(2430, -690, 1810, -690, 10)
    .arc(1810, -1250, CR, 1.571, 4.712, 35)
    .line(1810, -1810, 2120, -1810, 5)
    .arc(2120, -2370, CR, 1.571, 0.000, 18)
    .line(2680, -2370, 2680, -3270, 15)
    .arc(2120, -3270, CR, 0.000, -1.571, 18)
    .line(2120, -3830, 920, -3830, 20)
    .arc(920, -3270, CR, -1.571, -3.142, 18)
    .line(360, -3270, 360, -2960, 5)
    .arc(-200, -2960, CR, 0.000, 3.142, 35)
    .line(-760, -2960, -760, -3580, 10)
    .arc(-1320, -3580, CR, 0.000, -3.142, 35)
    .line(-1880, -3580, -1880, -3270, 5)
    .arc(-2440, -3270, CR, 0.000, 1.571, 18)
    .line(-2440, -2710, -3640, -2710, 20)
    .arc(-3640, -2150, CR, -1.571, -3.142, 18)
    .line(-4200, -2150, -4200, -1850, 5)
    .arc(-3640, -1850, CR, 3.142, 1.571, 18)
    .line(-3640, -1290, -3454, -1290, 3)
    .arc(-3454, -730, CR, -1.571, 1.571, 35)
    .line(-3454, -170, -3640, -170, 3)
    .arc(-3640, 390, CR, -1.571, -3.142, 18)
    .line(-4200, 390, -4200, 990, 10)
    .arc(-3640, 990, CR, -3.142, -4.712, 18)
    .line(-3640, 1550, -1300, 1550, 39)
    .build(SPACING);
}

/**
 * Touge pass: a serpentine backbone, not a peripheral ring around an empty
 * middle (that was the first version of this course -- it read fine on
 * the minimap but left the whole interior of the loop unused). Four
 * S-curved "shelves" run alternately east and west, each one flipped into
 * the next by a single 180deg hairpin turn (not the self-contained
 * detour-and-restore hairpin stage 2 uses -- here every connector must
 * flip the heading, since that's what makes consecutive shelves run
 * opposite directions and climb together instead of doubling back over
 * themselves), so the road itself occupies the area a ring course would
 * have left empty in the middle. A return spine -- two big sweeping
 * corners around a short straight -- brings it back to the start along
 * one edge, well clear of the shelf stack's own footprint.
 *
 * Each shelf's S-curve is a TRUE symmetric weave: forward legs alternate
 * equally between +bend and -bend heading, so the lateral push cancels
 * exactly. An earlier version only ever drove at heading 0 or +bend
 * (never -bend) -- net heading still came back to 0, but every forward
 * leg's perpendicular component pushed the same direction, so each shelf
 * silently drifted ~1400 units off its nominal line, which is what caused
 * a self-intersection no amount of corner-radius or buffer tuning could
 * fix, because the drift itself was the actual bug.
 *
 * Generated and validated offline the same way as the rest of this
 * session's courses -- every corner/hairpin radius checked against
 * roadHalf + the mountain preset's band width, and no two non-adjacent
 * stretches of the loop allowed closer than the road's full visual swath
 * -- EXCEPT the very first pass at this validator had a real bug: its
 * spatial grid used a 300-unit cell with a 3x3 neighbour search, which
 * only reliably finds conflicts up to a few hundred units apart, nowhere
 * near the ~898-unit MIN_SEP it was supposed to be checking against. It
 * reported this course clear when it measurably wasn't, which is exactly
 * what let the guardrail ribbon visibly cross itself at more than one
 * hairpin. Fixed by sizing the grid cell to MIN_SEP itself (provably
 * sufficient for a 3x3 search to catch every pair within that distance),
 * which is what should have been done from the start rather than a
 * plausible-looking magic number. Re-run against the corrected check,
 * this course's shelf pitch (2x HP) had to grow again, from 1560 all the
 * way to 2000, and the return spine's radius from 1500 to 1800, before
 * every stretch actually cleared -- both were swept automatically over a
 * range of candidates rather than hand-tuned, picking the smallest-area
 * option that came back fully clear.
 *
 * The start/finish point is exactly where shelf 1 begins, not padded
 * further out with its own straight first: the return spine's two same-
 * sign 90deg turns cancel their own X contribution exactly regardless of
 * radius, so they always land back at shelf 1's own start point, not
 * anywhere further away -- padding the nominal start out past that left a
 * gap only closeable by reversing back through it, which showed up as a
 * sharp cusp in the road right before the finish line. The closing
 * segment is a plain few-unit straight because of that, not a mistake.
 */
export function buildStage3Path() {
  const CR = 520;  // safe margin over roadHalf(190) + mountain bands(184) = 374
  const HP = 1000;  // shelf-to-shelf hairpin radius (lane pitch = 2*HP = 2000)
  const BIG = 1800; // return-spine sweepers -- see comment above

  return new PathBuilder()
    .arc(-700, 3520, CR, -1.571, -0.908, 7)
    .line(-380, 3110, -65, 3356, 7)
    .arc(255, 2947, CR, 2.234, 0.908, 14)
    .line(576, 3356, 891, 3110, 7)
    .arc(1211, 3520, CR, -2.234, -0.908, 14)
    .line(1531, 3110, 1846, 3356, 7)
    .arc(2166, 2947, CR, 2.234, 0.908, 14)
    .line(2487, 3356, 2802, 3110, 7)
    .arc(3122, 3520, CR, -2.234, -0.908, 14)
    .line(3442, 3110, 3757, 3356, 7)
    .arc(4077, 2947, CR, 2.234, 0.908, 14)
    .line(4398, 3356, 4713, 3110, 7)
    .arc(5033, 3520, CR, -2.234, -1.571, 7)
    .line(5033, 3000, 5333, 3000, 5)
    .arc(5333, 4000, HP, -1.571, 1.571, 63)
    .arc(5333, 4480, CR, 1.571, 2.269, 7)
    .line(4999, 4878, 4692, 4621, 7)
    .arc(4358, 5020, CR, -0.873, -2.269, 15)
    .line(4024, 4621, 3717, 4878, 7)
    .arc(3383, 4480, CR, 0.873, 2.269, 15)
    .line(3049, 4878, 2742, 4621, 7)
    .arc(2408, 5020, CR, -0.873, -2.269, 15)
    .line(2074, 4621, 1768, 4878, 7)
    .arc(1433, 4480, CR, 0.873, 2.269, 15)
    .line(1099, 4878, 793, 4621, 7)
    .arc(458, 5020, CR, -0.873, -2.269, 15)
    .line(124, 4621, -182, 4878, 7)
    .arc(-517, 4480, CR, 0.873, 1.571, 7)
    .line(-517, 5000, -817, 5000, 5)
    .arc(-817, 6000, HP, -1.571, -4.712, 63)
    .arc(-817, 7520, CR, -1.571, -0.908, 7)
    .line(-496, 7110, -181, 7356, 7)
    .arc(139, 6947, CR, 2.234, 0.908, 14)
    .line(459, 7356, 774, 7110, 7)
    .arc(1094, 7520, CR, -2.234, -0.908, 14)
    .line(1415, 7110, 1730, 7356, 7)
    .arc(2050, 6947, CR, 2.234, 0.908, 14)
    .line(2370, 7356, 2685, 7110, 7)
    .arc(3005, 7520, CR, -2.234, -0.908, 14)
    .line(3326, 7110, 3641, 7356, 7)
    .arc(3961, 6947, CR, 2.234, 0.908, 14)
    .line(4281, 7356, 4596, 7110, 7)
    .arc(4916, 7520, CR, -2.234, -1.571, 7)
    .line(4916, 7000, 5216, 7000, 5)
    .arc(5216, 8000, HP, -1.571, 1.571, 63)
    .arc(5216, 8480, CR, 1.571, 2.304, 8)
    .line(4868, 8866, 4571, 8599, 7)
    .arc(4223, 8985, CR, -0.838, -2.304, 15)
    .line(3875, 8599, 3578, 8866, 7)
    .arc(3230, 8480, CR, 0.838, 2.304, 15)
    .line(2882, 8866, 2585, 8599, 7)
    .arc(2237, 8985, CR, -0.838, -2.304, 15)
    .line(1889, 8599, 1592, 8866, 7)
    .arc(1244, 8480, CR, 0.838, 2.304, 15)
    .line(896, 8866, 599, 8599, 7)
    .arc(251, 8985, CR, -0.838, -2.304, 15)
    .line(-97, 8599, -395, 8866, 7)
    .arc(-743, 8480, CR, 0.838, 1.571, 8)
    .line(-743, 9000, -1043, 9000, 5)
    .arc(-1043, 7200, BIG, 1.571, 3.142, 57)
    .line(-2843, 7200, -2843, 4800, 40)
    .arc(-1043, 4800, BIG, 3.142, 4.712, 57)
    .line(-1043, 3000, -700, 3000, 6)
    .build(SPACING);
}


/**
 * Stage 4 — metropolitan elevated expressway that crosses over itself.
 *
 * Shape: a big outer ring (long straights, 2100-radius sweepers, high-speed
 * S-bends) with an inner elevated loop threaded through the middle of it.
 * The route enters that inner loop on an elevated deck, runs it as a raised
 * ring, comes back down, and then passes UNDER its own entry viaduct on the
 * way out -- one genuine grade separation, at a right angle, both passes
 * being live road the player and rival actually drive.
 *
 * That crossing is what the deckIds/zLevels metadata on TrackPath exists
 * for: the two passes share an XY, so everything that asks "where am I on
 * the route" has to ask locally rather than globally. The earlier layout
 * only ever marked deck levels along a route that never actually overlapped
 * itself, so nothing was exercising that. See TrackPath.nearestLocal and
 * the hint plumbing in PlayerCar/RivalCar/Progress; without those, a car
 * reaching the crossing snaps onto the other deck's centreline and its
 * wall, racing line and lap progress all jump to the wrong stretch.
 *
 * Built with the Turtle above rather than hand-written coordinates. At a
 * crossing there is no slack: the loop has to close exactly AND the two
 * passes have to intersect where intended, and the previous layout's
 * hand-solved coordinates were already at the limit of what was checkable
 * by eye. Segment separation is asserted by the course test rather than
 * trusted -- the road's full visual swath is 2*(roadHalf 360 + bands 104)
 * = 928 units wide, so any two non-adjacent stretches closer than that
 * would overlap on screen.
 *
 * Turtle log (screen space, +y is south; left turns are negative):
 *   start (-7900, 6400) heading east
 *   fwd 5700          south side, west half
 *   turn L 1000       onto the entry viaduct
 *   fwd 3000          entry viaduct north  <-- crossed later at y=3400
 *   turn R 1000       into the inner loop
 *   fwd 2800 / L / fwd 2000 / L / fwd 5800 / L / fwd 4000 / L
 *                     inner elevated ring, clockwise on screen
 *   fwd 3600          exit road east       <-- passes UNDER x=-1200
 *   turn R 1000 / fwd 1000 / turn L 1000
 *                     back down onto the south side
 *   fwd 4100 / turn L 2100
 *   waveFwd 8600      east side
 *   turn L 2100
 *   waveFwd 14400     north side, the long one
 *   turn L 2100
 *   waveFwd 8600      west side
 *   turn L 2100       closes exactly on the start point
 */
export function buildStage4Path() {
  const R = 2100; // outer sweepers
  const r = 1000; // inner-loop and ramp corners

  const path = new Turtle(-7900, 6400, 0)
    .fwd(5700)          // south side, west half
    .turn(r, -90)       // climb onto the entry viaduct
    .fwd(3000)          // entry viaduct, northbound  (crossing at y = 3400)
    .turn(r, 90)        // right, into the inner loop
    .fwd(2800)          // inner loop, south side
    .turn(r, -90)
    .fwd(2000)          // inner loop, east side
    .turn(r, -90)
    .fwd(5800)          // inner loop, north side
    .turn(r, -90)
    .fwd(4000)          // inner loop, west side
    .turn(r, -90)
    .fwd(3600)          // exit road, eastbound  (passes under x = -1200)
    .turn(r, 90)        // right, back toward the south side
    .fwd(1000)
    .turn(r, -90)
    .fwd(4100)          // south side, east half
    .turn(R, -90)       // south-east sweeper
    .waveFwd(8600, 420) // east side
    .turn(R, -90)       // north-east sweeper
    .waveFwd(14400, 520, 2) // north side -- the long one
    .turn(R, -90)       // north-west sweeper
    .waveFwd(8600, -420)    // west side
    .turn(R, -90)       // south-west sweeper, closes on the start point
    .build(SPACING);

  // Deck levels. The inner loop is the elevated ring: the route climbs onto
  // it just before the entry viaduct, stays up for the whole ring, and comes
  // back down on the last inner corner -- so the exit road is at ground
  // level by the time it reaches the crossing and passes underneath.
  // Fractions come from the measured layout (see the course test, which
  // asserts the crossing falls inside the elevated range on one pass and
  // the ground range on the other).
  path.setLayerRange(0.000, 0.066, 0, 0); // ground: south side, west half
  path.setLayerRange(0.066, 0.086, 1, 1); // ascent onto the viaduct
  path.setLayerRange(0.086, 0.345, 1, 2); // elevated: viaduct + inner ring
  path.setLayerRange(0.345, 0.370, 1, 1); // descent off the ring
  path.setLayerRange(0.370, 1.000, 0, 0); // ground: exit road (under the
                                          // viaduct) and the whole outer ring

  // Tunnel on the long north straight, well inside it so neither fade
  // reaches the sweepers at either end.
  path.setTunnelRange(0.60, 0.65);
  return path;
}

export const STAGE_PATHS = {
  1: buildStage1Path,
  2: buildStage2Path,
  3: buildStage3Path,
  4: buildStage4Path,
};
