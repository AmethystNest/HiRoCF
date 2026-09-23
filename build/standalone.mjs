/**
 * Build a single-file, dependency-free HTML: everything the module-script
 * boot sequence reaches (src/main.js, src/config.js, and everything they in
 * turn import, PixiJS included) gets bundled and inlined as one plain
 * <script>, so the page needs neither a dev server nor `file://` module
 * support. It is what a phone can download and open directly in a browser
 * -- see build/index.artifact.html's own <script type="module"> for why
 * that path fails there (module imports are blocked outside http(s)).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, readPage, bundleBoot } from './lib/page.mjs';

const { style, bodyTag, body, boot } = readPage();
const bundle = await bundleBoot(boot);

// Stage music, if prepared locally (build/tools/make-bgm.mjs; assets/bgm/ is
// git-ignored). Each track goes in as inert base64 text in a non-script
// <script> type, which the browser neither parses nor runs; src/audio/bgm.js
// turns the current stage's into a blob: URL on demand.
const bgmDir = join(root, 'assets/bgm');
const bgm = existsSync(bgmDir)
  ? readdirSync(bgmDir)
      .map((f) => /^stage(\d+)\.mp3$/.exec(f))
      .filter(Boolean)
      .map((m) => `<script type="application/octet-stream" id="bgm-${m[1]}">${readFileSync(join(bgmDir, m[0])).toString('base64')}</script>`)
  : [];
console.log(`bgm tracks embedded: ${bgm.length}`);

const out = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no"><title>HiRoCF Top-Down Racer</title>
${style}
</head><body${bodyTag}>
${body}
${bgm.join('\n')}
<script>${bundle}</script>
</body></html>
`;
writeFileSync(join(root, 'build/index.standalone.html'), out);
console.log('build/index.standalone.html', (out.length / 1024 / 1024).toFixed(2), 'MB');
