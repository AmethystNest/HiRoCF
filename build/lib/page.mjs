/**
 * What every single-page build shares: index.html cut into its style,
 * body and boot script, and that boot script bundled -- src/main.js,
 * src/config.js, src/game/records.js and everything they import, PixiJS
 * included -- into one plain IIFE.
 *
 * The page's boot script loads those three with dynamic import() (so the
 * dev page and the artifact build can load them from a host page); a
 * bundle wants them static, so the three lines are swapped for static
 * imports before esbuild sees the script.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as esbuild from 'esbuild';

export const root = new URL('../..', import.meta.url).pathname;

export function readPage() {
  const src = readFileSync(join(root, 'index.html'), 'utf8');
  const style = src.slice(src.indexOf('<style>'), src.indexOf('</style>') + 8);
  // The repo page puts state on <body> (the control pads start hidden), and
  // the builds write their own body tag, so the attributes are carried over.
  const bodyTag = /<body([^>]*)>/.exec(src)?.[1] ?? '';
  const bodyStart = src.indexOf('<div id="app"></div>');
  const scriptStart = src.indexOf('<script type="module">');
  const scriptEnd = src.indexOf('</script>', scriptStart) + '</script>'.length;
  const body = src.slice(bodyStart, scriptStart);
  const boot = src.slice(scriptStart + '<script type="module">'.length, scriptEnd - '</script>'.length);
  return { style, bodyTag, body, boot };
}

const DYNAMIC = [
  [/const \{boot\}\s*=\s*await import\('\.\/src\/main\.js'\);\s*/, `import { boot } from '${join(root, 'src/main.js')}';`],
  [/const \{NITRO,PHYSICS\}\s*=\s*await import\('\.\/src\/config\.js'\);\s*/, `import { NITRO, PHYSICS } from '${join(root, 'src/config.js')}';`],
  [/const \{createRecords,nextStarGap\}\s*=\s*await import\('\.\/src\/game\/records\.js'\);\s*/,
    `import { createRecords, nextStarGap } from '${join(root, 'src/game/records.js')}';`],
];

export async function bundleBoot(boot) {
  const imports = [];
  let script = boot;
  for (const [re, stmt] of DYNAMIC) {
    if (!re.test(script)) throw new Error(`boot script no longer has: ${re}`);
    script = script.replace(re, '');
    imports.push(stmt);
  }
  const tmp = mkdtempSync(join(tmpdir(), 'hirocf-bundle-'));
  const entryPath = join(tmp, 'entry.js');
  writeFileSync(entryPath, `${imports.join('\n')}\n${script}`);
  try {
    const result = await esbuild.build({
      // keepNames: the game tells the player's car from a rival's by class
      // name (race.js resolveContacts, boostfx.js), which plain minifying
      // renamed to two letters -- every player/rival rule in a contact was
      // silently off in the built game, while the source and the tests
      // had them.
      entryPoints: [entryPath], bundle: true, format: 'iife', minify: true, keepNames: true, write: false,
    });
    return result.outputFiles[0].text;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
