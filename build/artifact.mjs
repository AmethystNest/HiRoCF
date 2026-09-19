/**
 * Generate the Artifact copy of index.html from the repo's.
 *
 * The published artifact is the same game, but the claude.ai host wraps the
 * page in its own skeleton: it supplies <head> (and its own viewport meta,
 * which a game has to replace to kill pinch/double-tap zoom). Everything
 * below that -- the stylesheet and the whole body -- is the repo's file
 * verbatim, so this splices rather than maintaining a second copy by hand.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const style = src.slice(src.indexOf('<style>'), src.indexOf('</style>') + 8);
const body = src.slice(src.indexOf('<div id="app"></div>'), src.lastIndexOf('</body>'));

const out = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>
<title>HiRoCF Top-Down Racer</title>
${style}
<script>
  // The host skeleton supplies its own viewport meta. A game needs
  // pinch/double-tap zoom off as well, so replace it rather than add a
  // second one the browser would ignore.
  (() => {
    const m = document.querySelector('meta[name="viewport"]') || document.head.appendChild(document.createElement('meta'));
    m.name = 'viewport';
    m.content = 'width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no';
  })();
</script>

${body}</body></html>
`;
writeFileSync(new URL('../build/index.artifact.html', import.meta.url), out);
console.log('build/index.artifact.html', out.length, 'bytes');
