import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { db, run } from '../integrations/supabase/db.js';
import * as providerHealth from './providerHealthService.js';
import { AppError } from '../utils/AppError.js';
import { hmac } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { createSecretBox } from '../utils/secretBox.js';

/**
 * Android push notifications through Firebase Cloud Messaging (HTTP v1).
 *
 * Device tokens are stored encrypted (and looked up by an HMAC); the FCM
 * service-account key stays on the server. Lock-screen text never contains
 * amounts, account numbers, tokens or names: money and security notices use
 * a generic sentence and the details stay inside the app.
 */
const box = createSecretBox(env.dataEncryptionKey, 'achiever-push-tokens');
const tokenHash = (token) => hmac(env.dataEncryptionKey, `push-token:${token}`);
const TOKEN_RE = /^[A-Za-z0-9:_-]{20,4096}$/;

export const isConfigured = () => env.features.push;

// Devices -------------------------------------------------------------------------------------------
export async function registerDevice(user, { token, appVersion }) {
  if (!TOKEN_RE.test(String(token || ''))) throw AppError.badRequest('Invalid device token', 'INVALID_PUSH_TOKEN');
  const row = {
    user_id: user.id, token_hash: tokenHash(token), token_encrypted: box.seal(token), platform: 'android',
    app_version: appVersion ? String(appVersion).slice(0, 40) : null, last_seen_at: new Date().toISOString(),
    disabled_at: null, disabled_reason: null,
  };
  // A token that moves to another account (shared/sold phone) is re-assigned, never duplicated.
  await run(db.from('push_devices').upsert(row, { onConflict: 'token_hash' }).select('id'));
  return { registered: true, delivery: isConfigured() ? 'enabled' : 'not_configured' };
}

export async function unregisterDevice(user, token) {
  if (!token) return { removed: false };
  await run(db.from('push_devices').update({ disabled_at: new Date().toISOString(), disabled_reason: 'user_signed_out' })
    .eq('token_hash', tokenHash(token)).eq('user_id', user.id).select('id'));
  return { removed: true };
}

async function activeDevices(userId) {
  return run(db.from('push_devices').select('id, token_encrypted').eq('user_id', userId).is('disabled_at', null).limit(10));
}

async function disableDevice(id, reason) {
  await run(db.from('push_devices').update({ disabled_at: new Date().toISOString(), disabled_reason: reason }).eq('id', id).select('id'));
}

// FCM auth -------------------------------------------------------------------------------------------
let cachedToken = null;

async function accessToken(fetchImpl = fetch) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: env.FCM_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const key = env.FCM_PRIVATE_KEY.replace(/\\n/g, '\n');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url');
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`FCM auth failed (${res.status})`);
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000 };
  return cachedToken.value;
}

// Messages -------------------------------------------------------------------------------------------
const GENERIC = {
  payments: 'You have a new payment update. Open ACHIEVER to view it.',
  payouts: 'You have a new payout update. Open ACHIEVER to view it.',
  security: 'There is a security notice on your account. Open ACHIEVER to review it.',
};

/** What the lock screen shows. */
export function lockScreenText(item) {
  return { title: String(item.title).slice(0, 80), body: GENERIC[item.category] || String(item.body).slice(0, 180) };
}

function route(data = {}) {
  if (data.call_id && data.conversation_id) return `/app/messages/${data.conversation_id}?call=${data.call_id}`;
  if (data.conversation_id) return `/app/messages/${data.conversation_id}`;
  if (data.bill_payment_id) return `/app/bills/history/${data.bill_payment_id}`;
  if (data.referral_id || data.reward_id) return '/app/referrals';
  if (data.group_id) return `/app/osusu/${data.group_id}`;
  if (data.plan_id) return `/app/collector/plans/${data.plan_id}`;
  return '/app/notifications';
}

/**
 * Send one FCM message (built per device token by `build`) to all of a user's
 * active devices. "ok" means FCM accepted the message for at least one device;
 * it does not mean the phone displayed it.
 */
