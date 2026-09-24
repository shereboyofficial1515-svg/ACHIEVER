import crypto from 'node:crypto';
import { env } from '../config/env.js';
import * as securityRepo from '../repositories/securityRepository.js';
import * as emailService from './emailService.js';
import * as securityService from './securityService.js';
import * as auditService from './auditService.js';
import { AppError } from '../utils/AppError.js';
import { hmac, randomDigits, safeEqual } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { maskEmail } from '../utils/sanitize.js';

/**
 * Verification challenges for sensitive account changes.
 *
 *   create(password)  -> the current password is checked, a 6-digit code is
 *                        emailed to the verified address; only an HMAC is stored
 *   use(id, code)     -> checked server-side: same user, same action, same
 *                        session, not expired, attempts left, not used before;
 *                        then consumed atomically (single use)
 *
 * The frontend never decides that a code is valid.
 */
export const ACTIONS = {
  password_change: 'change your password',
  email_change: 'change your email address',
  phone_change: 'change your phone number',
  payout_account_change: 'change your payout account',
  account_deletion: 'request deletion of your account',
};
const TTL_MINUTES = 10;
const MAX_PER_HOUR = 5;

const codeHash = (id, userId, action, code) => hmac(env.JWT_SECRET, `challenge:${id}:${userId}:${action}:${code}`);

export async function create(user, { action, password }, verifyPassword, req) {
  if (!ACTIONS[action]) throw AppError.badRequest('Unknown action', 'UNKNOWN_ACTION');
  const since = new Date(Date.now() - 3600_000).toISOString();
  if ((await securityRepo.countRecentChallenges(user.id, since)) >= MAX_PER_HOUR) {
    throw AppError.tooMany('Too many security codes requested. Please wait before trying again.', 'CHALLENGE_RATE_LIMITED');
  }
  if (!(await verifyPassword(user.email, password))) {
    await auditService.record({ actorId: user.id, action: `challenge.${action}`, resourceType: 'profile', resourceId: user.id, result: 'failure', metadata: { reason: 'password' }, req });
    throw AppError.badRequest('Your current password is incorrect', 'INVALID_CREDENTIALS');
  }
  const id = crypto.randomUUID();
  const code = randomDigits(6);
  const row = await securityRepo.insertChallenge({
    id,
    user_id: user.id,
    action,
    channel: 'email',
    destination_masked: maskEmail(user.email),
    code_hash: codeHash(id, user.id, action, code),
    session_id: user.sessionId ?? null,
    ip_address: req?.ip || null,
    expires_at: new Date(Date.now() + TTL_MINUTES * 60_000).toISOString(),
  });
  const result = await emailService.sendSecurityCode(user.email, user.fullName, code, ACTIONS[action]);
  if (!result.ok && !env.isProduction) logger.warn({ userId: user.id }, `Email not delivered (${result.error}). Development security code: ${code}`);
  await auditService.record({ actorId: user.id, action: `challenge.${action}.issued`, resourceType: 'security_challenge', resourceId: id, req });
  return { challengeId: row.id, channel: row.channel, sentTo: row.destination_masked, expiresAt: row.expires_at, sent: result.ok };
}

/**
 * Verify the code and consume the challenge in one step. Throws on any
 * mismatch; a challenge can never be used twice or for another action.
 */
export async function use(user, { challengeId, code, action }, req) {
  const invalid = AppError.badRequest('The security code is invalid or has expired', 'CHALLENGE_INVALID');
  if (!challengeId || !code) throw AppError.forbidden('Confirm this change with a security code first', 'CHALLENGE_REQUIRED');
  const c = await securityRepo.findChallenge(challengeId);
  if (!c || c.user_id !== user.id || c.action !== action) throw invalid;
  if (c.consumed_at) throw AppError.badRequest('This security code has already been used', 'CHALLENGE_USED');
  if (new Date(c.expires_at).getTime() < Date.now()) throw AppError.badRequest('This security code has expired. Request a new one.', 'CHALLENGE_EXPIRED');
  if (c.session_id && user.sessionId && c.session_id !== user.sessionId) throw invalid;
  if (c.attempts >= c.max_attempts) throw AppError.tooMany('Too many incorrect codes. Request a new one.', 'CHALLENGE_LOCKED');

  if (!safeEqual(codeHash(c.id, user.id, action, String(code)), c.code_hash)) {
    await securityRepo.updateChallenge(c.id, { attempts: c.attempts + 1 });
    if (c.attempts + 1 >= c.max_attempts) {
      await securityService.recordEvent({
        userId: user.id, type: 'otp_failures', severity: 'medium', sessionId: user.sessionId ?? null,
        description: `Several incorrect security codes were entered while trying to ${ACTIONS[action]}.`, metadata: { action },
      });
    }
    await auditService.record({ actorId: user.id, action: `challenge.${action}.failed`, resourceType: 'security_challenge', resourceId: c.id, result: 'failure', req });
    throw invalid;
  }
  if (!c.verified_at) await securityRepo.updateChallenge(c.id, { verified_at: new Date().toISOString() });
  const consumed = await securityRepo.consumeChallenge({ id: c.id, userId: user.id, action });
  if (!consumed) throw AppError.badRequest('This security code has already been used', 'CHALLENGE_USED');
  return c;
}
