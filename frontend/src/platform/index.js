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

// Push notifications -------------------------------------------------------------------------------
// Android only, and only in builds that include Firebase (google-services.json):
// build-android.mjs sets VITE_PUSH_ENABLED. Otherwise in-app, email and SMS notices are used.
export const pushSupported = () => isNative() && import.meta.env.VITE_PUSH_ENABLED === 'true';

export async function pushPermissionState() {
  if (!pushSupported()) return 'unavailable';
  const m = await nativeModule();
  return m.pushPermission().catch(() => 'unavailable');
}

/** Asks for permission (only when the user chose to turn notifications on) and registers the device. */
export async function registerPushNotifications(onToken) {
  if (!pushSupported()) return { available: false, reason: 'not_configured' };
  const m = await nativeModule();
  return m.registerPush(onToken);
}

export async function unregisterPushNotifications() {
  if (!pushSupported()) return;
  const m = await nativeModule();
  await m.unregisterPush();
}

// Biometrics (Android) --------------------------------------------------------------------------------
// The server never trusts "biometric = true" from here: the device key signs a
// server challenge after the fingerprint/face check, and the server verifies it.
const BIO_ALIAS = 'achiever-device-key';
const BIO_STORE = 'achiever.biometric';

/** { keyId, allowLogin, allowTransactions, label } saved after enrolment (public identifiers only). */
export function biometricEnrolment() {
  try {
    return JSON.parse(localStorage.getItem(BIO_STORE) || 'null');
  } catch {
    return null;
  }
}
function saveEnrolment(v) {
  try {
    if (v) localStorage.setItem(BIO_STORE, JSON.stringify(v));
    else localStorage.removeItem(BIO_STORE);
  } catch {
    /* storage unavailable */
  }
}

export async function biometricAvailability() {
  if (!isNative()) return { available: false, reason: 'web' };
  const m = await nativeModule();
  return m.biometricStatus().catch(() => ({ available: false, reason: 'unavailable' }));
}

/** Creates the Keystore key; returns its public key (base64 SPKI). */
export async function createBiometricKey() {
  const m = await nativeModule();
  return (await m.createBiometricKey(BIO_ALIAS)).publicKey;
}

/** Shows the system prompt and signs the server's payload. Rejects with code CANCELLED if the user cancels. */
export async function signWithBiometrics(payload, prompt) {
  const m = await nativeModule();
  return m.biometricSign(BIO_ALIAS, payload, prompt);
}

export async function unlockWithBiometrics(prompt) {
  const m = await nativeModule();
  return m.biometricUnlock(prompt);
}

export function rememberBiometricEnrolment(enrolment) {
  saveEnrolment(enrolment);
}

export async function forgetBiometrics() {
  saveEnrolment(null);
  if (!isNative()) return;
  const m = await nativeModule();
  await m.deleteBiometricKey(BIO_ALIAS).catch(() => {});
}

/** Android: write the WebView's cookies to disk now (so killing the app right after sign-in keeps the session). */
export async function flushNativeCookies() {
  if (!isNative()) return;
  const m = await nativeModule();
  await m.flushCookies().catch(() => {});
}

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

/**
 * Share a generated file (receipt PNG / PDF).
 *   Android: written to the app cache and offered through the native share sheet.
 *   Web: Web Share API with files when supported, otherwise a download.
 * Returns 'shared' | 'downloaded' | 'cancelled'. Throws if it could not be shared.
 */
export async function shareGeneratedFile(blob, filename, { title = 'ACHIEVER receipt' } = {}) {
  if (!blob || !blob.size) throw new Error('EMPTY_FILE');
  if (isNative()) {
    const m = await nativeModule();
    const res = await m.shareFile({ data: await blobToBase64(blob), filename, mimeType: blob.type, title });
    if (!res?.size) throw new Error('EMPTY_FILE');
    return 'shared';
  }
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';   // the person closed the share sheet
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}

/** Key-press feedback for the secure keypad (Android only; no-op elsewhere). */
export async function hapticFeedback(kind = 'tap') {
  if (!isNative()) return;
  const m = await nativeModule();
  await m.haptic(kind).catch(() => {});
}

/** Hide the screen from screenshots / recent apps while sensitive data is shown (Android). */
export async function setSecureScreen(enabled) {
  if (!isNative()) return;
  const m = await nativeModule();
  await m.setSecureScreen(enabled).catch(() => {});
}
