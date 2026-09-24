/**
 * Generates ACHIEVER's static public pages into frontend/public/*.html.
 * Runs automatically before `npm run build` (prebuild) and can be run with
 * `npm run pages`. Sources: frontend/public-site/.
 *
 * Environment (optional): VITE_SUPPORT_EMAIL, PUBLIC_SITE_URL (canonical URLs),
 * VITE_API_URL (only if the API is on another origin).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load frontend/.env* so the same values as the Vite build are used.
for (const file of ['.env', '.env.local', '.env.production']) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const { page, SITE } = await import('../public-site/layout.mjs');
const { PAGES } = await import('../public-site/pages.mjs');

const out = path.join(root, 'public');
const written = [];
for (const p of PAGES) {
  fs.writeFileSync(path.join(out, p.slug), page(p));
  written.push(p.slug);
}

// sitemap.xml + robots.txt (only with a known public origin)
if (SITE.origin) {
  const urls = ['', ...written.filter((s) => !['404.html', 'maintenance.html'].includes(s))]
    .map((s) => `  <url><loc>${SITE.origin}/${s}</loc></url>`).join('\n');
  fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
}
fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nDisallow: /app/\nDisallow: /api/\n${SITE.origin ? `Sitemap: ${SITE.origin}/sitemap.xml\n` : ''}`);

console.log(`public pages: ${written.join(', ')}`);
if (SITE.supportEmail === 'support@example.com') console.warn('WARNING: VITE_SUPPORT_EMAIL is not set; public pages show support@example.com.');
if (!SITE.origin) console.warn('NOTE: PUBLIC_SITE_URL is not set; canonical URLs and sitemap.xml were skipped.');
