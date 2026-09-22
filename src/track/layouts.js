/**
 * Per-stage decoration layouts.
 *
 * Sections are expressed as fractions of the lap so they line up with the
 * track's actual features (pit straight, sweeper, hairpin…) rather than being
 * split into equal slices. Landmarks are explicit one-off placements that get
 * priority over the themed scatter.
 */

/**
 * Stage 5's start/finish venue: stands and lighting down the outside of the
 * pit straight, the pit wall and garages down the inside, and the podium at
 * the line.
 *
 * Laid out in WORLD UNITS from the start line (`atDist`, negative before
 * it), not lap fractions, because what the venue has to fit inside is a
 * length of road, not a share of the lap. The straight it stands on runs
 * from about -500 (out of the last corner) to +3040 (into the first city
 * junction), and the viaduct comes down across it at +2160, so there are
 * roughly 2600 usable units. The first version of this was spaced in lap
 * fractions over 0.003-0.082, which on an 88,945-unit lap is 7,300 units
 * -- nearly three times the straight. Everything past the end of it landed
 * on the junctions and the corners beyond, which is what had grandstands
 * standing in the middle of the road.
 *
 * Positions run past the end of the straight on purpose. Nothing here is
 * exempt from buildProps' road test any more (see `force` there), so a
 * candidate that would sit on any carriageway is simply dropped, and the
 * row fills exactly as much of the straight as there is. That is also why
 * each band passes its own `reachPad`: these are 'face' props, whose width
 * runs ALONG the road once rotated, so the default max(w,h)/2 stands in
 * for a depth toward the road they do not have, and would reject the whole
 * venue.
 *
 * The laterals have very little room to move in. Below about 443 from the
 * centreline the road test rejects the prop (the player can reach it);
 * above about 540 it is outside the camera's own half-width at this
 * stage's zoom, so it is placed, costs draw time, and is never seen. Only
 * the tallest structures sit further out, because their art extends AWAY
 * from the road from a base that stays inside that window.
 *
 * `fromCentre` throughout: these are positioned against the centreline, not
 * the surface edge, because the whole point is a fixed distance off a road
 * whose painted edge is the same all the way down this sector anyway.
 */
function gpVenue() {
  const out = [];
  const row = (name, count, from, step, props) => {
    for (let i = 0; i < count; i++) out.push({ ...props, name, atDist: from + i * step });
  };
  const band = (side, lateral, reachPad) => ({
    side, lateral, reachPad, fromCentre: true, force: true,
  });

  // outside: a crowd fence at the trackside, a bank of stands behind it
  row('crowd_fence', 7, -420, 560, band(1, 470, 30));
  row('grandstand', 4, -300, 940, band(1, 560, 90));
  // inside: pit wall at the trackside, garages behind it
  row('pitwall_barrier', 7, -420, 560, band(-1, 460, 30));
  row('pit_tent_blue', 3, -200, 960, band(-1, 590, 60));
  row('pit_tent_red', 3, 280, 960, band(-1, 590, 60));
  // lighting rigs down both sides, offset from each other
  row('floodlight', 3, -260, 1000, band(1, 660, 50));
  row('floodlight', 3, 240, 1000, band(-1, 660, 50));
  // the line itself
  out.push({ name: 'marshal_tower', atDist: -330, ...band(-1, 640, 50) });
  out.push({ name: 'podium_stage', atDist: 150, ...band(-1, 620, 60) });
  out.push({ name: 'broadcast_camera_tower', atDist: 700, ...band(1, 650, 50) });
  out.push({ name: 'racing_billboard', atDist: 1150, ...band(-1, 520, 60) });
  out.push({ name: 'racing_billboard', atDist: 1900, ...band(1, 520, 60) });
  return out;
}

