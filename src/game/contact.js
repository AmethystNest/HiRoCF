/**
 * The contact record a car carries for the effects layer to read.
 *
 * Written by whoever resolves the contact -- player.js for the barrier,
 * race.js's resolveContacts for car-on-car -- and cleared once a frame by
 * main.js before any of them run, so a record left over from last frame
 * can never be drawn twice. Read by render/contactfx.js and by nothing
 * else: none of it feeds back into the simulation.
 *
 * `nx`/`ny` point FROM the car's centre INTO whatever it hit, so sparks
 * spray along -n (away from the surface) plus backwards along the car's
 * travel, which is the direction an abrasion actually throws them.
 */
export function makeContact() {
  return { impact: false, scrape: false, x: 0, y: 0, nx: 0, ny: 0, force: 0 };
}

/** Start-of-frame reset. Position and normal are left alone: they only
 *  mean anything while one of the flags is up, and keeping them saves
 *  writing six fields a frame for every car. */
export function clearContact(c) {
  if (!c) return;
  c.impact = false;
  c.scrape = false;
  c.force = 0;
}

/** Record a contact, keeping the hardest one if a car manages two in the
 *  same frame (barrier and rival at once, say). */
export function setContact(c, { impact, x, y, nx, ny, force }) {
  if (!c) return;
  const stronger = force >= c.force;
  c.impact = c.impact || impact;
  c.scrape = true;
  if (stronger) {
    c.x = x;
    c.y = y;
    c.nx = nx;
    c.ny = ny;
    c.force = force;
  }
}
