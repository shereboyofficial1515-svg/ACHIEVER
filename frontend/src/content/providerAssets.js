/**
 * Central provider branding for Bills & Services.
 *
 * WHICH providers exist always comes from the API (VTpass service discovery),
 * never from this file. This file only decides HOW a provider looks, keyed by
 * the providerCode the API returns (e.g. "mtn", "ikedc", "dstv").
 *
 * Logo resolution, in order:
 *   1. An official brand file bundled in the app (src/assets/providers/<code>/),
 *      registered in LOCAL_LOGOS with its source. None are bundled yet: add one
 *      only when you hold the provider's official artwork and the right to use it.
 *   2. The logo the ACHIEVER API serves for the service (/api/bills-assets/logos/:id).
 *      This is the brand artwork VTpass publishes in its merchant service
 *      catalogue for displaying its services; the API proxies and caches it.
 *   3. An ACHIEVER monogram (never a broken-image icon, never an invented logo).
 */
import { apiAssetUrl } from '../services/api.js';

// providerCode -> { src, source } for bundled official files (see src/assets/providers/README.md).
const LOCAL_LOGOS = {};

// Short monogram text used when no logo is available.
const MONOGRAMS = {
  mtn: 'MTN', airtel: 'AIR', glo: 'GLO', '9mobile': '9M', ikedc: 'IK', ekedc: 'EK', aedc: 'AE', kedco: 'KE', phed: 'PH', jed: 'JE',
  kaedco: 'KA', eedc: 'EE', ibedc: 'IB', bedc: 'BE', abedc: 'AB', yedc: 'YE', dstv: 'DS', gotv: 'GO', startimes: 'ST', showmax: 'SM',
  waec: 'WA', jamb: 'JA',
};

/** Record of where logo artwork comes from (shown in docs/BILLS_VTPASS.md, kept for brand compliance). */
export const LOGO_SOURCES = {
  api: 'VTpass merchant service catalogue (GET /api/services → image), served and cached by the ACHIEVER API',
  local: 'Official provider brand files registered in LOCAL_LOGOS (none bundled yet)',
};

/** The image URL to try for a provider, or null to show the monogram straight away. */
export function providerLogoSrc(provider) {
  if (!provider) return null;
  return LOCAL_LOGOS[provider.providerCode]?.src || apiAssetUrl(provider.logoUrl);
}

export function providerMonogram(provider) {
  const code = provider?.providerCode;
  if (code && MONOGRAMS[code]) return MONOGRAMS[code];
  const words = String(provider?.shortName || provider?.providerName || provider?.name || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 3)).toUpperCase();
}
