import { api } from './api.js';
import { registerPushNotifications, unregisterPushNotifications } from '../platform/index.js';

const PUSH_TOKEN = 'achiever.pushToken';

/** Registers this phone for push (after the user chose to turn notifications on). Token refreshes are re-sent. */
export async function enablePush() {
  return registerPushNotifications(async (token) => {
    try { localStorage.setItem(PUSH_TOKEN, token); } catch { /* storage unavailable */ }
    await api.post('/push/devices', { token, appVersion: import.meta.env.VITE_APP_VERSION || undefined }).catch(() => {});
  });
}

/** On sign-out this phone stops receiving the account's notifications. */
export async function disablePushForSignOut() {
  let token = null;
  try {
    token = localStorage.getItem(PUSH_TOKEN);
    localStorage.removeItem(PUSH_TOKEN);
  } catch { /* ignore */ }
  if (token) await api.post('/push/devices/unregister', { token }).catch(() => {});
  await unregisterPushNotifications().catch(() => {});
}