async function deliver(userId, build, { fetchImpl = fetch, kind = 'send' } = {}) {
  if (!isConfigured()) return { ok: false, skipped: true, error: 'PUSH_NOT_CONFIGURED' };
  const devices = await activeDevices(userId);
  if (!devices.length) return { ok: false, skipped: true, error: 'NO_DEVICES' };
  let token;
  try {
    token = await accessToken(fetchImpl);
  } catch {
    providerHealth.record('fcm', { ok: false, errorCode: 'AUTH_FAILED', kind });
    return { ok: false, error: 'PUSH_AUTH_FAILED' };
  }
  let delivered = 0;
  for (const d of devices) {
    let deviceToken;
    try {
      deviceToken = box.open(d.token_encrypted);
    } catch {
      await disableDevice(d.id, 'unreadable_token');
      continue;
    }
    const started = Date.now();
    const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token: deviceToken, ...build() } }),
    }).catch(() => null);
    if (res?.ok) {
      delivered += 1;
      providerHealth.record('fcm', { ok: true, latencyMs: Date.now() - started, kind });
      continue;
    }
    const body = res ? await res.json().catch(() => ({})) : {};
    const status = body?.error?.details?.find?.((x) => x.errorCode)?.errorCode || body?.error?.status;
    if (res && (res.status === 404 || status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT')) {
      await disableDevice(d.id, 'token_invalid');   // app uninstalled or token rotated
    } else {
      providerHealth.record('fcm', { ok: false, errorCode: status || `HTTP_${res?.status ?? 0}`, kind });
      logger.warn({ status: res?.status ?? 0, kind }, 'push not delivered');
    }
  }
  return delivered ? { ok: true, devices: delivered } : { ok: false, error: 'PUSH_NOT_DELIVERED' };
}

/**
 * Deliver one notification to the user's devices.
 * Returns { ok, skipped?, error? } like the email/SMS channels.
 */
export async function send(item, { fetchImpl = fetch } = {}) {
  const text = lockScreenText(item);
  return deliver(item.user_id, () => ({
    notification: text,
    data: { notification_id: String(item.id), category: String(item.category), route: route(item.data) },
    android: {
      priority: item.category === 'security' || (item.category === 'messages' && !item.quiet) ? 'high' : 'normal',
      // Sleep mode: messages arrive on the silent channel; security alerts always use their own channel.
      // A notice about a call (e.g. "Missed call") replaces that call's ringing notification (same tag).
      notification: {
        channel_id: item.category === 'security' ? 'security' : item.category === 'messages' ? (item.quiet ? 'quiet' : 'messages') : 'general',
        ...(item.data?.call_id ? { tag: `call-${item.data.call_id}` } : {}),
      },
    },
  }), { fetchImpl });
}

const CALL_TEXT = {
  ring: (c) => ({ title: `Incoming ${c.scope === 'group' ? 'group ' : ''}${c.call_type === 'video' ? 'video' : 'voice'} call`, body: 'Open ACHIEVER to answer.' }),
  cancelled: (c) => ({ title: `Missed ${c.call_type === 'video' ? 'video' : 'voice'} call`, body: 'The call ended before it was answered.' }),
  answered: () => ({ title: 'Call answered', body: 'You answered this call on another device.' }),
  ended: () => ({ title: 'Call ended', body: 'This call has ended.' }),
};

/**
 * Incoming-call push and its follow-ups. "ring" uses the high-importance
 * "calls" channel and a short time-to-live, so a call that has already ended is
 * never delivered late. Every follow-up carries the same tag, so it replaces
 * the ringing notification on the phone instead of adding another one.
 * The payload holds identifiers only: no LiveKit token, room secret or name.
 */
export async function sendCall(userId, call, kind = 'ring', { fetchImpl = fetch } = {}) {
  const ringing = kind === 'ring';
  return deliver(userId, () => ({
    notification: CALL_TEXT[kind](call),
    data: {
      type: 'call', call_event: kind, call_id: String(call.id), conversation_id: String(call.conversation_id),
      call_type: String(call.call_type), scope: String(call.scope),
      route: route({ call_id: call.id, conversation_id: call.conversation_id }),
    },
    android: {
      priority: ringing ? 'high' : 'normal',
      ttl: ringing ? '45s' : '3600s',
      notification: { channel_id: ringing ? 'calls' : 'quiet', tag: `call-${call.id}` },
    },
  }), { fetchImpl, kind: `call_${kind}` });
}

export function __reset() {
  cachedToken = null;
}
