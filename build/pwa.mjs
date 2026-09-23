/**
 * The installable build: dist/ as a static site (a PWA) instead of one
 * self-contained HTML file.
 *
 *   node build/pwa.mjs              no stage music (safe to host publicly)
 *   node build/pwa.mjs --with-bgm   copies assets/bgm/stage<N>.mp3 in; for
 *                                   private hosting only (commercial tracks)
 *
 * What changes against build/index.standalone.html, and why:
 *
 *  - Images are files, not base64 inside the script. Base64 is a third
 *    bigger, and every byte of it has to be parsed as JavaScript before the
 *    game can start. The large ones are re-encoded as WebP: the tiling
 *    ground textures losslessly, the car photos and the prop atlas
 *    near-losslessly (see toWebp) -- nothing visible is traded for size.
 *  - Music is fetched per stage when that stage is played, not all five
 *    tracks before the title can show.
 *  - A service worker (build/pwa/sw.js) caches all of it, so a second start
 *    is local and the game runs offline, and a manifest makes it
 *    installable (home screen, full screen, own icon).
 *
 * Source stays as it is -- the data URIs in src/ are what the standalone and
 * artifact builds need -- and are only pulled out here, from the bundle.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { root, readPage, bundleBoot } from './lib/page.mjs';

const OUT = join(root, 'dist');
const withBgm = process.argv.includes('--with-bgm');
const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'assets'), { recursive: true });
mkdirSync(join(OUT, 'icons'), { recursive: true });

const files = [];      // written paths relative to OUT, for the precache
const write = (rel, data) => {
  writeFileSync(join(OUT, rel), data);
  files.push(rel);
  return rel;
};

// Below this, an image stays inline: a request costs more than the bytes.
const INLINE_MAX = 8 * 1024;

async function toWebp(buf) {
  const meta = await sharp(buf).metadata();
  // Near-lossless (60) for the cut-outs: at most 2/255 off per channel,
  // where plain lossy WebP, even at quality 95, moved fine red and blue
  // detail by up to 130/255 (its chroma is at half resolution) -- a
  // grandstand crowd lost its colours. Lossless for the tiling textures.
  const opts = meta.hasAlpha
    ? { nearLossless: true, quality: 60, effort: 6 }
    : { lossless: true, effort: 6 };
  return sharp(buf).webp(opts).toBuffer();
}

async function imageFile(b64, prefix) {
  const webp = await toWebp(Buffer.from(b64, 'base64'));
  return write(`assets/${prefix}-${hash(webp)}.webp`, webp);
}

/** Every "data:<type>;base64,..." string literal in `text`, largest first. */
function literals(text, type) {
  const out = [];
  const head = `"data:${type};base64,`;
  let i = 0;
  for (;;) {
    const j = text.indexOf(head, i);
    if (j < 0) break;
    const k = text.indexOf('"', j + 1);
    out.push({ start: j, end: k + 1, b64: text.slice(j + head.length, k) });
    i = k + 1;
  }
  return out;
}

async function replaceLiterals(text, type, fn) {
  const found = literals(text, type);
  let out = '', at = 0;
  for (const f of found) {
    out += text.slice(at, f.start) + (await fn(f));
    at = f.end;
  }
  return out + text.slice(at);
}

const { style: rawStyle, bodyTag, body, boot } = readPage();
let bundle = await bundleBoot(boot);
const before = bundle.length;

// car photos and ground textures
let images = 0;
bundle = await replaceLiterals(bundle, 'image/png', async (f) => {
  if (f.b64.length * 0.75 < INLINE_MAX) return bundle.slice(f.start, f.end);
  images++;
  return JSON.stringify(await imageFile(f.b64, 'tex'));
});
// the prop atlas: a JSON data URI whose own image is another data URI
bundle = await replaceLiterals(bundle, 'application/json', async (f) => {
  const json = JSON.parse(Buffer.from(f.b64, 'base64').toString('utf8'));
  const img = json?.meta?.image;
  if (typeof img !== 'string' || !img.startsWith('data:image/')) return bundle.slice(f.start, f.end);
  images++;
  json.meta.image = await imageFile(img.slice(img.indexOf(',') + 1), 'props');
  return JSON.stringify(`data:application/json;base64,${Buffer.from(JSON.stringify(json)).toString('base64')}`);
});
const app = write(`app-${hash(bundle)}.js`, bundle);

// the title screen's photograph, out of the stylesheet
let style = rawStyle;
const jpg = /url\(data:image\/jpeg;base64,([A-Za-z0-9+/=]+)\)/.exec(style);
if (jpg) {
  const buf = Buffer.from(jpg[1], 'base64');
  const rel = write(`assets/title-${hash(buf)}.jpg`, buf);
  style = style.replace(jpg[0], `url(${rel})`);
}

for (const f of readdirSync(join(root, 'build/pwa/icons'))) {
  copyFileSync(join(root, 'build/pwa/icons', f), join(OUT, 'icons', f));
  files.push(`icons/${f}`);
}

const manifest = {
  id: './',
  name: 'HiRoCF Top-Down Racer',
  short_name: 'HiRoCF',
  lang: 'ja',
  start_url: './',
  scope: './',
  // a game: no browser chrome at all where the platform allows it (Android
  // Chrome), standalone where it does not (iOS treats this as standalone)
  display: 'fullscreen',
  orientation: 'any',
  background_color: '#161a1e',
  theme_color: '#161a1e',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
write('manifest.webmanifest', JSON.stringify(manifest, null, 2));

const html = `<!doctype html><html lang="ja"><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<title>HiRoCF Top-Down Racer</title>
<meta name="theme-color" content="#161a1e">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="HiRoCF">
<link rel="preload" href="${app}" as="script">${withBgm ? '' : '\n<meta name="hirocf-bgm" content="none">'}
${style}
</head><body${bodyTag}>
${body}
<script src="${app}"></script>
<script>if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));</script>
</body></html>
`;
write('index.html', html);

// stage music: copied only on request, never precached (see sw.js)
let tracks = 0;
if (withBgm && existsSync(join(root, 'assets/bgm'))) {
  mkdirSync(join(OUT, 'assets/bgm'), { recursive: true });
  for (const f of readdirSync(join(root, 'assets/bgm'))) {
    if (!/^stage\d+\.mp3$/.test(f)) continue;
    copyFileSync(join(root, 'assets/bgm', f), join(OUT, 'assets/bgm', f));
    tracks++;
  }
}

// the service worker last: its version is every precached file's content
const precache = ['./', ...files];
const version = hash(Buffer.concat(files.map((f) => readFileSync(join(OUT, f)))));
const sw = readFileSync(join(root, 'build/pwa/sw.js'), 'utf8')
  .replace("const VERSION = '__VERSION__';", `const VERSION = '${version}';`)
  .replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify(precache)};`);
if (sw.includes('__VERSION__') || sw.includes('__PRECACHE__')) throw new Error('sw.js placeholders not filled');
writeFileSync(join(OUT, 'sw.js'), sw);

const size = (rel) => readFileSync(join(OUT, rel)).length;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const total = files.reduce((a, f) => a + size(f), 0);
console.log(`dist/ ${version}: script ${kb(size(app))} (was ${kb(before)} with images inline), `
  + `${images} images out, precache ${files.length} files ${kb(total)}, bgm tracks ${tracks}`);
