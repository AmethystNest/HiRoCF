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
 * the line. Lap fractions, since the course is generated -- 0.000 to ~0.082
 * is the gt_circuit road sector.
 *
 * `fromCentre` throughout: these are positioned against the centreline, not
 * the surface edge, because the whole point is a fixed distance off a road
 * whose painted edge is the same all the way down this sector anyway.
 */
function gpVenue() {
  const out = [];
  const at = (i, step, from) => from + i * step;
  // outside: a continuous bank of stands behind a crowd fence
  for (let i = 0; i < 8; i++) {
    out.push({ name: 'grandstand', at: at(i, 0.0105, 0.004), side: 1, lateral: 560, fromCentre: true, force: true });
  }
  for (let i = 0; i < 12; i++) {
    out.push({ name: 'crowd_fence', at: at(i, 0.0068, 0.003), side: 1, lateral: 424, fromCentre: true, force: true });
  }
  // inside: pit wall, then the garages behind it
  for (let i = 0; i < 12; i++) {
    out.push({ name: 'pitwall_barrier', at: at(i, 0.0068, 0.003), side: -1, lateral: 400, fromCentre: true, force: true });
  }
  for (let i = 0; i < 6; i++) {
    out.push({
      name: i % 2 ? 'pit_tent_red' : 'pit_tent_blue',
      at: at(i, 0.0135, 0.008), side: -1, lateral: 530, fromCentre: true, force: true,
    });
  }
  // lighting rigs down both sides, offset from each other
  for (let i = 0; i < 4; i++) {
    out.push({ name: 'floodlight', at: at(i, 0.021, 0.006), side: 1, lateral: 670, fromCentre: true, force: true });
    out.push({ name: 'floodlight', at: at(i, 0.021, 0.016), side: -1, lateral: 670, fromCentre: true, force: true });
  }
  // the line itself
  out.push({ name: 'podium_stage', at: 0.020, side: -1, lateral: 650, fromCentre: true, force: true });
  out.push({ name: 'marshal_tower', at: 0.002, side: -1, lateral: 640, fromCentre: true, force: true });
  out.push({ name: 'broadcast_camera_tower', at: 0.036, side: 1, lateral: 640, fromCentre: true, force: true });
  out.push({ name: 'racing_billboard', at: 0.055, side: 1, lateral: 470, fromCentre: true, force: true });
  out.push({ name: 'racing_billboard', at: 0.068, side: -1, lateral: 470, fromCentre: true, force: true });
  return out;
}

export const LAYOUTS = {
  1: {
    // Stage 1 runs counter-clockwise from the start/finish on the bottom
    // straight. side +1 is the outside of the loop, -1 the infield.
    sections: [
      { from: 0.00, to: 0.24, theme: 'grandstand' },  // pit straight
      { from: 0.24, to: 0.30, theme: 'runoff' },      // turn 1
      { from: 0.30, to: 0.39, theme: 'forest' },      // right-hand S
      { from: 0.39, to: 0.44, theme: 'runoff' },      // turn 2
      { from: 0.44, to: 0.57, theme: 'paddock' },     // top straight
      { from: 0.57, to: 0.74, theme: 'open' },        // big sweeper
      { from: 0.74, to: 0.80, theme: 'runoff' },      // turn 3
      { from: 0.80, to: 0.92, theme: 'forest' },      // left-hand S
      { from: 0.92, to: 1.00, theme: 'runoff' },      // final corner
    ],
    landmarks: [
      // start / finish -- the painted chequer on the road surface (built in
      // surfaces.js) is the actual start line. A gantry sprite was tried
      // here too, but the source art is a solid flat banner with no gap
      // under the arch, so it just sat on the road looking like the car
      // was driving over a mat rather than passing under a structure.
      { name: 'podium_stage', at: 0.021, side: -1, lateral: 35 },
      { name: 'marshal_hut', at: 0.012, side: -1, lateral: 20 },

      // pit wall down the inside of the main straight
      { name: 'pitwall_barrier', at: 0.040, side: -1, lateral: 10 },
      { name: 'pitwall_barrier', at: 0.068, side: -1, lateral: 10 },
      { name: 'pitwall_barrier', at: 0.096, side: -1, lateral: 10 },
      { name: 'pitwall_barrier', at: 0.124, side: -1, lateral: 10 },
      { name: 'pit_tent_red', at: 0.052, side: -1, lateral: 45 },
      { name: 'pit_tent_blue', at: 0.082, side: -1, lateral: 45 },
      { name: 'pit_tent_red', at: 0.112, side: -1, lateral: 45 },
      { name: 'tow_vehicle', at: 0.148, side: -1, lateral: 40 },
      { name: 'ambulance', at: 0.168, side: -1, lateral: 40 },

      // main grandstands on the outside of the pit straight
      { name: 'grandstand', at: 0.055, side: 1, lateral: -236, scale: 1.1 },
      { name: 'grandstand', at: 0.105, side: 1, lateral: -236, scale: 1.1 },
      { name: 'grandstand', at: 0.155, side: 1, lateral: -236, scale: 1.1 },
      { name: 'broadcast_camera_tower', at: 0.031, side: 1, lateral: 40 },
      { name: 'racing_billboard', at: 0.078, side: 1, lateral: 28 },
      { name: 'racing_billboard', at: 0.132, side: 1, lateral: 28 },

      // (timing gantry at the top straight dropped for the same reason as
      // the start gantry above)
      { name: 'marshal_tower', at: 0.470, side: 1, lateral: 45 },
      { name: 'marshal_tower', at: 0.285, side: 1, lateral: 45 },
      { name: 'marshal_tower', at: 0.770, side: -1, lateral: 45 },
    ],
    // large soft ground patches that stop the infield reading as flat lawn
    patches: { count: 90, textures: ['patch_dirt', 'patch_dry', 'patch_dark'] },
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
