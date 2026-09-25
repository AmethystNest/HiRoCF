/**
 * Image re-encoding shared by the builds that ship the bundle: the car
 * photos, ground textures and prop atlas are PNG data URIs in src/, and
 * both the PWA (as files) and the standalone page (still inline) carry
 * them as WebP instead -- about half the bytes, nothing visible traded.
 */
import sharp from 'sharp';

/** Below this, an image is left alone: not worth a request or a decode. */
export const SMALL_IMAGE = 8 * 1024;

export async function toWebp(buf) {
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

/** Every "data:<type>;base64,..." string literal in `text`. */
export function literals(text, type) {
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

export async function replaceLiterals(text, type, fn) {
  const found = literals(text, type);
  let out = '', at = 0;
  for (const f of found) {
    out += text.slice(at, f.start) + (await fn(f));
    at = f.end;
  }
  return out + text.slice(at);
}

/**
 * Every image in the bundle, and the prop atlas's own image (a data URI
 * inside a JSON data URI), handed to `place`, which returns what the image's
 * URL becomes: a file path (PWA) or a WebP data URI (standalone).
 */
export async function rewriteImages(bundle, place) {
  let count = 0;
  bundle = await replaceLiterals(bundle, 'image/png', async (f) => {
    if (f.b64.length * 0.75 < SMALL_IMAGE) return bundle.slice(f.start, f.end);
    count++;
    return JSON.stringify(await place(f.b64, 'tex'));
  });
  bundle = await replaceLiterals(bundle, 'application/json', async (f) => {
    const json = JSON.parse(Buffer.from(f.b64, 'base64').toString('utf8'));
    const img = json?.meta?.image;
    if (typeof img !== 'string' || !img.startsWith('data:image/')) return bundle.slice(f.start, f.end);
    count++;
    json.meta.image = await place(img.slice(img.indexOf(',') + 1), 'props');
    return JSON.stringify(`data:application/json;base64,${Buffer.from(JSON.stringify(json)).toString('base64')}`);
  });
  return { bundle, count };
}
