/**
 * Builds every ACHIEVER brand asset from the ONE official logo supplied by the owner:
 *   frontend/resources/brand-source/achiever-logo-official.jpg  (white + green artwork on black)
 *
 * Nothing is redrawn. Two colourways are derived from the same pixels:
 *   dark  – for dark surfaces: the artwork exactly, with the black background made transparent
 *   light – for light surfaces: identical, except the white/grey parts become ACHIEVER ink
 *           (#0B1210) so they stay visible on white; the green is untouched
 * App icons, splash screens and the social preview keep the original black background.
 *
 * Run: node scripts/brand-assets.mjs   (then: npm run android:assets)
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const SRC = path.join(ROOT, 'resources/brand-source/achiever-logo-official.jpg');
const OUT = path.join(ROOT, 'public/brand');
const RES = path.join(ROOT, 'resources');
const INK = [11, 18, 16];
const BLACK = { r: 0, g: 0, b: 0, alpha: 1 };

const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;

// Transparent background: alpha from brightness against black, colour un-premultiplied.
function keyed(colourway) {
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const max = Math.max(r, g, b);
    const a = Math.max(0, Math.min(1, (max - 14) / 46));
    if (a === 0) continue;
    let R = Math.min(255, r / Math.max(a, 0.2)); let G = Math.min(255, g / Math.max(a, 0.2)); let B = Math.min(255, b / Math.max(a, 0.2));
    if (colourway === 'light') {
      const sat = max ? (max - Math.min(R, G, B)) / Math.max(R, G, B) : 0;
      if (sat < 0.22) {   // white / grey parts → ink, keeping the artwork's shading
        const shade = (255 - Math.max(R, G, B)) * 0.45;
        [R, G, B] = INK.map((c) => Math.min(255, c + shade));
      }
    }
    out[j] = R; out[j + 1] = G; out[j + 2] = B; out[j + 3] = Math.round(a * 255);
  }
  return out;
}

// Find the three bands (mark, wordmark, tagline) from the rows that contain artwork.
const rowHas = [];
for (let y = 0; y < H; y += 1) {
  let n = 0;
  for (let x = 0; x < W; x += 1) { const i = (y * W + x) * 3; if (Math.max(data[i], data[i + 1], data[i + 2]) > 60) n += 1; }
  rowHas.push(n > 2);
}
const bands = [];
for (let y = 0; y < H; y += 1) {
  if (rowHas[y] && (y === 0 || !rowHas[y - 1])) bands.push({ top: y });
  if (rowHas[y] && (y === H - 1 || !rowHas[y + 1])) bands[bands.length - 1].bottom = y;
}
const merged = [];
for (const b of bands) {
  const last = merged[merged.length - 1];
  if (last && b.top - last.bottom < 12) last.bottom = b.bottom; else merged.push({ ...b });
}
if (merged.length < 3) throw new Error(`Expected mark, wordmark and tagline bands, found ${merged.length}`);
const [markBand, wordBand, tagBand] = merged.slice(-3).length === 3 && merged.length > 3 ? [merged[0], merged[merged.length - 2], merged[merged.length - 1]] : merged;
const cols = (top, bottom) => {
  let left = W; let right = 0;
  for (let y = top; y <= bottom; y += 1) for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 3; if (Math.max(data[i], data[i + 1], data[i + 2]) > 60) { left = Math.min(left, x); right = Math.max(right, x); }
  }
  return { left, right };
};
const box = (top, bottom, pad = 8) => {
  const { left, right } = cols(top, bottom);
  return { left: Math.max(0, left - pad), top: Math.max(0, top - pad), width: Math.min(W, right + pad) - Math.max(0, left - pad), height: Math.min(H, bottom + pad) - Math.max(0, top - pad) };
};
const FULL = box(markBand.top, tagBand.bottom);
const STACKED = box(markBand.top, wordBand.bottom);
const MARK = box(markBand.top, markBand.bottom);

const rgba = (buf) => sharp(buf, { raw: { width: W, height: H, channels: 4 } });
const light = keyed('light');
const dark = keyed('dark');
const crop = (buf, b) => rgba(buf).extract(b);

async function write(img, file, { width, height, fit = 'inside', format = 'png' } = {}) {
  const target = path.join(file.startsWith('resources/') ? ROOT : OUT, file.startsWith('resources/') ? file : file);
  let p = img.clone ? img.clone() : img;
  if (width || height) p = p.resize({ width, height, fit, background: { r: 0, g: 0, b: 0, alpha: 0 } });
  p = format === 'webp' ? p.webp({ quality: 90, alphaQuality: 100 }) : p.png({ compressionLevel: 9, palette: false });
  await p.toFile(target);
  const m = await sharp(target).metadata();
  return { file, w: m.width, h: m.height };
}
// A square icon: mark centred on black at `scale` of the canvas (safe zone for adaptive/maskable icons).
async function icon(size, scale, { background = BLACK, buf = dark } = {}) {
  const inner = Math.round(size * scale);
  const mark = await crop(buf, MARK).resize({ width: inner, height: inner, fit: 'inside' }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } }).composite([{ input: mark, gravity: 'centre' }]).png();
}

const made = [];
fs.mkdirSync(OUT, { recursive: true });
for (const [name, buf] of [['', light], ['-dark', dark]]) {
  made.push(await write(crop(buf, FULL), `achiever-logo${name}.png`, { width: 1063 }));
  made.push(await write(crop(buf, FULL), `achiever-logo-600${name}.png`, { width: 600 }));
  made.push(await write(crop(buf, FULL), `achiever-logo-600${name}.webp`, { width: 600, format: 'webp' }));
  made.push(await write(crop(buf, STACKED), `achiever-logo-stacked${name}.png`, { width: 480 }));
  made.push(await write(crop(buf, STACKED), `achiever-logo-stacked${name}.webp`, { width: 480, format: 'webp' }));
  for (const s of [96, 192, 512]) made.push(await write(crop(buf, MARK), `achiever-mark-${s}${name}.png`, { width: s, height: s, fit: 'contain' }));
}
// Original artwork (black background), the email logo (email clients: light backgrounds), social preview.
made.push(await write(sharp(SRC), 'achiever-logo-original.png'));
made.push(await write(crop(light, STACKED).flatten({ background: '#ffffff' }), 'achiever-email-logo.png', { width: 440 }));
const og = await sharp(SRC).resize({ width: 1100, height: 600, fit: 'inside' }).toBuffer();
await sharp({ create: { width: 1200, height: 630, channels: 3, background: BLACK } }).composite([{ input: og, gravity: 'centre' }]).png().toFile(path.join(OUT, 'og-image.png'));
made.push({ file: 'og-image.png', w: 1200, h: 630 });
// Browser and home-screen icons: the mark on black.
for (const [file, size, scale] of [['favicon-16.png', 16, 0.94], ['favicon-32.png', 32, 0.9], ['apple-touch-icon.png', 180, 0.78], ['icon-192.png', 192, 0.72], ['icon-512.png', 512, 0.72]]) {
  await (await icon(size, scale)).toFile(path.join(OUT, file));
  made.push({ file, w: size, h: size });
}
// favicon.ico with 16, 32 and 48 px PNG images inside.
const icoImages = await Promise.all([16, 32, 48].map(async (s) => (await icon(s, s <= 16 ? 0.94 : 0.9)).toBuffer()));
const header = Buffer.alloc(6 + 16 * icoImages.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoImages.length, 4);
let offset = header.length;
icoImages.forEach((img, i) => {
  const s = [16, 32, 48][i]; const e = 6 + i * 16;
  header.writeUInt8(s, e); header.writeUInt8(s, e + 1); header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(img.length, e + 8); header.writeUInt32LE(offset, e + 12); offset += img.length;
});
fs.writeFileSync(path.join(ROOT, 'public/favicon.ico'), Buffer.concat([header, ...icoImages]));
made.push({ file: '../favicon.ico', w: 48, h: 48 });

// Android (capacitor-assets): adaptive icon (black background + mark in the 66% safe zone) and splash.
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: BLACK } }).png().toFile(path.join(RES, 'icon-background.png'));
const fg = await crop(dark, MARK).resize({ width: 560, height: 560, fit: 'inside' }).png().toBuffer();
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: fg, gravity: 'centre' }]).png().toFile(path.join(RES, 'icon-foreground.png'));
await (await icon(1024, 0.74)).toFile(path.join(RES, 'icon-only.png'));
const splashLogo = await crop(dark, STACKED).resize({ width: 900, fit: 'inside' }).png().toBuffer();
for (const f of ['splash.png', 'splash-dark.png']) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: BLACK } }).composite([{ input: splashLogo, gravity: 'centre' }]).png().toFile(path.join(RES, f));
}
made.push({ file: 'resources/icon-*.png, splash*.png', w: 1024, h: 1024 });

fs.writeFileSync(path.join(OUT, 'brand.json'), JSON.stringify({
  source: 'resources/brand-source/achiever-logo-official.jpg',
  ratios: { full: +(FULL.width / FULL.height).toFixed(4), stacked: +(STACKED.width / STACKED.height).toFixed(4), mark: +(MARK.width / MARK.height).toFixed(4) },
}, null, 2));
console.table(made);
console.log('bands', { markBand, wordBand, tagBand, FULL, STACKED, MARK });
