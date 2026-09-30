import crypto from 'node:crypto';
import { BLOCKED_STATES } from '../config/constants.js';
import { env } from '../config/env.js';
import { createAuthClient, supabaseAdmin } from '../integrations/supabase/client.js';
import * as txRepo from '../repositories/transactionSecurityRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import * as auditService from './auditService.js';
import * as notificationService from './notificationService.js';
import { parsePublicKey, verifySignature } from './transactionAuthService.js';
import { AppError } from '../utils/AppError.js';
import { hmac, safeEqual } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

/**
 * Android biometric sign-in and approval.
 *
 * The phone creates an EC P-256 key inside the Android Keystore that can be
 * used only after a biometric (or device credential) check and is destroyed
 * if new fingerprints/faces are enrolled. ACHIEVER stores only the PUBLIC key.
 * No fingerprint or face data ever leaves the phone, and no password or
 * long-lived token is stored on it.
 *
 *   enrol   password re-check -> registration nonce -> the device signs it
 *           with the new key (proving it holds the key) -> public key saved
 *   sign-in challenge nonce -> biometric prompt -> signature -> the server
 *           verifies it and creates a normal session
 */
const REG_TTL_MS = 5 * 60_000;
const LOGIN_TTL_MS = 2 * 60_000;
const MAX_KEYS = 5;

const regPayload = (userId, nonce) => `achiever-register:v1:${userId}:${nonce}`;
const loginPayload = (challengeId, keyId, nonce) => `achiever-login:v1:${challengeId}:${keyId}:${nonce}`;

function sealRegistration(userId, nonce, exp) {
  const body = Buffer.from(JSON.stringify({ u: userId, n: nonce, e: exp })).toString('base64url');
  return `${body}.${hmac(env.SESSION_SECRET, `device-reg:${body}`, 'base64url')}`;
}

function openRegistration(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac || !safeEqual(mac, hmac(env.SESSION_SECRET, `device-reg:${body}`, 'base64url'))) return null;
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return v.e > Date.now() ? v : null;
  } catch {
    return null;
  }
}

/** Step 1 of enrolment: the sign-in password is checked again. */
export async function startEnrolment(user, password, verifyPassword, req) {
  if (!(await verifyPassword(user.email, password))) {
    await auditService.record({ actorId: user.id, action: 'security.biometric.enrol', resourceType: 'profile', resourceId: user.id, result: 'failure', metadata: { reason: 'password' }, req });
    throw AppError.badRequest('Your password is incorrect', 'INVALID_CREDENTIALS');
  }
  if ((await txRepo.listDeviceKeys(user.id)).length >= MAX_KEYS) {
    throw AppError.conflict(`You can use biometrics on up to ${MAX_KEYS} devices. Remove one first.`, 'TOO_MANY_DEVICES');
  }
  const nonce = crypto.randomBytes(32).toString('base64url');
  const exp = Date.now() + REG_TTL_MS;
  return { registrationToken: sealRegistration(user.id, nonce, exp), signPayload: regPayload(user.id, nonce), expiresAt: new Date(exp).toISOString() };
}

/** Step 2: save the public key once the device proves it holds the private key. */
export async function completeEnrolment(user, { registrationToken, publicKey, signature, label, allowLogin = true, allowTransactions = true }, req) {
  const reg = openRegistration(registrationToken);
  if (!reg || reg.u !== user.id) throw AppError.badRequest('Biometric setup expired. Start again.', 'ENROLMENT_EXPIRED');
  if (!parsePublicKey(publicKey)) throw AppError.badRequest('Unsupported device key', 'INVALID_DEVICE_KEY');
  if (!verifySignature(publicKey, regPayload(user.id, reg.n), signature)) {
    throw AppError.badRequest('Biometric setup could not be verified. Try again.', 'ENROLMENT_SIGNATURE_INVALID');
  }
  const key = await txRepo.insertDeviceKey({
    user_id: user.id, public_key: publicKey, label: String(label || 'Android device').slice(0, 120), platform: 'android',
    allow_login: Boolean(allowLogin), allow_transactions: Boolean(allowTransactions),
  });
  await txRepo.insertEvent({ user_id: user.id, type: 'biometric_enabled', session_id: user.sessionId ?? null, device_key_id: key.id, ip_address: req?.ip || null, metadata: { allowLogin, allowTransactions } });
  await auditService.record({ actorId: user.id, action: 'security.biometric.enabled', resourceType: 'biometric_device_key', resourceId: key.id, req });
  await notificationService.notify(user.id, {
    type: 'biometric_enabled', category: 'security', title: 'Biometric sign-in turned on',
    body: `Biometric sign-in and approval were turned on for ${key.label}. If this was not you, turn it off in Settings and change your password.`,
    dedupeKey: `bio_on:${key.id}`,
  });
  return format(key);
}

