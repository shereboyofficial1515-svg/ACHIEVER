import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../config/env.js';
import * as txRepo from '../repositories/transactionSecurityRepository.js';
import * as auditService from './auditService.js';
import * as emailService from './emailService.js';
import * as notificationService from './notificationService.js';
import * as settingsService from './settingsService.js';
import { AppError } from '../utils/AppError.js';
import { hmac, randomDigits, safeEqual } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { maskEmail } from '../utils/sanitize.js';

/**
 * Transaction security.
 *
 *  Transaction PIN   6 digits, separate from the sign-in password. Stored as
 *                    scrypt(HMAC(server key, PIN), salt): a leaked database
 *                    alone cannot be brute-forced offline. Never logged or
 *                    returned. Wrong entries lock it for a while.
 *
 *  Authorisation     Every bill purchase is approved with a single-use
 *  challenge         challenge bound to the exact reviewed amount/recipient:
 *                      web / no biometric: PIN + a code emailed to the owner
 *                      Android + biometric: a signature from a device key that
 *                      the phone's secure hardware releases only after a
 *                      fingerprint/face/device-credential check.
 *                    The server verifies the challenge itself; a client flag
 *                    such as isBiometric=true is never accepted as proof.
 */
const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const pepper = (pin) => hmac(env.dataEncryptionKey, `transaction-pin:${pin}`);

const WEAK = new Set(['000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999',
  '123456', '654321', '012345', '543210', '123123', '121212', '112233', '000001', '696969', '101010']);

export function assertPinStrength(pin) {
  if (!/^\d{6}$/.test(String(pin))) throw AppError.badRequest('Your transaction PIN must be exactly 6 digits', 'PIN_FORMAT');
  const s = String(pin);
  const ascending = '0123456789012345'.includes(s);
  const descending = '9876543210987654'.includes(s);
  if (WEAK.has(s) || ascending || descending || /^(\d)\1{5}$/.test(s)) {
    throw AppError.badRequest('Choose a PIN that is harder to guess (not repeated or sequential digits)', 'PIN_TOO_WEAK');
  }
}

export async function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pepper(pin), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function checkPinHash(pin, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const key = await scrypt(pepper(pin), Buffer.from(salt, 'base64url'), SCRYPT.keylen, { N: Number(N), r: Number(r), p: Number(p) });
  return safeEqual(key.toString('base64url'), hash);
}

async function event(user, type, req, extra = {}) {
  await txRepo.insertEvent({
    user_id: user.id, type, session_id: user.sessionId ?? null, device_key_id: extra.deviceKeyId ?? null,
    ip_address: req?.ip || null, metadata: extra.metadata ?? {},
  }).catch((err) => logger.warn({ err: err.message, type }, 'transaction security event not recorded'));
}

// PIN ------------------------------------------------------------------------------------------------
export async function pinStatus(user) {
  const c = await txRepo.findCredential(user.id);
  return {
    set: Boolean(c),
    changedAt: c?.changed_at ?? null,
    locked: Boolean(c?.locked_until && new Date(c.locked_until).getTime() > Date.now()),
    lockedUntil: c?.locked_until && new Date(c.locked_until).getTime() > Date.now() ? c.locked_until : null,
  };
}

/**
 * Create or change the PIN. The caller has already consumed a security
 * challenge (sign-in password + emailed code) for 'transaction_pin_change'.
 */
export async function setPin(user, pin, req) {
  assertPinStrength(pin);
  const existing = await txRepo.findCredential(user.id);
  await txRepo.upsertCredential(user.id, await hashPin(pin));
  const type = existing ? 'transaction_pin_changed' : 'transaction_pin_set';
  await event(user, type, req);
  await auditService.record({ actorId: user.id, action: `security.${type}`, resourceType: 'profile', resourceId: user.id, req });
  await notificationService.notify(user.id, {
    type, category: 'security',
    title: existing ? 'Transaction PIN changed' : 'Transaction PIN created',
    body: existing
      ? 'Your transaction PIN was changed. If this was not you, contact support immediately.'
      : 'Your transaction PIN was created. You will use it to approve payments.',
    dedupeKey: `${type}:${user.id}:${Date.now()}`,
  });
  return pinStatus(user);
}

