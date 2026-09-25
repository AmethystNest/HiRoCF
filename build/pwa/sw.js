/* HiRoCF service worker. build/pwa.mjs fills in the build version and the precache list.
 *
 * - Everything the game needs to start (page, script, images, manifest,
 *   icons) is cached on install, under a cache named for this build, so the
 *   game starts with no network at all and a new build never mixes files
 *   with an old one. Old builds' caches go on activate.
 * - Stage music is cached the first time a stage is played, not up front
 *   (up to ~16 MB for five stages).
 * - <audio> asks for its source in byte ranges, and Safari will not play a
 *   track answered with a plain 200 to a Range request -- which is what a
 *   naive cache hit is. Music is therefore always fetched and cached whole,
 *   and each Range request is answered from that with a 206 slice.
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL = `hirocf-shell-${VERSION}`;
const MUSIC = 'hirocf-music-v1';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(PRECACHE);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('hirocf-shell-') && key !== SHELL) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function rangeFrom(response, rangeHeader) {
  const buf = await response.arrayBuffer();
  const size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader || '');
  let start = 0, end = size - 1;
  if (m) {
    if (m[1] === '' && m[2] !== '') { start = Math.max(0, size - Number(m[2])); }
    else {
      start = Number(m[1] || 0);
      if (m[2] !== '') end = Math.min(size - 1, Number(m[2]));
    }
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

async function music(request) {
  const cache = await caches.open(MUSIC);
  const key = new Request(new URL(request.url).pathname);
  let whole = await cache.match(key);
  if (!whole) {
    const res = await fetch(request.url);   // no Range: the whole file
    if (!res.ok) return res;
    await cache.put(key, res.clone());
    whole = res;
  }
  const range = request.headers.get('Range');
  return range ? rangeFrom(whole, range) : whole;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/assets/bgm/')) {
    event.respondWith(music(req));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    // the page itself answers for any navigation within the app's scope
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' })
      || (req.mode === 'navigate' ? await cache.match('./') : null);
    return hit || fetch(req);
  })());
});