export const LAYOUTS = {
  1: {
    // Stage 1 runs counter-clockwise from the start/finish on the bottom
    // straight. side +1 is the outside of the loop, -1 the infield.
    // Fractions below are read back off the built path (see S1 and
    // stage1Layout in track/stages.js) -- the lap is 36,800 units, about
    // twice the 18,960 it was, with one big 180-degree curve at the top of
    // a spur off the top straight.
    sections: [
      { from: 0.000, to: 0.181, theme: 'grandstand' },  // pit straight
      { from: 0.181, to: 0.215, theme: 'runoff' },      // turn 1
      { from: 0.215, to: 0.324, theme: 'forest' },      // right-hand S
      { from: 0.324, to: 0.356, theme: 'runoff' },      // turn 2
      { from: 0.356, to: 0.433, theme: 'paddock' },     // top straight
      { from: 0.433, to: 0.470, theme: 'runoff' },      // kink out to the spur
      { from: 0.470, to: 0.526, theme: 'open' },        // up the spur
      { from: 0.526, to: 0.611, theme: 'runoff' },      // the big curve
      { from: 0.611, to: 0.676, theme: 'open' },        // back down the spur
      { from: 0.676, to: 0.712, theme: 'runoff' },      // kink back in
      { from: 0.712, to: 0.773, theme: 'paddock' },     // back straight
      { from: 0.773, to: 0.805, theme: 'runoff' },      // turn 3
      { from: 0.805, to: 0.915, theme: 'forest' },      // left-hand S
      { from: 0.915, to: 0.945, theme: 'runoff' },      // final corner
      { from: 0.945, to: 1.000, theme: 'grandstand' },  // into the line
    ],
    landmarks: [
      // start / finish -- the painted chequer on the road surface (built in
      // surfaces.js) is the actual start line. A gantry sprite was tried
      // here too, but the source art is a solid flat banner with no gap
      // under the arch, so it just sat on the road looking like the car
      // was driving over a mat rather than passing under a structure.
      //
      // Everything on the pit straight keeps the distance from the line it
      // had on the 18,960-unit lap (old fraction x 0.515); the straight is
      // longer now, so one more grandstand and hoarding carry on past them.
      { name: 'podium_stage', at: 0.0108, side: -1, lateral: 35 },
      { name: 'marshal_hut', at: 0.0062, side: -1, lateral: 20 },

      // pit wall down the inside of the main straight
      { name: 'pitwall_barrier', at: 0.0206, side: -1, lateral: 10 },
      { name: 'pitwall_barrier', at: 0.0350, side: -1, lateral: 10 },
      { name: 'pitwall_barrier', at: 0.0494, side: -1, lateral: 10 },
      { name: 'pitwall_barrier', at: 0.0638, side: -1, lateral: 10 },
      { name: 'pit_tent_red', at: 0.0268, side: -1, lateral: 45 },
      { name: 'pit_tent_blue', at: 0.0422, side: -1, lateral: 45 },
      { name: 'pit_tent_red', at: 0.0577, side: -1, lateral: 45 },
      { name: 'tow_vehicle', at: 0.0762, side: -1, lateral: 40 },
      { name: 'ambulance', at: 0.0865, side: -1, lateral: 40 },

      // main grandstands on the outside of the pit straight
      { name: 'grandstand', at: 0.0283, side: 1, lateral: -236, scale: 1.1 },
      { name: 'grandstand', at: 0.0541, side: 1, lateral: -236, scale: 1.1 },
      { name: 'grandstand', at: 0.0798, side: 1, lateral: -236, scale: 1.1 },
      { name: 'grandstand', at: 0.1055, side: 1, lateral: -236, scale: 1.1 },
      { name: 'broadcast_camera_tower', at: 0.0160, side: 1, lateral: 40 },
      { name: 'racing_billboard', at: 0.0402, side: 1, lateral: 28 },
      { name: 'racing_billboard', at: 0.0680, side: 1, lateral: 28 },
      { name: 'racing_billboard', at: 0.1320, side: 1, lateral: 28 },

      // (timing gantry at the top straight dropped for the same reason as
      // the start gantry above)
      { name: 'marshal_tower', at: 0.212, side: 1, lateral: 45 },
      { name: 'marshal_tower', at: 0.400, side: 1, lateral: 45 },
      { name: 'marshal_tower', at: 0.568, side: 1, lateral: 45 },   // outside of the big curve
      { name: 'broadcast_camera_tower', at: 0.535, side: 1, lateral: 40 },
      { name: 'marshal_tower', at: 0.790, side: -1, lateral: 45 },
    ],
    // large soft ground patches that stop the infield reading as flat
    // lawn -- doubled with the lap, so the density stays what it was
    patches: { count: 180, textures: ['patch_dirt', 'patch_dry', 'patch_dark'] },
  },

  2: {
    // Ordinary city streets, not a circuit -- no marshal towers, no race-day
    // floodlights, no tow trucks/ambulances standing by, no painted kerb or
    // start chequer (surfaces.js: city preset has no kerb band and
    // paintStart:false). Every section uses the same 'street' theme;
    // corners get no special "runoff" treatment because a street corner
    // isn't a gravel trap. See buildStage2Path in track/stages.js for the
    // shape -- a grid of blocks joined by square junctions, with two places
    // where the route jogs a block over. side +1 is the outside of the
    // loop, -1 the infield, same convention as stage 1.
    //
    // Every `at` below is the MIDPOINT of one of the course's straight
    // blocks, read back off the built path rather than eyeballed, so
    // nothing lands on a junction where a stub or a parked car would sit
    // across the turn. The straights, by lap fraction, are
    // 0.00-0.12, 0.16-0.22, 0.26-0.31, 0.35-0.44, 0.47-0.62,
    // 0.66-0.71, 0.75-0.80, 0.84-0.94 and 0.97-1.00.
    sections: [
      { from: 0.00, to: 1.00, theme: 'street' },
    ],
    // Cross streets you can see but can't take -- a closed loop otherwise
    // has nothing beyond the kerb, which is what reads as a purpose-built
    // circuit no matter how it's decorated. Each stub is capped by a
    // barrier landmark at the same at/side, part way down it.
    sideStreets: [
      { at: 0.045, side: 1 },
      { at: 0.190, side: -1 },
      { at: 0.390, side: 1 },
      { at: 0.520, side: -1 },
      { at: 0.600, side: 1 },
      { at: 0.775, side: -1 },
      { at: 0.887, side: 1 },
    ],
    landmarks: [
      // Barriers blocking the side streets above -- placed well down each
      // stub (lateral 560, roughly 2/3 of the way along its 900-unit
      // length) rather than right at the mouth, so there's real visible
      // street with its own centreline before the closure, not a barrier
      // sitting in the junction. A cone a little further back reads as an
      // advance warning.
      { name: 'fence_panel', at: 0.045, side: 1, lateral: 560 },
      { name: 'concrete_barrier', at: 0.190, side: -1, lateral: 560 },
      { name: 'fence_panel', at: 0.390, side: 1, lateral: 560 },
      { name: 'concrete_barrier', at: 0.520, side: -1, lateral: 560 },
      { name: 'fence_panel', at: 0.600, side: 1, lateral: 560 },
      { name: 'concrete_barrier', at: 0.775, side: -1, lateral: 560 },
      { name: 'fence_panel', at: 0.887, side: 1, lateral: 560 },
      { name: 'cone', at: 0.047, side: 1, lateral: 500 },
      { name: 'cone', at: 0.192, side: -1, lateral: 500 },
      { name: 'cone', at: 0.392, side: 1, lateral: 500 },
      { name: 'cone', at: 0.522, side: -1, lateral: 500 },
      { name: 'cone', at: 0.602, side: 1, lateral: 500 },
      { name: 'cone', at: 0.777, side: -1, lateral: 500 },
      { name: 'cone', at: 0.889, side: 1, lateral: 500 },

      // Parked civilian traffic along the kerb -- plain generic cars, never
      // the rival roster, so the street doesn't look full of parked race
      // cars. lateral 140 was solved from measured world-space footprints,
      // not guessed: at this stage's worldScale the parked-car sprite is
      // ~211 wide (VEHICLE_PROPS draws them at 1.2x the player's own
      // width) and the player sprite itself is ~176 wide, so a player
      // hugging wallHalf(320) reaches out to 320 + 176/2 = 408 world units
      // -- but a world-unit gap barely above that (the first attempt, ~30
      // units) is only ~12 screen px at this zoom and still reads as
      // touching. lateral 140 puts a clearly visible gap on screen,
      // confirmed by placing the player at wallHalf next to one of these
      // cars and reading back both sprites' actual positions/widths; it
      // does put the car partly past the paved edge into the dirt-margin
      // texture, which is fine since the wall keeps the player from ever
      // reaching that spot anyway, and bushes/buildings already scatter
      // into that same zone.
      { name: 'car_civilian_white', at: 0.085, side: -1, lateral: 140 },
      { name: 'car_civilian_silver', at: 0.283, side: 1, lateral: 140 },
      { name: 'car_civilian_navy', at: 0.360, side: -1, lateral: 140 },
      { name: 'car_civilian_maroon', at: 0.425, side: 1, lateral: 140 },
      { name: 'car_civilian_white', at: 0.490, side: -1, lateral: 140 },
      { name: 'car_civilian_silver', at: 0.565, side: 1, lateral: 140 },
      { name: 'car_civilian_navy', at: 0.683, side: -1, lateral: 140 },
      { name: 'car_civilian_maroon', at: 0.845, side: 1, lateral: 140 },
      { name: 'car_civilian_white', at: 0.920, side: -1, lateral: 140 },
    ],
    patches: { count: 40, textures: ['patch_dirt', 'patch_dry', 'patch_dark'] },
  },

  3: {
    // Touge pass -- see buildStage3Path in track/stages.js for the shape
    // (a switchback climb of six hairpins, a ridge, two more hairpins down
    // the east face, and the valley road home). One theme ('touge':
    // guardrail hugging the shoulder, pine forest and rockface behind it)
    // for the whole lap is enough here -- unlike
    // stage 2's city grid, a mountain road doesn't need hand-placed
    // landmarks to read as a real place, and buildProps()'s own
    // reachability guard already keeps every scattered prop clear of the
    // road regardless of which of this course's many hairpins/S-curve
    // lanes ends up folded back nearby.
    sections: [
      { from: 0.00, to: 1.00, theme: 'touge' },
    ],
    patches: { count: 70, textures: ['patch_dirt', 'patch_dry', 'patch_dark'] },
  },

  4: {
    // Elevated metropolitan expressway. Dense urban backdrop but no trees,
    // runoff areas or race-circuit furniture.
    sections: [
      { from: 0.00, to: 1.00, theme: 'highway' },
    ],
    landmarks: [
      { name: 'plain_gantry', at: 0.075, side: 1, lateral: 40, scale: 1.05 },
      { name: 'plain_gantry', at: 0.315, side: -1, lateral: 40, scale: 1.05 },
      { name: 'plain_gantry', at: 0.565, side: 1, lateral: 40, scale: 1.05 },
      { name: 'plain_gantry', at: 0.815, side: -1, lateral: 40, scale: 1.05 },
    ],
    patches: { count: 28, textures: ['patch_dark', 'patch_dirt'] },
  },

  5: {
    // The last stage runs city streets, a tunnel, a switchback pass and an
    // expressway viaduct in one lap (see buildStage5Path), so unlike every
    // other stage it needs a different theme per sector rather than one for
    // the whole loop. The boundaries match the surface sectors in main.js:
    // a stretch of road dressed as a mountainside while it is still painted
    // as a city street reads as a mistake, not as a transition.
    sections: [
      { from: 0.000, to: 0.245, theme: 'street' },
      { from: 0.245, to: 0.520, theme: 'touge' },
      { from: 0.520, to: 1.000, theme: 'expressway_country' },
    ],
    // The grand-prix venue around the start/finish line, on top of the
    // gt_circuit road sector (see SURFACE_SECTORS_BY_STAGE in main.js).
    //
    // All of it is `force`d hand placement rather than a scatter theme, and
    // that is not a shortcut. buildProps rejects a prop whose centre lands
    // within playerReach + max(w, h) / 2 of ANY lane, and for a face-on
    // structure that radius is its span ALONG the road, not its depth
    // toward it -- half an 880-wide grandstand is 440, so a stand can never
    // be placed nearer than about 860 from the centreline however small its
    // `near` is. That is why the existing `grandstand` theme puts nothing on
    // a straight. Laid out by hand, each row sits in its own lateral band
    // (pit wall 400, stands 560, lighting 660) and is spaced wider than the
    // sprite it repeats, so skipping the overlap test costs nothing.
    landmarks: [
      ...gpVenue(),
      { name: 'plain_gantry', at: 0.560, side: 1, lateral: 40, scale: 1.05 },
      { name: 'plain_gantry', at: 0.600, side: -1, lateral: 40, scale: 1.05 },
    ],
    patches: { count: 60, textures: ['patch_dry', 'patch_dirt', 'patch_dark'] },
  },

};

export function sectionsForLap(layout, lapLength) {
  return (layout?.sections || []).map((s) => ({
    theme: s.theme,
    start: s.from * lapLength,
    end: s.to * lapLength,
  }));
}