export async function verifyPin(user, pin, req) {
  const c = await txRepo.findCredential(user.id);
  if (!c) throw AppError.forbidden('Create a transaction PIN first (Settings → Security → Transaction PIN)', 'TRANSACTION_PIN_NOT_SET');
  if (c.locked_until && new Date(c.locked_until).getTime() > Date.now()) {
    const minutes = Math.ceil((new Date(c.locked_until).getTime() - Date.now()) / 60000);
    throw AppError.tooMany(`Your transaction PIN is locked after too many attempts. Try again in ${minutes} minute(s).`, 'TRANSACTION_PIN_LOCKED');
  }
  if (await checkPinHash(String(pin ?? ''), c.pin_hash)) {
    if (c.failed_attempts) await txRepo.updateCredential(user.id, { failed_attempts: 0, locked_until: null });
    return true;
  }
  const [max, lockMinutes] = await Promise.all([
    settingsService.getInt('security.transaction_pin_max_attempts', 5),
    settingsService.getInt('security.transaction_pin_lock_minutes', 30),
  ]);
  const failed = c.failed_attempts + 1;
  const lock = failed >= max;
  await txRepo.updateCredential(user.id, {
    failed_attempts: lock ? 0 : failed,
    locked_until: lock ? new Date(Date.now() + lockMinutes * 60_000).toISOString() : null,
  });
  await event(user, lock ? 'transaction_pin_locked' : 'transaction_pin_failed', req, { metadata: { attempts: failed } });
  if (lock) {
    await notificationService.notify(user.id, {
      type: 'transaction_pin_locked', category: 'security', title: 'Transaction PIN locked',
      body: `Your transaction PIN was locked for ${lockMinutes} minutes after several incorrect attempts. If this was not you, change your password.`,
      dedupeKey: `pin_locked:${user.id}:${Date.now()}`,
    });
    throw AppError.tooMany(`Too many incorrect PIN attempts. Your transaction PIN is locked for ${lockMinutes} minutes.`, 'TRANSACTION_PIN_LOCKED');
  }
  throw AppError.badRequest(`Incorrect transaction PIN. ${max - failed} attempt(s) left.`, 'TRANSACTION_PIN_INVALID');
}

// Device-key signatures -------------------------------------------------------------------------------
/** Validates an EC P-256 public key (SPKI, base64) as produced by the Android Keystore. */
export function parsePublicKey(spkiB64) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(String(spkiB64), 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
    return key;
  } catch {
    return null;
  }
}

/** ECDSA P-256 / SHA-256 signature (DER, base64) over the UTF-8 payload. */
export function verifySignature(spkiB64, payload, signatureB64) {
  const key = parsePublicKey(spkiB64);
  if (!key || !signatureB64) return false;
  try {
    return crypto.verify('sha256', Buffer.from(payload, 'utf8'), key, Buffer.from(String(signatureB64), 'base64'));
  } catch {
    return false;
  }
}

// Authorisation challenges ---------------------------------------------------------------------------
/** Binds a challenge to what the user reviewed: any change to the bill invalidates it. */
export function targetHash(bill) {
  return hmac(env.dataEncryptionKey, [
    'bill', bill.id, bill.user_id, bill.total_amount, bill.amount, bill.fee, bill.service_id,
    bill.customer_identifier, bill.variation_code ?? '', bill.quantity ?? 1, bill.phone,
  ].join('|'));
}

const signPayloadFor = (challengeId, nonce, hash) => `achiever-tx:v1:${challengeId}:${nonce}:${hash}`;
const otpHash = (challengeId, userId, code) => hmac(env.JWT_SECRET, `tx-otp:${challengeId}:${userId}:${code}`);
const MAX_CHALLENGES_PER_HOUR = 10;

/**
 * Start authorising a reviewed bill.
 *   method 'email_otp'        : the transaction PIN is checked now, then a code is emailed
 *   method 'device_biometric' : returns a payload for the device key to sign
 */
