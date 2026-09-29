import { Capacitor } from '@capacitor/core';

/**
 * Platform adapter. The React app calls these functions; they use the browser
 * APIs on the web and native Android features inside the Capacitor app. The
 * Android module is loaded only in the app, so the website never ships or
 * runs native code paths.
 */
export function isNative() {
  return Capacitor.isNativePlatform();
}

export function getPlatform() {
  return Capacitor.getPlatform(); // 'web' | 'android' | 'ios'
}

let native = null;
function nativeModule() {
  if (!isNative()) return Promise.resolve(null);
  native ||= import('./android.js');
  return native;
}

/** Called once at startup (before React renders). */
export function initPlatform() {
  document.documentElement.dataset.platform = getPlatform();
  if (isNative()) nativeModule().then((m) => m.init()).catch((err) => console.error('native init failed', err));
}

/** Open terms, payment pages, provider sites etc. in the system browser on Android. */
export async function openExternalLink(url) {
  const m = await nativeModule();
  if (m) return m.openExternal(url);
  window.open(url, '_blank', 'noopener,noreferrer');
  return undefined;
}

/** Native share sheet on Android; Web Share API where available; otherwise copy to clipboard. Returns how it was shared. */
export async function shareContent({ title, text, url }) {
  const m = await nativeModule();
  if (m) return m.share({ title, text, url });
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  await navigator.clipboard?.writeText([text, url].filter(Boolean).join(' '));
  return 'copied';
}

/** { connected, type } — type is 'wifi' | 'cellular' | 'none' | 'unknown'. */
export async function getNetworkStatus() {
  const m = await nativeModule();
  if (m) return m.networkStatus();
  return { connected: navigator.onLine !== false, type: 'unknown' };
}

/** Subscribe to connection changes; returns an unsubscribe function. */
export function onNetworkChange(cb) {
  if (isNative()) {
    let off = () => {};
    let cancelled = false;
    nativeModule().then((m) => {
      if (!cancelled) off = m.onNetworkChange(cb);
    });
    return () => {
      cancelled = true;
      off();
    };
  }
  const on = () => cb({ connected: true, type: 'unknown' });
  const offline = () => cb({ connected: false, type: 'none' });
  window.addEventListener('online', on);
  window.addEventListener('offline', offline);
  return () => {
    window.removeEventListener('online', on);
    window.removeEventListener('offline', offline);
  };
}

/**
 * Ask for camera / microphone only when a feature needs it (a call, a photo).
 * In the Android app the WebView request triggers the Android permission
 * prompt; nothing is requested at startup.
 */
export async function requestMediaPermission({ audio = false, video = false }) {
  if (!navigator.mediaDevices?.getUserMedia) return { granted: false, reason: 'unsupported' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video });
    stream.getTracks().forEach((t) => t.stop());
    return { granted: true };
  } catch (err) {
    return { granted: false, reason: err?.name === 'NotAllowedError' ? 'denied' : 'unavailable' };
  }
}
export const requestCameraPermission = () => requestMediaPermission({ video: true });
export const requestMicrophonePermission = () => requestMediaPermission({ audio: true });

/** Save a generated file (CSV report, receipt). Android: share sheet (save to Files, Drive, WhatsApp...). */
export async function saveFile(blob, filename) {
  const m = await nativeModule();
  if (m) return m.saveFile(blob, filename);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
  return 'downloaded';
}

/**
 * Push notifications: architecture only. Android push needs Firebase Cloud
 * Messaging (google-services.json) and a server-side sender; until then this
 * reports "unavailable" and the app keeps using in-app, email and SMS notices.
 */
export async function registerPushNotifications() {
  return { available: false, reason: 'not_configured' };
}
