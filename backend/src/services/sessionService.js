import { env } from '../config/env.js';
import { COOKIES } from '../config/constants.js';
import { sendEmail } from '../integrations/resend/resendClient.js';
import { templates } from '../integrations/resend/templates.js';
import * as securityRepo from '../repositories/securityRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import * as securityService from './securityService.js';
import * as notificationService from './notificationService.js';
import * as settingsService from './settingsService.js';
import * as auditService from './auditService.js';
import { AppError } from '../utils/AppError.js';
import { hmac, randomToken } from '../utils/crypto.js';
import { setDeviceCookie } from '../utils/cookies.js';
import { logger } from '../utils/logger.js';

/**
 * Server-side session registry. Supabase issues the tokens; ACHIEVER keeps a
 * user_sessions row per sign-in so that users (and security staff) can see
 * active sessions and revoke any one of them, and so that sensitive actions
 * can require a fresh step-up on the *current* session.
 */
const SESSION_CACHE_MS = 15_000;
const TOUCH_EVERY_MS = 60_000;
const cache = new Map(); // sessionId -> { session, until, touchedAt }

export function describeUserAgent(ua = '') {
  const s = String(ua);
  const deviceType = /ipad|tablet/i.test(s) ? 'tablet' : /mobi|iphone|android/i.test(s) ? 'mobile' : s ? 'desktop' : 'unknown';
  const os = /windows/i.test(s) ? 'Windows' : /iphone|ipad|ios/i.test(s) ? 'iOS' : /android/i.test(s) ? 'Android'
    : /mac os/i.test(s) ? 'macOS' : /linux/i.test(s) ? 'Linux' : null;
  const browser = /edg\//i.test(s) ? 'Edge' : /opr\/|opera/i.test(s) ? 'Opera' : /chrome\//i.test(s) ? 'Chrome'
    : /firefox\//i.test(s) ? 'Firefox' : /safari\//i.test(s) ? 'Safari' : null;
  const label = [browser, os].filter(Boolean).join(' on ') || 'Unknown device';
  return { deviceType, os, browser, label };
}

function deviceHash(token) {
  return hmac(env.SESSION_SECRET, `device:${token}`);
}

/** Mask the last part of an IP address for user-facing lists. */
export function maskIp(ip) {
  if (!ip) return null;
  const v = String(ip);
  if (v.includes('.')) return v.split('.').slice(0, 3).join('.') + '.x';
  return v.split(':').slice(0, 3).join(':') + ':…';
}

/**
 * Called after a successful sign-in/registration. Registers the device,
 * raises a neutral "new device" alert when it is not recognised, and creates
 * the session row. Returns the session id to bind into the session cookie.
 */
export async function start({ userId, authMethod, req, res }) {
  const ua = req.get?.('user-agent')?.slice(0, 300) || null;
  const info = describeUserAgent(ua);
  let token = req.cookies?.[COOKIES.device];
  if (!token || !/^[A-Za-z0-9_-]{30,60}$/.test(token)) token = randomToken(32);
  const hash = deviceHash(token);

  let device = await securityRepo.findDevice(userId, hash);
  let isNewDevice = false;
  if (!device) {
    const knownDevices = await securityRepo.countDevices(userId);
    device = await securityRepo.insertDevice({
      user_id: userId, device_id_hash: hash, label: info.label, device_type: info.deviceType, os: info.os, browser: info.browser,
    });
    isNewDevice = knownDevices > 0; // the very first device is not "new"
  } else {
    await securityRepo.updateDevice(device.id, { last_seen_at: new Date().toISOString(), removed_at: null });
  }
  setDeviceCookie(res, token);

  const session = await securityRepo.insertSession({
    user_id: userId, device_id: device.id, auth_method: authMethod, ip_address: req.ip || null, user_agent: ua,
  });

  if (isNewDevice) {
    await securityService.recordChange({ userId, type: 'device_added', next: info.label, sessionId: session.id, req });
    await securityService.recordEvent({
      userId, type: 'new_device', severity: 'low', sessionId: session.id,
      description: `Sign-in from a device not seen before (${info.label}).`,
      metadata: { device_id: device.id },
    });
    await notificationService.notify(userId, {
      type: 'new_device_sign_in', category: 'account', title: 'New sign-in to your account',
      body: `Your account was signed in from ${info.label}. If this was not you, change your password and sign out other sessions.`,
      data: { session_id: session.id }, dedupeKey: `new_device:${session.id}`,
    });
    const profile = await userRepo.findById(userId);
    if (profile) {
      const t = templates.securityAlert({ name: profile.full_name, event: `A new sign-in to your ACHIEVER account from ${info.label}. If this was not you, reset your password now.` });
      sendEmail({ to: profile.email, ...t }).catch(() => {});
    }
  }
  return session.id;
}

/**
 * Validate that a session bound in the cookie still exists, belongs to this
 * user and has not been revoked. Updates last-active at most once a minute.
 */
