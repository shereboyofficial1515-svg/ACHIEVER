import { registerPlugin } from '@capacitor/core';
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

// In-app native plugin (android/app/.../AchieverSecurityPlugin.java).
const Security = registerPlugin('AchieverSecurity');

// Screens where "back" always leaves the app instead of navigating (never logs out).
const ROOT_PATHS = new Set(['/', '/app']);

// React Router records the position in its own history entries (idx 0 = first screen of this app session).
function canGoBackInApp() {
  return (window.history.state?.idx ?? 0) > 0;
}

async function applyStatusBar(theme) {
  try {
    // Dark icons on the light theme, light icons on the dark theme.
    await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: theme === 'dark' ? '#0e1412' : '#f5f7f6' });
  } catch {
    /* older WebView / not supported */
  }
}

/**
 * The screen "above" this one, for when there is no in-app history to go back to
 * (opened from a notification or deep link): Group info → chat → Messages → Home.
 */
export function parentPath(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (ROOT_PATHS.has(path) || !path.startsWith('/app/')) return null;
  const chatSub = /^(\/app\/messages\/[^/]+)\/(info|settings|media)$/.exec(path);
  if (chatSub) return path.endsWith('/settings') ? `${chatSub[1]}/info` : chatSub[1];
  if (path.startsWith('/app/contacts/')) return '/app/messages';   // a person's profile is opened from chats
  const parts = path.split('/').filter(Boolean);   // ['app', 'messages', ':id', ...]
  return parts.length > 2 ? `/${parts.slice(0, -1).join('/')}` : '/app';
}

function handleBack() {
  // 1) close a dialog or drawer, 2) go back a screen, 3) go up to the parent screen,
  // 4) at a root screen, leave the app (it stays signed in).
  if (closeTopOverlay()) return;
  if (ROOT_PATHS.has(window.location.pathname)) {
    App.minimizeApp().catch(() => App.exitApp());
    return;
  }
  if (canGoBackInApp()) {
    window.history.back();
    return;
  }
  const parent = parentPath(window.location.pathname);
  if (!parent) {
    App.minimizeApp().catch(() => App.exitApp());
    return;
  }
  // Replace this entry with its parent and let React Router render it.
  window.history.replaceState({ usr: null, key: 'up', idx: 0 }, '', parent);
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
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

  // App lock / session handling: tell the app how long it was in the background.
  let hiddenAt = null;
  App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) {
      hiddenAt = Date.now();
      window.dispatchEvent(new CustomEvent('achiever:app-paused'));
      return;
    }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;
    window.dispatchEvent(new CustomEvent('achiever:app-resumed', { detail: { awayMs: away } }));
  });

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

// Biometrics (Keystore key; see AchieverSecurityPlugin.java) ----------------------------------
export const biometricStatus = () => Security.status();
export const createBiometricKey = (alias) => Security.createKey({ alias });
export const hasBiometricKey = (alias) => Security.hasKey({ alias }).then((r) => r.exists);
export const deleteBiometricKey = (alias) => Security.deleteKey({ alias });
export const biometricSign = (alias, payload, prompt = {}) => Security.sign({ alias, payload, ...prompt }).then((r) => r.signature);
export const biometricUnlock = (prompt = {}) => Security.authenticate(prompt);
export const setSecureScreen = (enabled) => Security.setSecureScreen({ enabled });
export const flushCookies = () => Security.flushCookies();
export const haptic = (kind) => Security.haptic({ kind });
export const shareFile = (opts) => Security.shareFile(opts);

// Push notifications (Firebase Cloud Messaging) ------------------------------------------------
export async function pushPermission() {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  return (await PushNotifications.checkPermissions()).receive;
}

/** Ask Android for permission, then register; the FCM token is sent to the API by the caller. */
export async function registerPush(onToken) {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return { available: true, granted: false };
  await PushNotifications.removeAllListeners();
  await PushNotifications.createChannel({ id: 'general', name: 'Updates', description: 'Payments, reminders and referrals', importance: 3 }).catch(() => {});
  await PushNotifications.createChannel({ id: 'messages', name: 'Messages', description: 'New chat messages', importance: 4 }).catch(() => {});
  // Sleep mode: messages still arrive, without sound or vibration.
  await PushNotifications.createChannel({ id: 'quiet', name: 'Messages (sleep mode)', description: 'Chat messages while sleep mode is on', importance: 2, vibration: false }).catch(() => {});
  await PushNotifications.createChannel({ id: 'security', name: 'Security alerts', description: 'Sign-ins and account security', importance: 4 }).catch(() => {});
  // Token refresh: Firebase may issue a new token at any time; each one is re-registered.
  PushNotifications.addListener('registration', ({ value }) => onToken(value));
  PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const route = notification?.data?.route;
    if (typeof route === 'string' && route.startsWith('/app/')) window.dispatchEvent(new CustomEvent('achiever:navigate', { detail: { to: route } }));
  });
  await PushNotifications.register();
  return { available: true, granted: true };
}

export async function unregisterPush() {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  await PushNotifications.removeAllListeners().catch(() => {});
  await PushNotifications.unregister().catch(() => {});
}
