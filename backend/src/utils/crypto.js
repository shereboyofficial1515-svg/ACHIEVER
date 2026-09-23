import crypto from 'node:crypto';
import { env } from '../config/env.js';

export function hmac(secret, value, encoding = 'hex') {
  return crypto.createHmac('sha256', secret).update(String(value)).digest(encoding);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function randomDigits(length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += crypto.randomInt(0, 10).toString();
  return out;
}

export function randomCode(length = 8, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[crypto.randomInt(0, alphabet.length)];
  return out;
}

/** Keyed, one-way hash for identity numbers (BVN/NIN). */
export function hashIdentityNumber(idType, idNumber) {
  return hmac(env.IDENTITY_HASH_SECRET, `${idType}:${idNumber}`);
}

export function hashOtp(userId, purpose, code) {
  return hmac(env.JWT_SECRET, `otp:${purpose}:${userId}:${code}`);
}

export function hashInviteToken(token) {
  return hmac(env.JWT_SECRET, `invite:${token}`);
}

/** Paystack signs webhook bodies with HMAC-SHA512 using the secret key. */
export function paystackSignature(rawBody, secretKey = env.PAYSTACK_SECRET_KEY) {
  return crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
}

export function newPaymentReference(prefix = 'ACH-PAY') {
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `${prefix}-${stamp}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}
