import crypto from 'node:crypto';

/**
 * Authenticator-app codes (RFC 6238 TOTP over RFC 4226 HOTP, SHA-1, 6 digits,
 * 30-second steps) — what Google Authenticator, Microsoft Authenticator,
 * 1Password, Authy etc. implement.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP = Object.freeze({ digits: 6, stepSeconds: 30, window: 1 });

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** New 160-bit shared secret, base32 (the form authenticator apps expect). */
export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function hotp(secret, counter) {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 10 ** TOTP.digits).padStart(TOTP.digits, '0');
}

export function currentStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / TOTP.stepSeconds);
}

export function totp(secret, nowMs = Date.now()) {
  return hotp(secret, currentStep(nowMs));
}

/**
 * Check a code against the current step ±1 (clock drift). Returns the matched
 * step, or null. Callers reject steps at or before the last one used, so a
 * code can never be replayed.
 */
export function verifyTotp(secret, code, { nowMs = Date.now(), afterStep = null } = {}) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const now = currentStep(nowMs);
  for (let d = -TOTP.window; d <= TOTP.window; d += 1) {
    const step = now + d;
    if (afterStep !== null && step <= afterStep) continue;
    const expected = hotp(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(code)))) return step;
  }
  return null;
}

/** otpauth:// URI shown as a QR code for enrolment. */
export function otpauthUri({ secret, account, issuer = 'ACHIEVER Admin' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(TOTP.digits), period: String(TOTP.stepSeconds) });
  return `otpauth://totp/${label}?${params}`;
}