export async function createChallenge(user, { bill, method, pin, deviceKeyId, describe }, req) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  if ((await txRepo.countRecentChallenges(user.id, since)) >= MAX_CHALLENGES_PER_HOUR) {
    throw AppError.tooMany('Too many approval requests. Please wait a while and try again.', 'TX_CHALLENGE_RATE_LIMITED');
  }
  const minutes = await settingsService.getInt('security.transaction_auth_minutes', 10);
  const base = {
    id: crypto.randomUUID(), user_id: user.id, purpose: 'bill_payment', target_id: bill.id, target_hash: targetHash(bill),
    session_id: user.sessionId ?? null, ip_address: req?.ip || null,
    expires_at: new Date(Date.now() + minutes * 60_000).toISOString(),
  };

  if (method === 'device_biometric') {
    const key = deviceKeyId ? await txRepo.findDeviceKey(deviceKeyId) : null;
    if (!key || key.user_id !== user.id || key.revoked_at || !key.allow_transactions) {
      throw AppError.forbidden('Biometric approval is not set up on this device. Use your PIN instead.', 'BIOMETRIC_NOT_ENROLLED');
    }
    const nonce = crypto.randomBytes(32).toString('base64url');
    const row = await txRepo.insertChallenge({ ...base, method, nonce, device_key_id: key.id, max_attempts: 3 });
    await event(user, 'auth_challenge_issued', req, { deviceKeyId: key.id, metadata: { method, bill_id: bill.id } });
    return { challengeId: row.id, method, signPayload: signPayloadFor(row.id, nonce, row.target_hash), expiresAt: row.expires_at };
  }

  if (method !== 'email_otp') throw AppError.badRequest('Unknown approval method', 'UNKNOWN_METHOD');
  await verifyPin(user, pin, req);
  const code = randomDigits(6);
  const row = await txRepo.insertChallenge({
    ...base, method, code_hash: otpHash(base.id, user.id, code), destination_masked: maskEmail(user.email), max_attempts: 5,
  });
  const result = await emailService.sendSecurityCode(user.email, user.fullName, code, `approve ${describe}`);
  if (!result.ok && !env.isProduction) logger.warn({ userId: user.id }, `Email not delivered (${result.error}). Development transaction code: ${code}`);
  await event(user, 'auth_challenge_issued', req, { metadata: { method, bill_id: bill.id } });
  return { challengeId: row.id, method, sentTo: row.destination_masked, sent: result.ok, expiresAt: row.expires_at };
}

/**
 * Verify and consume a challenge for this exact bill. Throws on any mismatch.
 * Returns the method used ('email_otp' | 'device_biometric').
 */
export async function consumeChallenge(user, { challengeId, code, signature }, bill, req) {
  const invalid = AppError.badRequest('The approval is invalid or has expired. Start again.', 'TX_AUTH_INVALID');
  if (!challengeId) throw AppError.forbidden('Approve this payment first', 'TX_AUTH_REQUIRED');
  const c = await txRepo.findChallenge(challengeId);
  if (!c || c.user_id !== user.id || c.target_id !== bill.id || c.purpose !== 'bill_payment') throw invalid;
  if (c.consumed_at) throw AppError.badRequest('This approval has already been used', 'TX_AUTH_USED');
  if (new Date(c.expires_at).getTime() < Date.now()) throw AppError.badRequest('This approval has expired. Start again.', 'TX_AUTH_EXPIRED');
  if (c.session_id && user.sessionId && c.session_id !== user.sessionId) throw invalid;
  if (!safeEqual(c.target_hash, targetHash(bill))) throw invalid;   // the bill changed after review
  if (c.attempts >= c.max_attempts) throw AppError.tooMany('Too many failed attempts. Start again.', 'TX_AUTH_LOCKED');

  let good = false;
  let deviceKeyId = null;
  if (c.method === 'email_otp') {
    good = Boolean(code) && safeEqual(otpHash(c.id, user.id, String(code)), c.code_hash);
  } else {
    const key = await txRepo.findDeviceKey(c.device_key_id);
    deviceKeyId = key?.id ?? null;
    good = Boolean(key && !key.revoked_at && key.user_id === user.id && key.allow_transactions
      && verifySignature(key.public_key, signPayloadFor(c.id, c.nonce, c.target_hash), signature));
  }
  if (!good) {
    await txRepo.updateChallenge(c.id, { attempts: c.attempts + 1 });
    await event(user, 'auth_challenge_failed', req, { deviceKeyId, metadata: { method: c.method, bill_id: bill.id } });
    throw c.method === 'email_otp'
      ? AppError.badRequest('The code is incorrect or has expired', 'TX_AUTH_INVALID')
      : AppError.badRequest('Biometric approval could not be verified. Try again or use your PIN.', 'TX_AUTH_INVALID');
  }
  await txRepo.updateChallenge(c.id, { verified_at: new Date().toISOString() });
  if (!(await txRepo.consumeChallenge(c.id))) throw AppError.badRequest('This approval has already been used', 'TX_AUTH_USED');
  if (deviceKeyId) await txRepo.touchDeviceKey(deviceKeyId);
  await event(user, 'auth_challenge_verified', req, { deviceKeyId, metadata: { method: c.method, bill_id: bill.id } });
  return { method: c.method, challengeId: c.id };
}

export const __test__ = { signPayloadFor, otpHash };
