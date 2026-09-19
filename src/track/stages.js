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
  /**
   * `dry` walks the same ops for their end position and heading alone,
   * emitting no points. That is what lets a layout with unknown lengths in
   * it be SOLVED for closure at build time (see buildStage3Path) instead of
   * carrying hand-fitted constants that silently stop closing the moment a
   * leg length is edited.
   */
  constructor(x, y, headingDeg, dry = false) {
    this.b = dry ? null : new PathBuilder();
    this.x = x;
    this.y = y;
    this.h = (headingDeg * Math.PI) / 180;
  }

  /** Straight run of `dist` world units along the current heading. */
  fwd(dist) {
    const nx = this.x + Math.cos(this.h) * dist;
    const ny = this.y + Math.sin(this.h) * dist;
    if (this.b) this.b.line(this.x, this.y, nx, ny, Math.max(4, Math.round(dist / 67)));
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
    if (this.b) this.b.wave(this.x, this.y, nx, ny, Math.max(20, Math.round(dist / 67)), amplitude, waves);
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
    if (this.b) this.b.arc(cx, cy, radius, a0, a1, Math.max(12, Math.round(arcLen / 56)));
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
 * Stage 3 -- a genuine mountain pass: a switchback climb, a ridge, a
 * hairpin descent and the valley road home.
 *
 * The layout this replaces was a boustrophedon of gentle S-waves joined by
 * 1000-radius U-turns. Nothing in it was tighter than ~520 radius, and at
 * this car's steering rates a 1000-radius corner is taken flat at ~590
 * speed -- so the "touge" had no corner the player ever had to brake for,
 * and the rival's drift, which only arms on a sustained corner, had almost
 * nothing to arm on. It read as a wide serpentine test track.
 *
 * What makes this one a pass instead:
 *
 * - Eight switchback hairpins (six climbing, two on the descent) with
 *   apexes of 330-450 radius. Those numbers come from the car, not from
 *   taste: the player's turn rate gives a grip radius of ~394 at speed 400
 *   and ~647 at 500, and a drift (driftMinSpeed 435 on this stage) tightens
 *   it to ~330 at 435. So a 330-390 apex is exactly the corner you have to
 *   brake to ~400 for, and can drift through if you commit -- which is the
 *   whole point of the stage.
 *
 * - Each hairpin is a COMPOUND corner (see `hairpin` below), not a single
 *   180 arc between two parallel straights. Two reasons, both structural.
 *   The angled entry and exit add their own perpendicular travel, so a 330
 *   apex still leaves ~1050 units between the two legs -- a plain 180 arc
 *   would need a 525 radius for the same spacing, which is no longer a
 *   hairpin. And every piece of it turns the same way with no straight in
 *   between, so the rival's long-curve detector (getLongCurveRamp in
 *   rival.js groups runs of same-signed turning and drops runs shorter than
 *   longCurveMinLen) reads one ~2000-unit corner rather than three short
 *   runs that each fail the test -- with straight legs the AI neither leans
 *   onto its line nor drifts at the hairpins at all.
 *
 * - One long valley straight home (~5300 units, kinked once so it reads as
 *   a road rather than a runway) so there is somewhere to spend the boost
 *   and somewhere to overtake.
 *
 * Closure is SOLVED at build time, not fitted by hand. Two of the lengths
 * (`A`, a due-south straight in the descent, and `B`, the due-west valley
 * road) are left free; every other op is fixed. The end position is affine
 * in both and the two are perpendicular, so walking the layout dry three
 * times gives a 2x2 system whose solution closes the loop exactly. Edit any
 * other leg and the two free lengths re-solve themselves -- the version of
 * this stage that this replaces carried hand-fitted constants, plus a
 * comment recording how many times they had to be re-swept by hand after
 * each change.
 *
 * Geometry is verified in stages.test.js rather than trusted: the loop
 * closes, no two stretches of road further apart along the route than one
 * corner complex come closer than the road's full visual swath
 * (2 * (roadHalf 190 + mountain bands 184) = 748), and the tightest radius
 * anywhere on the built path stays inside what the car can drive.
 */

/**
 * One switchback: a tight apex reached through a curved entry and exit
 * rather than off a straight. `entryDeg` and `approachDeg` are each applied
 * twice (in and out), so the apex itself turns 180 - 2*entryDeg -
 * 2*approachDeg and the whole compound still reverses the heading exactly.
 *
 * The `approach` arc is deliberately huge (3000 radius) and shallow: it is
 * the "straight" part of the corner, but drawn as a bend so the run of
 * same-signed turning is never broken -- see the note above about the
 * rival's corner detection.
 */