function format(k) {
  return { id: k.id, label: k.label, platform: k.platform, allowLogin: k.allow_login, allowTransactions: k.allow_transactions, createdAt: k.created_at, lastUsedAt: k.last_used_at };
}

export async function list(user) {
  return (await txRepo.listDeviceKeys(user.id)).map(format);
}

export async function revoke(user, keyId, req, reason = 'user_disabled') {
  const key = await txRepo.revokeDeviceKey(keyId, user.id, reason);
  if (!key) throw AppError.notFound('Device not found');
  await txRepo.insertEvent({ user_id: user.id, type: reason === 'key_invalidated' ? 'biometric_key_invalidated' : 'biometric_disabled', session_id: user.sessionId ?? null, device_key_id: key.id, ip_address: req?.ip || null, metadata: { reason } });
  await auditService.record({ actorId: user.id, action: 'security.biometric.disabled', resourceType: 'biometric_device_key', resourceId: key.id, metadata: { reason }, req });
  if (reason !== 'key_invalidated') {
    await notificationService.notify(user.id, {
      type: 'biometric_disabled', category: 'security', title: 'Biometric sign-in turned off',
      body: `Biometric sign-in was turned off for ${key.label}.`, dedupeKey: `bio_off:${key.id}`,
    });
  }
  return { revoked: true };
}

/** Called on password reset and "sign out everywhere": biometric keys stop working. */
export async function revokeAllForUser(userId, reason) {
  const rows = await txRepo.revokeAllDeviceKeys(userId, reason).catch((err) => {
    logger.warn({ err: err.message }, 'device keys not revoked');
    return [];
  });
  return rows.length;
}

// Sign-in ---------------------------------------------------------------------------------------------
export async function loginChallenge(keyId, req) {
  const key = await txRepo.findDeviceKey(keyId);
  // Same answer for unknown/revoked keys: nothing to learn by probing.
  if (!key || key.revoked_at || !key.allow_login) throw AppError.forbidden('Biometric sign-in is not available. Sign in with your password.', 'BIOMETRIC_LOGIN_UNAVAILABLE');
  const nonce = crypto.randomBytes(32).toString('base64url');
  const row = await txRepo.insertLoginChallenge({ key_id: key.id, nonce, ip_address: req?.ip || null, expires_at: new Date(Date.now() + LOGIN_TTL_MS).toISOString() });
  return { challengeId: row.id, signPayload: loginPayload(row.id, key.id, nonce), expiresAt: row.expires_at };
}

/** Supabase has no "sign in by key" grant; mint a session for the verified user server-side. */
async function mintSession(email) {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) throw AppError.unavailable('Sign-in is temporarily unavailable. Use your password.', 'SESSION_MINT_FAILED');
  const client = createAuthClient();
  const { data: v, error: e2 } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (e2 || !v?.session) throw AppError.unavailable('Sign-in is temporarily unavailable. Use your password.', 'SESSION_MINT_FAILED');
  return v.session;
}

export async function login({ challengeId, keyId, signature }, req) {
  const denied = AppError.unauthorized('Biometric sign-in failed. Sign in with your password.', 'BIOMETRIC_LOGIN_FAILED');
  const c = await txRepo.findLoginChallenge(challengeId);
  if (!c || c.key_id !== keyId || c.consumed_at || new Date(c.expires_at).getTime() < Date.now()) throw denied;
  const key = await txRepo.findDeviceKey(keyId);
  if (!key || key.revoked_at || !key.allow_login) throw denied;
  if (!verifySignature(key.public_key, loginPayload(c.id, key.id, c.nonce), signature)) {
    await auditService.record({ actorId: key.user_id, action: 'auth.login.biometric', resourceType: 'biometric_device_key', resourceId: key.id, result: 'failure', req });
    throw denied;
  }
  if (!(await txRepo.consumeLoginChallenge(c.id))) throw denied;
  const profile = await userRepo.findById(key.user_id);
  if (!profile) throw denied;
  if (profile.locked_until && new Date(profile.locked_until).getTime() > Date.now()) {
    throw AppError.tooMany('Your account is temporarily locked. Try again later.', 'ACCOUNT_LOCKED');
  }
  if (BLOCKED_STATES.includes(profile.account_status)) throw AppError.forbidden('This account is not active. Contact support for help.', 'ACCOUNT_SUSPENDED');
  const session = await mintSession(profile.email);
  await txRepo.touchDeviceKey(key.id);
  await userRepo.registerLoginSuccess(profile.id);
  await auditService.record({ actorId: profile.id, action: 'auth.login.biometric', resourceType: 'biometric_device_key', resourceId: key.id, req });
  return { session, userId: profile.id };
}

export const __test__ = { regPayload, loginPayload, sealRegistration, openRegistration };
