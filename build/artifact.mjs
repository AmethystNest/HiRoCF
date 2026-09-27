/**
 * The phone test link: the game as a claude.ai Artifact, in dist-artifact/.
 *
 *   node build/artifact.mjs    (npm run build:artifact)
 *
 * What the Artifact host allows decides the shape:
 *  - Scripts only inline (or from a few CDNs). A <script src> pointing at a
 *    file published alongside the page is refused, which left the title up
 *    and START dead -- so the bundle goes into the page, as in the
 *    standalone build, images inline as WebP (build/lib/images.mjs).
 *  - The page must stay under 16 MB, so the stage music cannot be inlined
 *    (~21 MB as base64): it is published as files next to the page and
 *    src/audio/bgm.js asks for assets/bgm/stage<N>.mp3 when a stage loads.
 *  - The host supplies <head> and <body>, with its own viewport meta (which
 *    a game replaces to stop pinch/double-tap zoom) and owns the body tag,
 *    so the page's body classes are put on at boot. No service worker, no
 *    manifest: the host allows neither.
 *  - Errors are shown on screen: on a phone there is no console to read.
 *
 * The tracks are commercial recordings: the link stays private.
 */
import { writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, readPage, bundleBoot } from './lib/page.mjs';
import { toWebp, rewriteImages } from './lib/images.mjs';

const OUT = join(root, 'dist-artifact');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const { style, bodyTag, body, boot } = readPage();
const { bundle } = await rewriteImages(await bundleBoot(boot), async (b64) =>
  `data:image/webp;base64,${(await toWebp(Buffer.from(b64, 'base64'))).toString('base64')}`);
const bodyClass = /class="([^"]*)"/.exec(bodyTag)?.[1] ?? '';

const html = `<title>HiRoCF Top-Down Racer</title>
${style}
<script>
(() => {
  const m = document.querySelector('meta[name="viewport"]') || document.head.appendChild(document.createElement('meta'));
  m.name = 'viewport';
  m.content = 'width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no';
  for (const c of ${JSON.stringify(bodyClass)}.split(' ')) if (c) document.body.classList.add(c);
  // errors on screen, for a phone with no console
  const show = (msg) => {
    let box = document.getElementById('errBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'errBox';
      box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:9999;max-height:40vh;overflow:auto;'
        + 'padding:8px 10px;border-radius:8px;background:rgba(120,0,0,.9);color:#fff;font:12px/1.4 monospace;white-space:pre-wrap;pointer-events:auto';
      (document.body || document.documentElement).appendChild(box);
    }
    box.textContent += (box.textContent ? '\\n' : '') + String(msg).slice(0, 400);
  };
  addEventListener('error', (e) => show('ERROR ' + (e.message || (e.target && (e.target.src || e.target.href)) || e)), true);
  addEventListener('unhandledrejection', (e) => show('REJECT ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
  addEventListener('securitypolicyviolation', (e) => show('CSP ' + e.violatedDirective + ' ' + e.blockedURI));
})();
</script>
${body}
<script>${bundle}</script>
`;
writeFileSync(join(OUT, 'index.html'), html);

let tracks = 0;
if (existsSync(join(root, 'assets/bgm'))) {
  mkdirSync(join(OUT, 'assets/bgm'), { recursive: true });
  for (const f of readdirSync(join(root, 'assets/bgm'))) {
    if (!/^stage\d+\.mp3$/.test(f)) continue;
    copyFileSync(join(root, 'assets/bgm', f), join(OUT, 'assets/bgm', f));
    tracks++;
  }
}
console.log(`dist-artifact/index.html ${(html.length / 1024 / 1024).toFixed(2)} MB, bgm tracks ${tracks}`);