export async function validate(sessionId, userId) {
  const now = Date.now();
  let entry = cache.get(sessionId);
  if (!entry || entry.until < now) {
    const session = await securityRepo.findSession(sessionId);
    entry = { session, until: now + SESSION_CACHE_MS, touchedAt: entry?.touchedAt ?? 0 };
    cache.set(sessionId, entry);
    if (cache.size > 5000) cache.delete(cache.keys().next().value);
  }
  const { session } = entry;
  if (!session || session.user_id !== userId || session.revoked_at) {
    throw AppError.unauthorized('Your session was signed out. Please sign in again.', 'SESSION_REVOKED');
  }
  if (now - entry.touchedAt > TOUCH_EVERY_MS) {
    entry.touchedAt = now;
    securityRepo.updateSession(sessionId, { last_active_at: new Date().toISOString() }).catch((err) => logger.warn({ err: err.message }, 'session touch failed'));
  }
  return session;
}

function forget(ids) {
  for (const id of ids) cache.delete(id);
}

export async function list(user) {
  const rows = await securityRepo.listSessions(user.id, { activeOnly: true });
  return rows.map((s) => ({
    id: s.id,
    current: s.id === user.sessionId,
    device: s.device?.label ?? describeUserAgent(s.user_agent).label,
    deviceType: s.device?.device_type ?? 'unknown',
    approximateIp: maskIp(s.ip_address),
    signedInWith: s.auth_method,
    createdAt: s.created_at,
    lastActiveAt: s.last_active_at,
  }));
}

export async function revoke(user, sessionId, req) {
  const session = await securityRepo.findSession(sessionId);
  if (!session || session.user_id !== user.id) throw AppError.notFound('Session not found');
  if (session.revoked_at) return;
  await securityRepo.updateSession(sessionId, { revoked_at: new Date().toISOString(), revoked_reason: 'user_revoked' });
  forget([sessionId]);
  await auditService.record({ actorId: user.id, action: 'session.revoke', resourceType: 'user_session', resourceId: sessionId, req });
  await securityService.recordEvent({ userId: user.id, type: 'session_revoked', severity: 'low', sessionId: user.sessionId, description: 'A session was signed out by the account owner.', metadata: { revoked_session_id: sessionId } });
}

export async function revokeOthers(user, req) {
  const rows = await securityRepo.revokeSessions(user.id, { exceptId: user.sessionId ?? null, reason: 'user_revoked_others' });
  forget(rows.map((r) => r.id));
  // Sessions without a server-side row (legacy cookies) are cut off by the profile-level revocation time.
  if (!user.sessionId) await userRepo.update(user.id, { sessions_revoked_at: new Date().toISOString() });
  await auditService.record({ actorId: user.id, action: 'session.revoke_others', resourceType: 'profile', resourceId: user.id, metadata: { count: rows.length }, req });
  return { revoked: rows.length };
}

/** Normal sign-out of the current session. */
export async function end(sessionId, reason) {
  await securityRepo.updateSession(sessionId, { revoked_at: new Date().toISOString(), revoked_reason: reason });
  forget([sessionId]);
}

/** Revoke every session (password change/reset, suspension, security staff action). */
export async function revokeAll(userId, reason) {
  const rows = await securityRepo.revokeSessions(userId, { reason });
  forget(rows.map((r) => r.id));
  return rows.length;
}

export async function revokeByStaff(actor, userId, reason, req) {
  const count = await revokeAll(userId, 'security_staff');
  await userRepo.update(userId, { sessions_revoked_at: new Date().toISOString() });
  await auditService.record({ actorId: actor.id, action: 'security.sessions.revoke_all', resourceType: 'profile', resourceId: userId, metadata: { reason, count }, req });
  await securityService.recordEvent({ userId, type: 'session_revoked', severity: 'medium', source: 'admin', description: 'All sessions were signed out by the security team.', metadata: { actor_id: actor.id, reason } });
  return { revoked: count };
}

// Step-up (re-authentication) for sensitive actions ------------------------------------------------
export async function stepUp(user, password, verifyPassword, req) {
  if (!user.sessionId) throw AppError.unauthorized('Please sign in again to continue', 'SESSION_REFRESH_REQUIRED');
  const okPassword = await verifyPassword(user.email, password);
  await auditService.record({ actorId: user.id, action: 'session.step_up', resourceType: 'user_session', resourceId: user.sessionId, result: okPassword ? 'success' : 'failure', req });
  if (!okPassword) throw AppError.badRequest('Your password is incorrect', 'INVALID_CREDENTIALS');
  await securityRepo.updateSession(user.sessionId, { step_up_at: new Date().toISOString() });
  forget([user.sessionId]);
  const minutes = Number(await settingsService.get('security.step_up_minutes', 10)) || 10;
  return { validForMinutes: minutes };
}

export async function hasRecentStepUp(user) {
  if (!user?.sessionId) return false;
  const session = await securityRepo.findSession(user.sessionId);
  if (!session?.step_up_at || session.revoked_at) return false;
  const minutes = Number(await settingsService.get('security.step_up_minutes', 10)) || 10;
  return Date.now() - new Date(session.step_up_at).getTime() <= minutes * 60_000;
}
