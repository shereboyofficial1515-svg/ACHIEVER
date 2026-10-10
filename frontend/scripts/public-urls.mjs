/**
 * Public URLs are baked into the bundle at build time. A malformed value (for
 * example "https//api.example.com", missing the colon) is treated by the browser
 * as a path on the website itself, so every API call silently gets index.html.
 * Fail the build instead of shipping that.
 */
export function checkPublicUrls(env) {
  for (const key of ['VITE_API_URL', 'VITE_PUBLIC_SITE_URL']) {
    const value = (env[key] || '').trim();
    if (!value) continue;
    let ok = false;
    try { ok = ['http:', 'https:'].includes(new URL(value).protocol) && /^https?:\/\/[^/]/.test(value); } catch { ok = false; }
    if (!ok) throw new Error(`${key} must be empty or a full URL such as https://api.example.com (got "${value}").`);
  }
}
