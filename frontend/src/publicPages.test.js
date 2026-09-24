import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards against dead links and missing SEO basics in the static public pages.
const PUBLIC = path.resolve(__dirname, '../public');
const SPA_ROUTES = [/^\/$/, /^\/login$/, /^\/register$/, /^\/forgot-password$/, /^\/reset-password$/, /^\/verify-email$/, /^\/complete-profile$/, /^\/legal$/, /^\/app(\/.*)?$/];
const REQUIRED = ['documentation.html', 'terms.html', 'privacy.html', 'refund-policy.html', 'cookie-policy.html', 'support.html', 'delete-data.html', 'security.html', 'accessibility.html', 'about.html', 'contact.html', '404.html'];

const pages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html'));

describe('public pages', () => {
  it('include every required page', () => {
    for (const p of REQUIRED) expect(pages, p).toContain(p);
  });

  for (const file of pages) {
    const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    it(`${file}: has title, description, favicon and logo`, () => {
      expect(html).toMatch(/<title>[^<]+ · ACHIEVER<\/title>/);
      expect(html).toMatch(/<meta name="description" content="[^"]{20,}">/);
      expect(html).toContain('/favicon.ico');
      expect(html).toContain('/brand/achiever-logo-stacked');
      expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    });
    it(`${file}: has no dead internal links`, () => {
      const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
        if (/^(https?:|mailto:)/.test(href)) continue;
        if (href.startsWith('#')) {
          expect(ids.has(href.slice(1)), `${file} → ${href}`).toBe(true);
          continue;
        }
        const [p, hash] = href.split('#');
        const clean = p.split('?')[0];
        if (SPA_ROUTES.some((re) => re.test(clean))) continue;
        const target = path.join(PUBLIC, clean);
        expect(fs.existsSync(target), `${file} → ${href}`).toBe(true);
        if (hash && clean.endsWith('.html')) {
          const other = fs.readFileSync(target, 'utf8');
          expect(other.includes(`id="${hash}"`), `${file} → ${href}`).toBe(true);
        }
      }
    });
  }

  it('the documentation covers all 35 required sections plus troubleshooting and FAQ topics', () => {
    const docs = fs.readFileSync(path.join(PUBLIC, 'documentation.html'), 'utf8');
    expect((docs.match(/data-doc /g) || []).length).toBe(35);
    for (const t of ['I cannot create an account', 'I cannot log in', 'My payment is pending', 'receive my code', 'receive my email', 'video call is not working', 'What happens when I miss a contribution?']) {
      expect(docs).toContain(t);
    }
  });

  it('policy pages carry the legal-review and not-a-bank notice', () => {
    for (const p of ['terms.html', 'privacy.html', 'refund-policy.html', 'cookie-policy.html', 'security.html', 'delete-data.html']) {
      const html = fs.readFileSync(path.join(PUBLIC, p), 'utf8');
      expect(html, p).toContain('reviewed by Nigerian legal and compliance professionals');
      expect(html, p).toContain('not covered by NDIC deposit insurance');
    }
  });

  it('no page still uses the old logo', () => {
    expect(fs.existsSync(path.join(PUBLIC, 'favicon.svg'))).toBe(false);
    for (const file of pages) expect(fs.readFileSync(path.join(PUBLIC, file), 'utf8')).not.toContain('favicon.svg');
  });
});
