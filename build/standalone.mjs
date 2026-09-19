/**
 * Build a single-file, dependency-free HTML: everything the module-script
 * boot sequence reaches (src/main.js, src/config.js, and everything they in
 * turn import, PixiJS included) gets bundled and inlined as one plain
 * <script>, so the page needs neither a dev server nor `file://` module
 * support. It is what a phone can download and open directly in a browser
 * -- see build/index.artifact.html's own <script type="module"> for why
 * that path fails there (module imports are blocked outside http(s)).
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as esbuild from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
const src = readFileSync(join(root, 'index.html'), 'utf8');

const style = src.slice(src.indexOf('<style>'), src.indexOf('</style>') + 8);
const bodyStart = src.indexOf('<div id="app"></div>');
const scriptStart = src.indexOf('<script type="module">');
const scriptEnd = src.indexOf('</script>', scriptStart) + '</script>'.length;
const body = src.slice(bodyStart, scriptStart);
let boot = src.slice(scriptStart + '<script type="module">'.length, scriptEnd - '</script>'.length);

// Turn the two dynamic imports (chosen for the artifact build, which loads
// into an already-running host page) into static ones so esbuild inlines
// them instead of emitting a second chunk.
boot = boot
  .replace(/const \{boot\}\s*=\s*await import\('\.\/src\/main\.js'\);\s*/, '')
  .replace(/const \{NITRO,PHYSICS\}\s*=\s*await import\('\.\/src\/config\.js'\);\s*/, '');

const tmp = mkdtempSync(join(tmpdir(), 'hirocf-standalone-'));
const entryPath = join(tmp, 'entry.js');
writeFileSync(
  entryPath,
  `import { boot } from '${join(root, 'src/main.js')}';\n` +
    `import { NITRO, PHYSICS } from '${join(root, 'src/config.js')}';\n` +
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

const out = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no"><title>HiRoCF Top-Down Racer</title>
${style}
${body}
<script>${bundle}</script>
</body></html>
`;
writeFileSync(join(root, 'build/index.standalone.html'), out);
console.log('build/index.standalone.html', (out.length / 1024 / 1024).toFixed(2), 'MB');
