/**
 * Build a single-file, dependency-free HTML: everything the module-script
 * boot sequence reaches (src/main.js, src/config.js, and everything they in
 * turn import, PixiJS included) gets bundled and inlined as one plain
 * <script>, so the page needs neither a dev server nor `file://` module
 * support. It is what a phone can download and open directly in a browser
 * -- see build/index.artifact.html's own <script type="module"> for why
 * that path fails there (module imports are blocked outside http(s)).
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as esbuild from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
const src = readFileSync(join(root, 'index.html'), 'utf8');

const style = src.slice(src.indexOf('<style>'), src.indexOf('</style>') + 8);
// The repo page puts state on <body> (the control pads start hidden), and
// this build writes its own body tag, so carry the attributes across or
// that state is silently dropped in the standalone only.
const bodyTag = /<body([^>]*)>/.exec(src)?.[1] ?? '';
const bodyStart = src.indexOf('<div id="app"></div>');
const scriptStart = src.indexOf('<script type="module">');
const scriptEnd = src.indexOf('</script>', scriptStart) + '</script>'.length;
const body = src.slice(bodyStart, scriptStart);
let boot = src.slice(scriptStart + '<script type="module">'.length, scriptEnd - '</script>'.length);

// Turn the three dynamic imports (chosen for the artifact build, which loads
// into an already-running host page) into static ones so esbuild inlines
// them instead of emitting a second chunk.
boot = boot
  .replace(/const \{boot\}\s*=\s*await import\('\.\/src\/main\.js'\);\s*/, '')
  .replace(/const \{NITRO,PHYSICS\}\s*=\s*await import\('\.\/src\/config\.js'\);\s*/, '')
  .replace(/const \{createRecords,nextStarGap\}\s*=\s*await import\('\.\/src\/game\/records\.js'\);\s*/, '');

const tmp = mkdtempSync(join(tmpdir(), 'hirocf-standalone-'));
const entryPath = join(tmp, 'entry.js');
writeFileSync(
  entryPath,
  `import { boot } from '${join(root, 'src/main.js')}';\n` +
    `import { NITRO, PHYSICS } from '${join(root, 'src/config.js')}';\n` +
    `import { createRecords, nextStarGap } from '${join(root, 'src/game/records.js')}';\n` +
    boot,
);

const result = await esbuild.build({
  entryPoints: [entryPath],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
});
rmSync(tmp, { recursive: true, force: true });
const bundle = result.outputFiles[0].text;

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
