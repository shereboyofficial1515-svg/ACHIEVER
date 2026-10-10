import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGES } from '../public-site/pages.mjs';
import { page } from '../public-site/layout.mjs';
import { seoShell } from '../scripts/seo-shell.mjs';

const pub = path.resolve(__dirname, '../public');
const indexable = PAGES.filter((p) => !['404.html', 'maintenance.html'].includes(p.slug));

describe('public pages (search engines)', () => {
  it('every public page has its own title and a useful description', () => {
    const titles = indexable.map((p) => p.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const p of indexable) {
      expect(p.description.length, p.slug).toBeGreaterThan(50);
      expect(p.description.length, p.slug).toBeLessThanOrEqual(200);
    }
  });

  it('the product pages exist, with one h1 and no fake claims', () => {
    for (const slug of ['osusu.html', 'collector-savings.html', 'wallet.html', 'bills.html']) {
      const html = page(PAGES.find((p) => p.slug === slug));
      expect(html.match(/<h1[\s>]/g), slug).toHaveLength(1);
      expect(html, slug).not.toMatch(/licensed by the Central Bank(?! of Nigeria as a deposit-taking)|guaranteed returns|interest rate|\d+(\.\d+)?% (interest|return)|award|rated \d/i);
    }
  });

  it('the sitemap lists only public pages, never the app, the API or admin', () => {
    const sitemap = fs.readFileSync(path.join(pub, 'sitemap.xml'), 'utf8');
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    expect(locs).toContain('/osusu.html');
    expect(locs).toContain('/bills.html');
    for (const l of locs) expect(l).not.toMatch(/^\/(app|api|admin|login|register|404|maintenance)/);
    const robots = fs.readFileSync(path.join(pub, 'robots.txt'), 'utf8');
    expect(robots).toMatch(/Disallow: \/app\//);
    expect(robots).toMatch(/Disallow: \/api\//);
  });
});

describe('app home page (index.html) at build time', () => {
  const shell = '<head><meta property="og:image" content="/brand/og-image.png" /></head><body><div id="root"></div></body>';

  it('adds a crawlable summary with links to the public pages', () => {
    const out = seoShell('https://www.achieverng.site').transformIndexHtml(shell);
    expect(out).toMatch(/<div id="root"><div class="seo-shell">\s*<h1>/);
    expect(out).toContain('href="/osusu.html"');
    expect(out).toContain('not a bank');
  });

  it('uses absolute share links and accurate Organization data only; no canonical (one file serves every route)', () => {
    const out = seoShell('https://www.achieverng.site/').transformIndexHtml(shell);
    expect(out).toContain('content="https://www.achieverng.site/brand/og-image.png"');
    expect(out).toContain('content="https://www.achieverng.site/"');
    const ld = JSON.parse(out.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
    expect(Object.keys(ld).sort()).toEqual(['@context', '@type', 'logo', 'name', 'url']);
    expect(out).not.toMatch(/rel="canonical"/);
  });

  it('without a known site address, nothing absolute is invented', () => {
    const out = seoShell('').transformIndexHtml(shell);
    expect(out).toContain('content="/brand/og-image.png"');
    expect(out).not.toContain('ld+json');
  });
});
