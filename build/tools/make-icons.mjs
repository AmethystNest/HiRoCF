/**
 * Draws the PWA icons into build/pwa/icons/ (committed; build/pwa.mjs only
 * copies them). Run with `node build/tools/make-icons.mjs` after changing
 * this file or the car picture in build/pwa/icon-src/car.png.
 *
 * The picture: the player's car (white, seen from above) driving up the road
 * at 35 degrees, on a dark asphalt band edged with red and white kerbs, a
 * red glow under it, and the HiRoCF wordmark in the title's colours. The
 * maskable icon has no wordmark and a smaller car, so nothing that matters
 * sits outside the central 66% that a round or squircle mask leaves.
 *
 * Text is set in whatever bold sans fontconfig finds (Liberation Sans here);
 * it is drawn once, here, so builds never depend on the machine's fonts.
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(root, 'build/pwa/icons');
mkdirSync(OUT, { recursive: true });
const CAR = join(root, 'build/pwa/icon-src/car.png');

const ANGLE = 35;     // degrees clockwise from straight up

/** Background: charcoal, the road band with its kerbs, and (optionally) the wordmark. */
function backgroundSvg(size, { wordmark }) {
  const s = size / 512;
  const band = 250 * s, kerb = 22 * s, stripe = 34 * s;
  const cx = size / 2, cy = size * (wordmark ? 0.46 : 0.5);
  const len = size * 2;
  const word = wordmark
    ? `<text x="${cx}" y="${size * 0.925}" text-anchor="middle" font-family="Liberation Sans, DejaVu Sans, Arial, sans-serif"
         font-weight="900" font-size="${size * 0.13}" letter-spacing="${size * 0.004}"
         stroke="#000" stroke-width="${size * 0.012}" stroke-linejoin="round" paint-order="stroke"
         ><tspan fill="#fff">Hi</tspan><tspan fill="#ff3b30">R</tspan><tspan fill="#fff">o</tspan><tspan fill="#ff3b30">CF</tspan></text>`
    : '';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0" stop-color="#3a3e45"/><stop offset="1" stop-color="#0d0e10"/>
    </radialGradient>
    <pattern id="kerb" width="${stripe * 2}" height="${stripe * 2}" patternUnits="userSpaceOnUse">
      <rect width="${stripe * 2}" height="${stripe}" fill="#e0342c"/>
      <rect y="${stripe}" width="${stripe * 2}" height="${stripe}" fill="#f4f4f2"/>
    </pattern>
    <linearGradient id="road" x1="0" x2="1">
      <stop offset="0" stop-color="#1b1d21"/><stop offset=".5" stop-color="#26292e"/><stop offset="1" stop-color="#1b1d21"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)"/>
  <g transform="rotate(${ANGLE} ${cx} ${cy})">
    <rect x="${cx - band / 2 - kerb}" y="${cy - len / 2}" width="${kerb}" height="${len}" fill="url(#kerb)"/>
    <rect x="${cx + band / 2}" y="${cy - len / 2}" width="${kerb}" height="${len}" fill="url(#kerb)"/>
    <rect x="${cx - band / 2}" y="${cy - len / 2}" width="${band}" height="${len}" fill="url(#road)"/>
    <rect x="${cx - band / 2 + 6 * s}" y="${cy - len / 2}" width="${3 * s}" height="${len}" fill="#f4f4f2" opacity=".85"/>
    <rect x="${cx + band / 2 - 9 * s}" y="${cy - len / 2}" width="${3 * s}" height="${len}" fill="#f4f4f2" opacity=".85"/>
    ${Array.from({ length: 16 }, (_, i) => `<rect x="${cx - 2.5 * s}" y="${cy - len / 2 + i * 64 * s}" width="${5 * s}" height="${30 * s}" fill="#f4f4f2" opacity=".55"/>`).join('')}
  </g>
  ${word}
</svg>`);
}

async function icon(size, name, { wordmark, carShare, lift = 0 }) {
  const bg = await sharp(backgroundSvg(size, { wordmark })).png().toBuffer();
  const carH = Math.round(size * carShare);
  const car = await sharp(CAR).resize({ height: carH }).png().toBuffer();
  const rot = await sharp(car).rotate(ANGLE, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const meta = await sharp(rot).metadata();
  // the car's shadow: its own outline, black, blurred, dropped a little; and a red glow
  const shadow = await sharp(rot).modulate({ brightness: 0 }).blur(size * 0.014).png().toBuffer();
  const glow = await sharp(rot).tint({ r: 255, g: 40, b: 30 }).blur(size * 0.045).png().toBuffer();
  const left = Math.round((size - meta.width) / 2);
  const top = Math.round((size - meta.height) / 2 - lift * size);
  const d = Math.round(size * 0.012);
  await sharp(bg)
    .composite([
      { input: glow, left, top: top + d },
      { input: shadow, left: left + d, top: top + d * 2 },
      { input: rot, left, top },
    ])
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, name));
  console.log(name, size);
}

await icon(512, 'icon-512.png', { wordmark: true, carShare: 0.6, lift: 0.045 });
await icon(192, 'icon-192.png', { wordmark: true, carShare: 0.6, lift: 0.045 });
await icon(180, 'apple-touch-icon.png', { wordmark: true, carShare: 0.6, lift: 0.045 });
await icon(512, 'maskable-512.png', { wordmark: false, carShare: 0.5 });
