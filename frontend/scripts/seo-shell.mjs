/**
 * Build-time SEO for the app's single HTML page (index.html, which also serves "/").
 *
 * The home page is drawn by React, so crawlers and link previews that do not run
 * JavaScript used to see an empty page titled "ACHIEVER". This plugin adds, at
 * build time only:
 *   - a short, accurate summary inside #root with links to the public pages
 *     (React replaces it as soon as it starts; hidden inside the Android app);
 *   - absolute og:url / og:image links (social networks ignore relative ones);
 *   - Organization structured data (name, website and logo only: no address,
 *     ratings, licences or other claims).
 * No canonical link is added: this same file answers every app route.
 */
const SUMMARY = `<div class="seo-shell">
  <h1>ACHIEVER: Osusu groups, collector savings and bill payments</h1>
  <p>ACHIEVER runs rotational Osusu (Ajo, Esusu) groups and collector savings for Nigerians. Contributions are paid through Paystack and confirmed before they are recorded, payouts follow a fixed order, and every member sees the same record.</p>
  <ul>
    <li><a href="/osusu.html">Osusu groups</a>: fixed contributions and a clear payout order.</li>
    <li><a href="/collector-savings.html">Collector savings</a>: save with an approved collector for an agreed term.</li>
    <li><a href="/wallet.html">ACHIEVER Wallet</a>: add money, send to members and to Nigerian banks.</li>
    <li><a href="/bills.html">Bills &amp; Services</a>: airtime, data, electricity, TV and exam PINs.</li>
  </ul>
  <p><a href="/register">Create an account</a> · <a href="/login">Sign in</a> · <a href="/documentation.html">How ACHIEVER works</a> · <a href="/about.html">About</a> · <a href="/support.html">Support</a></p>
  <p>ACHIEVER is not a bank and money recorded in ACHIEVER is not covered by NDIC deposit insurance.</p>
</div>`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function seoShell(origin) {
  const site = (origin || '').replace(/\/$/, '');
  return {
    name: 'achiever-seo-shell',
    apply: 'build',
    transformIndexHtml(html) {
      let out = html.replace('<div id="root"></div>', `<div id="root">${SUMMARY}</div>`);
      if (site) {
        const org = { '@context': 'https://schema.org', '@type': 'Organization', name: 'ACHIEVER', url: `${site}/`, logo: `${site}/brand/achiever-logo-600.png` };
        out = out
          .replace('<meta property="og:image" content="/brand/og-image.png" />', `<meta property="og:image" content="${esc(site)}/brand/og-image.png" />\n    <meta property="og:url" content="${esc(site)}/" />\n    <meta name="twitter:card" content="summary_large_image" />`)
          .replace('</head>', `  <script type="application/ld+json">${JSON.stringify(org).replace(/</g, '\\u003c')}</script>\n  </head>`);
      }
      return out;
    },
  };
}

export const SEO_SUMMARY = SUMMARY;
