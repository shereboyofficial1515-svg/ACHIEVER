import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Network } from '@capacitor/network';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { closeTopOverlay } from './overlays.js';

/**
 * Android-only behaviour (loaded only inside the Capacitor app).
 */

// Screens where "back" leaves the app instead of navigating (never logs out).
const ROOT_PATHS = new Set(['/', '/app', '/login', '/register']);

async function applyStatusBar(theme) {
  try {
    // Dark icons on the light theme, light icons on the dark theme.
    await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: theme === 'dark' ? '#0e1412' : '#f5f7f6' });
  } catch {
    /* older WebView / not supported */
  }
}

function handleBack() {
  // 1) close a dialog or drawer, 2) go back a screen, 3) at a root screen, leave the app (it stays signed in).
  if (closeTopOverlay()) return;
  if (!ROOT_PATHS.has(window.location.pathname) && window.history.length > 1) {
    window.history.back();
    return;
  }
  App.minimizeApp().catch(() => App.exitApp());
}

export async function init() {
  await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
  await applyStatusBar(document.documentElement.dataset.theme);
  window.addEventListener('achiever:theme', (e) => applyStatusBar(e.detail.theme));

  App.addListener('backButton', handleBack);

  // Google/Facebook sign-in happens in the system browser; the API hands the
  // app a short-lived, single-use code through this deep link.
  App.addListener('appUrlOpen', ({ url }) => {
    try {
      const u = new URL(url);
      if (u.host === 'auth' && u.pathname === '/callback') {
        window.dispatchEvent(new CustomEvent('achiever:oauth-handoff', { detail: { code: u.searchParams.get('code'), error: u.searchParams.get('error') } }));
        Browser.close().catch(() => {});
      }
    } catch {
      /* ignore malformed links */
    }
  });

  // Links to other sites open in the system browser, not inside the app.
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!/^https?:\/\//i.test(href)) return;
    if (new URL(href).origin === window.location.origin) return;
    e.preventDefault();
    Browser.open({ url: href }).catch(() => {});
  }, true);

  // Show the app as soon as the first screen is ready (no long splash).
  requestAnimationFrame(() => SplashScreen.hide({ fadeOutDuration: 150 }).catch(() => {}));
}

export function openExternal(url) {
  return Browser.open({ url });
}

export async function share({ title, text, url }) {
  try {
    await Share.share({ title, text, url, dialogTitle: title });
    return 'shared';
  } catch {
    return 'cancelled';
  }
}

export async function networkStatus() {
  const s = await Network.getStatus();
  return { connected: s.connected, type: s.connectionType };
}

export function onNetworkChange(cb) {
  const handle = Network.addListener('networkStatusChange', (s) => cb({ connected: s.connected, type: s.connectionType }));
  return () => handle.then((h) => h.remove()).catch(() => {});
}

export async function saveFile(blob, filename) {
  // Share the file as text through the Android share sheet (Save to Files, Drive, email...).
  const text = await blob.text();
  await Share.share({ title: filename, text, dialogTitle: `Save ${filename}` }).catch(() => {});
  return 'shared';
}
