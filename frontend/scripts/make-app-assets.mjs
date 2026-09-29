/**
 * Source images for the Android icon and splash, built from the official
 * ACHIEVER logo (never redrawn or distorted — only scaled and centred):
 *   resources/icon-only.png        1024² white tile with the mark
 *   resources/icon-foreground.png  1024² transparent, mark inside the adaptive-icon safe zone
 *   resources/icon-background.png  1024² white
 *   resources/splash.png           2732² light splash with the stacked logo
 *   resources/splash-dark.png      2732² dark splash with the logo on a white plate
 * Then `npm run android:assets` produces every Android density from these.
 */
import fs from 'node:fs';
import sharp from 'sharp';

const out = 'resources';
fs.mkdirSync(out, { recursive: true });
const MARK = 'public/brand/achiever-mark-512.png';
const LOGO = 'public/brand/achiever-logo-stacked.png';
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

async function onCanvas(src, size, scale, background, file) {
  const inner = Math.round(size * scale);
  const img = await sharp(src).resize({ width: inner, height: inner, fit: 'inside' }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: img, gravity: 'centre' }]).png().toFile(`${out}/${file}`);
}

await onCanvas(MARK, 1024, 0.72, WHITE, 'icon-only.png');
// Adaptive icons crop to the central ~66%: keep the mark within it.
await onCanvas(MARK, 1024, 0.56, { r: 0, g: 0, b: 0, alpha: 0 }, 'icon-foreground.png');
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: WHITE } }).png().toFile(`${out}/icon-background.png`);
await onCanvas(LOGO, 2732, 0.26, { r: 245, g: 247, b: 246, alpha: 1 }, 'splash.png');
// Dark splash: the logo keeps its own colours on a white plate.
const plate = await sharp({ create: { width: 900, height: 700, channels: 4, background: WHITE } })
  .composite([{ input: await sharp(LOGO).resize({ width: 720 }).toBuffer(), gravity: 'centre' }]).png().toBuffer();
await sharp({ create: { width: 2732, height: 2732, channels: 4, background: { r: 11, g: 18, b: 16, alpha: 1 } } })
  .composite([{ input: plate, gravity: 'centre' }]).png().toFile(`${out}/splash-dark.png`);
console.log('App icon and splash sources written to resources/');
