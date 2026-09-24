import { env } from '../config/env.js';
import { sendEmail } from '../integrations/resend/resendClient.js';
import * as auth from '../emails/auth/index.js';
import { BY_TYPE, generic } from '../emails/notifications/index.js';
import * as paymentRepo from '../repositories/paymentRepository.js';
import * as osusuRepo from '../repositories/osusuRepository.js';
import * as collectorRepo from '../repositories/collectorRepository.js';
import * as disbursementRepo from '../repositories/disbursementRepository.js';
import { hmac, safeEqual } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

/**
 * ACHIEVER application email (Resend). The API key stays server-side.
 * All functions return { ok, id?, error? } and never throw.
 */
const NON_TRANSACTIONAL = new Set(['system', 'marketing']);

export function unsubscribeToken(userId, category) {
  return hmac(env.JWT_SECRET, `unsubscribe:${userId}:${category}`);
}
export function verifyUnsubscribe(userId, category, token) {
  return typeof token === 'string' && safeEqual(token, unsubscribeToken(userId, category));
}
export function unsubscribeUrl(userId, category) {
  const q = new URLSearchParams({ u: userId, c: category, t: unsubscribeToken(userId, category) });
  return `${env.SERVER_URL.replace(/\/$/, '')}/api/notifications/unsubscribe?${q}`;
}

async function send(to, message, { idempotencyKey, headers } = {}) {
  const result = await sendEmail({ to, ...message, idempotencyKey, headers });
  if (!result.ok) logger.debug({ subject: message.subject, error: result.error }, 'email not sent');
  return result;
}

// Authentication & account ---------------------------------------------------------------
export const sendWelcomeEmail = (to, name) => send(to, auth.welcome({ name }));
export const sendVerificationCode = (to, name, code) => send(to, auth.verifyEmail({ name, code }));
export const sendPasswordResetCode = (to, name, code, url) => send(to, auth.resetPassword({ name, code, url }));
export const sendSecurityCode = (to, name, code, actionLabel) => send(to, auth.securityCode({ name, code, actionLabel }));
export const sendNewEmailConfirmation = (to, name, code) => send(to, auth.confirmNewEmail({ name, code }));
export const sendLoginAlert = (to, name, info) => send(to, auth.loginAlert({ name, ...info }));
export const sendPasswordChanged = (to, name) => send(to, auth.passwordChanged({ name, time: new Date() }));
export const sendEmailChanged = (to, name, newEmailMasked) => send(to, auth.emailChanged({ name, newEmailMasked, time: new Date() }));
export const sendPhoneChanged = (to, name, newPhoneMasked) => send(to, auth.phoneChanged({ name, newPhoneMasked, time: new Date() }));

// Notification emails ------------------------------------------------------------------------
/** Load the records a notification references so the email shows real data only. */
async function context(item) {
  const d = item.data || {};
  const safe = (p) => p.catch(() => null);
  const [tx, group, plan, contribution, payout, ret] = await Promise.all([
    d.transaction_id ? safe(paymentRepo.findTransaction(d.transaction_id)) : null,
    d.group_id ? safe(osusuRepo.findGroup(d.group_id)) : null,
    d.plan_id ? safe(collectorRepo.findPlan(d.plan_id)) : null,
    d.contribution_id ? safe(osusuRepo.findContribution(d.contribution_id)) : null,
    d.payout_id ? safe(disbursementRepo.find('osusu_payout', d.payout_id)) : null,
    d.return_id ? safe(collectorRepo.findReturn(d.return_id)) : null,
  ]);
  return { tx, group, plan, contribution, payout, ret };
}

export async function renderNotification(item, profile, url) {
  const renderer = BY_TYPE[item.type];
  const base = { name: profile.preferred_name || profile.first_name || profile.full_name, n: item, url };
  if (!renderer) {
    const unsub = NON_TRANSACTIONAL.has(item.category) ? unsubscribeUrl(item.user_id, item.category) : undefined;
    return { message: generic({ ...base, unsubscribeUrl: unsub }), unsubscribe: unsub };
  }
  return { message: renderer({ ...base, ...(await context(item)) }) };
}

export async function sendNotificationEmail(item, profile, url) {
  const { message, unsubscribe } = await renderNotification(item, profile, url);
  const headers = unsubscribe ? { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined;
  return send(profile.email, message, { idempotencyKey: `notification-${item.id}`, headers });
}
