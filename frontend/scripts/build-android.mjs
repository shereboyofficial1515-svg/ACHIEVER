/**
 * Build the web app for the Android shell and copy it into android/.
 *   npm run android:build            -> production API (Render)
 *   ACHIEVER_API_URL=... npm run android:build   -> another API (e.g. staging)
 *
 * The Android app calls the API directly (it has no Vercel /api forwarding),
 * so VITE_API_URL must be the API's own https URL. Only public values are
 * bundled; every secret stays on the server.
 */
import { execSync } from 'node:child_process';

const api = process.env.ACHIEVER_API_URL || 'https://achiever-api-uu08.onrender.com';
const site = process.env.ACHIEVER_SITE_URL || 'https://achiever-nine.vercel.app';
for (const [name, value] of [['API', api], ['SITE', site]]) {
  if (!/^https:\/\//.test(value) || /localhost|127\.0\.0\.1/.test(value)) {
    console.error(`${name} URL must be a public https:// address for the Android build (got ${value}).`);
    process.exit(1);
  }
}
const env = { ...process.env, VITE_API_URL: api, VITE_PUBLIC_SITE_URL: site, VITE_PLATFORM_BUILD: 'android' };
// vite build only: the public pages in public/ are generated for the website (Vercel) and must not change here.
execSync('npx vite build', { stdio: 'inherit', env });
execSync('npx cap sync android', { stdio: 'inherit', env });
console.log(`\nAndroid web assets ready (API ${api}). Open Android Studio with: npx cap open android`);