function hairpin(t, sign, { apex, entry = 600, entryDeg = 20, approach = 3000, approachDeg = 8 }) {
  const apexDeg = 180 - 2 * entryDeg - 2 * approachDeg;
  t.turn(entry, sign * entryDeg);
  t.turn(approach, sign * approachDeg);
  t.turn(apex, sign * apexDeg);
  t.turn(approach, sign * approachDeg);
  t.turn(entry, sign * entryDeg);
  return t;
}

// How far south of the start straight the valley road runs home. The
// closing hairpin's radius is exactly half of it, so that hairpin lands the
// route back on y = 0 and the run-in to the start line is dead straight.
const S3_VALLEY_DROP = 1250;
// Straight still behind index 0 when the grid is laid out, so the start is
// never on a corner.
const S3_RUN_IN = 900;

function stage3Layout(A, B, dry) {
  const t = new Turtle(0, 0, 0, dry);
  const L = -1, R = 1;

  // valley: the start/finish straight along the foot of the pass
  t.fwd(2500);

  // the climb: six switchbacks, alternating. An even count matters -- each
  // hairpin reverses the heading, so an odd number would leave the summit
  // pointing back down the mountain.
  hairpin(t, L, { apex: 360 });               t.fwd(1250);
  hairpin(t, R, { apex: 330, entryDeg: 24 }); t.fwd(900);
  hairpin(t, L, { apex: 390, entryDeg: 17 }); t.waveFwd(1750, 90);
  hairpin(t, R, { apex: 345 });               t.fwd(1000);
  hairpin(t, L, { apex: 370, entryDeg: 22 }); t.fwd(1450);
  hairpin(t, R, { apex: 335 });               t.fwd(1300);

  // summit ridge: over the crest and round onto the east face
  t.turn(820, -32); t.fwd(1250);
  t.turn(760, 32);  t.fwd(1100);
  t.turn(900, 90);                            // now heading south

  // descent: faster and flowing, with two switchbacks of its own.
  // Wave amplitudes are held down deliberately: a sine bend's own radius is
  // roughly (length / 2pi)^2 / amplitude, so 240 over 1500 units would be a
  // 240-radius flick -- tighter than any hairpin on the stage -- hiding
  // inside what reads on the map as a fast sweep. At 60 over 1500 it is a
  // ~950-radius bend, comfortably wider than the 800-1050 corners it sits
  // between. stages.test.js counts the sub-470 corners for exactly this
  // reason: a wave that goes tight shows up as a ninth hairpin.
  t.waveFwd(1500, 60);
  hairpin(t, L, { apex: 420, entryDeg: 16, entry: 700 });
  t.fwd(1150);
  hairpin(t, R, { apex: 450, entryDeg: 14, entry: 750 });
  t.fwd(A);                                   // FREE #1 -- due south
  t.turn(950, -48); t.fwd(1100);
  t.turn(1050, 48);
  t.waveFwd(1300, 45);
  t.turn(800, 90);                            // now heading west

  // the valley road home: the one long straight, kinked once near its east
  // end so it reads as a valley road, and so the rest of it clears the
  // start straight it runs parallel to
  t.fwd(B * 0.26);                            // FREE #2 -- due west
  t.turn(1500, -20); t.fwd(700); t.turn(1500, 20);
  t.fwd(B * 0.74);

  if (dry) return t;
  t.turn(S3_VALLEY_DROP / 2, 180);            // closing hairpin onto the start
  t.fwd(S3_RUN_IN);                           // run-in to the start line
  return t;
}

export function buildStage3Path() {
  // Solve the two free lengths so the pre-closing point lands exactly where
  // the closing hairpin needs it: S3_VALLEY_DROP south of the start line and
  // S3_RUN_IN west of it, heading west.
  const at = (a, b) => stage3Layout(a, b, true);
  const p00 = at(0, 0), p10 = at(1000, 0), p01 = at(0, 1000);
  const ax = (p10.x - p00.x) / 1000, ay = (p10.y - p00.y) / 1000;
  const bx = (p01.x - p00.x) / 1000, by = (p01.y - p00.y) / 1000;
  const det = ax * by - ay * bx;
  const tx = -S3_RUN_IN - p00.x, ty = S3_VALLEY_DROP - p00.y;
  const A = (tx * by - ty * bx) / det;
  const B = (ax * ty - ay * tx) / det;
  return stage3Layout(A, B, false).build(SPACING);
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
