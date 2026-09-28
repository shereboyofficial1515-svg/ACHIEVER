import { env } from '../config/env.js';
import { COOKIES, STAFF_ROLES } from '../config/constants.js';
import * as adminRepo from '../repositories/adminRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import * as authService from './authService.js';
import * as auditService from './auditService.js';
import * as securityService from './securityService.js';
import * as settingsService from './settingsService.js';
import * as permissionService from './permissionService.js';
import { describeUserAgent, maskIp } from './sessionService.js';
import { sendEmail } from '../integrations/resend/resendClient.js';
import { templates } from '../integrations/resend/templates.js';
import { AppError } from '../utils/AppError.js';
import { hmac, randomCode, randomToken } from '../utils/crypto.js';
import { createSecretBox } from '../utils/secretBox.js';
import { generateSecret, otpauthUri, verifyTotp } from '../utils/totp.js';
import { logger } from '../utils/logger.js';

/**
 * Site Administration sign-in. Separate from member sign-in in every way that
 * matters for privilege:
 *   1. email + password (checked by Supabase Auth), then
 *   2. an authenticator-app code (TOTP) or a single-use backup code — required,
 *      never SMS; first sign-in enrols the authenticator, then
 *   3. an admin_sessions row + an opaque HTTP-only cookie scoped to /api/admin,
 *      with an idle timeout and an absolute lifetime.
 * Holding a staff role is not enough: the person also needs an active
 * admin_accounts row. Member sessions never carry staff permissions.
 */
const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_CODE_ATTEMPTS = 5;
const ADMIN_LOCK = Object.freeze({ maxFailures: 5, lockMinutes: 30 });
const BACKUP_CODE_COUNT = 10;
const GENERIC_FAILURE = 'Incorrect email, password or administrator access';

const box = createSecretBox(env.adminMfaKey);
const tokenHash = (token) => hmac(env.adminSessionSecret, `admin-session:${token}`);
const challengeHash = (token) => hmac(env.adminSessionSecret, `admin-challenge:${token}`);
const backupHash = (userId, code) => hmac(env.adminSessionSecret, `admin-backup:${userId}:${String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')}`);
const deviceHash = (token) => hmac(env.adminSessionSecret, `admin-device:${token}`);

// Cookies -------------------------------------------------------------------------------------
function cookieBase() {
  return {
    httpOnly: true,
    secure: env.isProduction || env.adminCookieSameSite === 'none',
    sameSite: env.adminCookieSameSite,
    path: '/api/admin',
  };
}
export function adminCsrfCookieOptions() {
  return { ...cookieBase(), maxAge: 12 * 3600_000 };
}
function setChallengeCookie(res, token) {
  res.cookie(COOKIES.adminChallenge, token, { ...cookieBase(), path: '/api/admin/auth', maxAge: CHALLENGE_TTL_MS });
}
function clearChallengeCookie(res) {
  res.clearCookie(COOKIES.adminChallenge, { ...cookieBase(), path: '/api/admin/auth' });
}
function setSessionCookie(res, token, maxAgeMs) {
  res.cookie(COOKIES.admin, token, { ...cookieBase(), maxAge: maxAgeMs });
}
export function clearSessionCookie(res) {
  res.clearCookie(COOKIES.admin, cookieBase());
}

// Helpers ---------------------------------------------------------------------------------------
const staffRoles = (profile) => (profile?.user_roles || []).map((r) => r.role_code).filter((r) => STAFF_ROLES.includes(r));
const ua = (req) => req?.get?.('user-agent')?.slice(0, 300) || null;

async function sessionRules() {
  const [idleMinutes, maxHours, stepUpMinutes] = await Promise.all([
    settingsService.getInt('admin.session_idle_minutes', 30),
    settingsService.getInt('admin.session_max_hours', 12),
    settingsService.getInt('admin.step_up_minutes', 5),
  ]);
  return { idleMinutes, maxHours, stepUpMinutes };
}

function denied(req, { userId = null, reason }) {
  auditService.record({ actorId: userId, action: 'admin.auth.login', resourceType: 'admin_account', resourceId: userId, result: 'denied', metadata: { reason }, req });
}

function alert(profile, event) {
  const t = templates.securityAlert({ name: profile.full_name, event });
  sendEmail({ to: profile.email, ...t }).catch(() => {});
}

// Step 1: password -------------------------------------------------------------------------------
export async function login({ email, password }, req, res) {
  // findByEmail() does not load roles; findById() does.
  const found = await userRepo.findByEmail(String(email).toLowerCase());
  const [profile, account] = found ? await Promise.all([userRepo.findById(found.id), adminRepo.findAccount(found.id)]) : [null, null];

  if (account?.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
    denied(req, { userId: profile.id, reason: 'locked' });
    throw AppError.tooMany('Too many attempts. Try again later.', 'ADMIN_LOCKED');
  }

  const passwordOk = profile ? await authService.verifyPassword(profile.email, password) : false;
  if (!passwordOk) {
    if (account) {
      const updated = await adminRepo.registerFailure(profile.id, ADMIN_LOCK.maxFailures, ADMIN_LOCK.lockMinutes);
      if (updated?.locked_until && new Date(updated.locked_until).getTime() > Date.now()) {
        await securityService.recordEvent({
          userId: profile.id, type: 'account_locked', severity: 'high', source: 'admin',
          description: `Administrator sign-in locked for ${ADMIN_LOCK.lockMinutes} minutes after repeated wrong passwords.`,
          metadata: { ip: req?.ip || null },
        });
        alert(profile, 'Administrator sign-in to your account was locked after several wrong passwords.');
      }
    }
    denied(req, { userId: profile?.id ?? null, reason: account ? 'password' : 'unknown' });
    throw AppError.unauthorized(GENERIC_FAILURE, 'INVALID_CREDENTIALS');
  }

  // Correct password but not an administrator: same answer as a wrong password.
  const roles = staffRoles(profile);
  if (!account || account.status !== 'active' || !roles.length || ['suspended', 'closed'].includes(profile.account_status)) {
    await securityService.recordEvent({
      userId: profile.id, type: 'admin_action', severity: 'medium', source: 'admin',
      description: 'Sign-in attempt to the admin platform with an account that has no administrator access.',
      metadata: { ip: req?.ip || null, reason: !account ? 'not_admin' : account.status !== 'active' ? 'disabled' : 'no_staff_role' },
    });
    denied(req, { userId: profile.id, reason: 'not_admin' });
    throw AppError.unauthorized(GENERIC_FAILURE, 'INVALID_CREDENTIALS');
  }

  const factor = await adminRepo.activeFactor(profile.id);
  const token = randomToken(32);
  const base = {
    user_id: profile.id, token_hash: challengeHash(token), ip_address: req?.ip || null, user_agent: ua(req),
    expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  };
  setChallengeCookie(res, token);
  if (factor) {
    await adminRepo.insertChallenge({ ...base, purpose: 'mfa' });
    return { next: 'mfa' };
  }
  // First sign-in (or after an MFA reset): enrol an authenticator app.
  const secret = generateSecret();
  await adminRepo.insertChallenge({ ...base, purpose: 'enroll', enroll_secret_ciphertext: box.seal(secret) });
  return { next: 'enroll', secret, otpauthUri: otpauthUri({ secret, account: profile.email }) };
}

// Step 2: second factor --------------------------------------------------------------------------
async function loadChallenge(req) {
  const token = req.cookies?.[COOKIES.adminChallenge];
  const expired = AppError.unauthorized('Your sign-in expired. Please start again.', 'ADMIN_CHALLENGE_EXPIRED');
  if (!token) throw expired;
  const challenge = await adminRepo.findChallenge(challengeHash(token));
  if (!challenge || challenge.consumed_at || new Date(challenge.expires_at).getTime() < Date.now()) throw expired;
  if (challenge.attempts >= MAX_CODE_ATTEMPTS) throw AppError.tooMany('Too many incorrect codes. Please start again.', 'ADMIN_CHALLENGE_LOCKED');
  return challenge;
}

async function failedCode(challenge, profile, req) {
  const attempts = challenge.attempts + 1;
  await adminRepo.updateChallenge(challenge.id, { attempts, ...(attempts >= MAX_CODE_ATTEMPTS ? { consumed_at: new Date().toISOString() } : {}) });
  if (attempts >= MAX_CODE_ATTEMPTS) {
    await securityService.recordEvent({
      userId: profile.id, type: 'otp_failures', severity: 'high', source: 'admin',
      description: 'Several incorrect authenticator codes were entered during administrator sign-in.',
      metadata: { ip: req?.ip || null },
    });
    alert(profile, 'Several incorrect authenticator codes were entered while signing in to the admin platform.');
  }
  denied(req, { userId: profile.id, reason: 'mfa' });
  throw AppError.badRequest('The code is incorrect or has expired', 'MFA_INVALID');
}

export async function verifySecondFactor({ code, backupCode }, req, res) {
  const challenge = await loadChallenge(req);
  const profile = await userRepo.findById(challenge.user_id);
  const account = await adminRepo.findAccount(challenge.user_id);
  if (!profile || account?.status !== 'active' || !staffRoles(profile).length) {
    throw AppError.unauthorized(GENERIC_FAILURE, 'INVALID_CREDENTIALS');
  }

  let method = 'totp';
  let backupCodes = null;
  if (challenge.purpose === 'enroll') {
    if (!code) throw AppError.badRequest('Enter the 6-digit code from your authenticator app', 'MFA_REQUIRED');
    const secret = box.open(challenge.enroll_secret_ciphertext);
    const step = verifyTotp(secret, code);
    if (step === null) await failedCode(challenge, profile, req);
    if (!(await adminRepo.consumeChallenge(challenge.id))) throw AppError.unauthorized('Your sign-in expired. Please start again.', 'ADMIN_CHALLENGE_EXPIRED');
    await adminRepo.revokeFactors(profile.id, 'replaced');
    await adminRepo.insertFactor({ user_id: profile.id, secret_ciphertext: challenge.enroll_secret_ciphertext, confirmed_at: new Date().toISOString(), last_used_step: step, label: 'Authenticator app' });
    backupCodes = await issueBackupCodes(profile.id);
    await securityService.recordChange({ userId: profile.id, type: 'mfa_changed', next: 'authenticator app enrolled', req });
    await auditService.record({ actorId: profile.id, action: 'admin.mfa.enrolled', resourceType: 'admin_account', resourceId: profile.id, req });
    alert(profile, 'An authenticator app was set up for administrator sign-in to your account.');
  } else {
    const factor = await adminRepo.activeFactor(profile.id);
    if (!factor) throw AppError.unauthorized('Your sign-in expired. Please start again.', 'ADMIN_CHALLENGE_EXPIRED');
    if (backupCode) {
      method = 'backup_code';
      if (!(await adminRepo.useBackupCode(profile.id, backupHash(profile.id, backupCode)))) await failedCode(challenge, profile, req);
    } else {
      const step = verifyTotp(box.open(factor.secret_ciphertext), code, { afterStep: factor.last_used_step ?? null });
      if (step === null || !(await adminRepo.markFactorStep(factor.id, step))) await failedCode(challenge, profile, req);
    }
    if (!(await adminRepo.consumeChallenge(challenge.id))) throw AppError.unauthorized('Your sign-in expired. Please start again.', 'ADMIN_CHALLENGE_EXPIRED');
  }
  clearChallengeCookie(res);

  const session = await startSession(profile, method, req, res);
  await adminRepo.updateAccount(profile.id, { last_login_at: new Date().toISOString(), failed_login_count: 0, locked_until: null });
  req.adminSession = session;
  await auditService.record({ actorId: profile.id, action: 'admin.auth.login', resourceType: 'admin_session', resourceId: session.id, metadata: { method }, req });
  if (method === 'backup_code') {
    const left = await adminRepo.countBackupCodes(profile.id);
    alert(profile, `A backup code was used to sign in to the admin platform. ${left} backup code(s) remain.`);
  }
  return { admin: await describe(profile.id), backupCodes };
}

async function issueBackupCodes(userId) {
  const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => `${randomCode(5)}-${randomCode(5)}`);
  await adminRepo.replaceBackupCodes(userId, codes.map((c) => backupHash(userId, c)));
  return codes;
}

async function startSession(profile, method, req, res) {
  const { idleMinutes, maxHours } = await sessionRules();
  let device = req.cookies?.[COOKIES.adminDevice];
  if (!device || !/^[A-Za-z0-9_-]{30,60}$/.test(device)) device = randomToken(32);
  const dHash = deviceHash(device);
  const known = await adminRepo.knownDevice(profile.id, dHash);
  const token = randomToken(32);
  const info = describeUserAgent(ua(req) || '');
  const session = await adminRepo.insertSession({
    user_id: profile.id, token_hash: tokenHash(token), device_hash: dHash, device_label: info.label,
    ip_address: req?.ip || null, user_agent: ua(req), mfa_method: method,
    expires_at: new Date(Date.now() + maxHours * 3600_000).toISOString(), idle_minutes: idleMinutes,
  });
  setSessionCookie(res, token, maxHours * 3600_000);
  res.cookie(COOKIES.adminDevice, device, { ...cookieBase(), maxAge: 365 * 24 * 3600_000 });
  if (!known) {
    await securityService.recordEvent({
      userId: profile.id, type: 'new_device', severity: 'medium', source: 'admin',
      description: `Administrator sign-in from a new device (${info.label}).`, metadata: { admin_session_id: session.id, ip: maskIp(req?.ip) },
    });
    alert(profile, `Your administrator account signed in from a new device: ${info.label} (${maskIp(req?.ip) ?? 'unknown network'}).`);
  }
  return session;
}

// Session validation (middleware) -------------------------------------------------------------------
const cache = new Map(); // token hash -> { value, until }
const CACHE_MS = 5_000;
const TOUCH_EVERY_MS = 30_000;

export function forgetSessions() {
  cache.clear();
}

export async function authenticate(token) {
  const required = AppError.unauthorized('Please sign in to the admin platform', 'ADMIN_AUTH_REQUIRED');
  if (!token) throw required;
  const hash = tokenHash(token);
  const now = Date.now();
  let entry = cache.get(hash);
  if (!entry || entry.until < now) {
    const session = await adminRepo.findSessionByToken(hash);
    if (!session) throw required;
    const [account, profile] = await Promise.all([adminRepo.findAccount(session.user_id), userRepo.findById(session.user_id)]);
    entry = { session, account, profile, until: now + CACHE_MS, touchedAt: entry?.touchedAt ?? 0 };
    cache.set(hash, entry);
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
  }
  const { session, account, profile } = entry;
  const expired = (reason, message = 'Your admin session has ended. Please sign in again.') => {
    cache.delete(hash);
    if (!session.ended_at) adminRepo.updateSession(session.id, { ended_at: new Date().toISOString(), end_reason: reason }).catch(() => {});
    return AppError.unauthorized(message, 'ADMIN_SESSION_EXPIRED');
  };
  if (session.ended_at) throw AppError.unauthorized('Your admin session has ended. Please sign in again.', 'ADMIN_SESSION_EXPIRED');
  if (new Date(session.expires_at).getTime() < now) throw expired('expired');
  const lastActive = Math.max(new Date(session.last_active_at).getTime(), entry.touchedAt);
  if (now - lastActive > session.idle_minutes * 60_000) throw expired('idle_timeout', 'You were signed out after a period of inactivity.');
  if (!account || account.status !== 'active') throw expired('account_disabled');
  if (!profile || ['suspended', 'closed'].includes(profile.account_status)) throw expired('account_disabled');
  const roles = staffRoles(profile);
  if (!roles.length) throw expired('role_removed');

  if (now - entry.touchedAt > TOUCH_EVERY_MS) {
    entry.touchedAt = now;
    adminRepo.updateSession(session.id, { last_active_at: new Date(now).toISOString() }).catch((err) => logger.warn({ err: err.message }, 'admin session touch failed'));
  }
  return {
    session,
    user: {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      roles,
      permissions: await permissionService.permissionsForRoles(roles),
      status: profile.account_status,
      emailVerified: Boolean(profile.email_verified_at),
      phoneVerified: Boolean(profile.phone_verified_at),
      sessionId: null, // member-session id: never set on admin requests
      isAdmin: true,
    },
  };
}

// Step-up for sensitive actions: a fresh authenticator code -------------------------------------------
export async function stepUp(user, session, { code }, req) {
  const factor = await adminRepo.activeFactor(user.id);
  if (!factor) throw AppError.forbidden('Set up your authenticator app first', 'MFA_NOT_ENROLLED');
  const step = verifyTotp(box.open(factor.secret_ciphertext), code, { afterStep: factor.last_used_step ?? null });
  const ok = step !== null && (await adminRepo.markFactorStep(factor.id, step));
  await auditService.record({ actorId: user.id, action: 'admin.auth.step_up', resourceType: 'admin_session', resourceId: session.id, result: ok ? 'success' : 'failure', req });
  if (!ok) throw AppError.badRequest('The code is incorrect or has expired', 'MFA_INVALID');
  await adminRepo.updateSession(session.id, { step_up_at: new Date().toISOString() });
  forgetSessions();
  const { stepUpMinutes } = await sessionRules();
  return { validForMinutes: stepUpMinutes };
}

export async function hasRecentStepUp(session) {
  const fresh = await adminRepo.findSession(session.id);
  if (!fresh?.step_up_at || fresh.ended_at) return false;
  const { stepUpMinutes } = await sessionRules();
  return Date.now() - new Date(fresh.step_up_at).getTime() <= stepUpMinutes * 60_000;
}

// Sessions ---------------------------------------------------------------------------------------------
export async function logout(user, session, req, res) {
  if (session) await adminRepo.updateSession(session.id, { ended_at: new Date().toISOString(), end_reason: 'logout' });
  forgetSessions();
  clearSessionCookie(res);
  if (user) await auditService.record({ actorId: user.id, action: 'admin.auth.logout', resourceType: 'admin_session', resourceId: session?.id, req });
}

export async function logoutAll(user, session, req, res) {
  const rows = await adminRepo.endSessions(user.id, 'logout_all');
  forgetSessions();
  clearSessionCookie(res);
  await auditService.record({ actorId: user.id, action: 'admin.auth.logout_all', resourceType: 'admin_account', resourceId: user.id, metadata: { count: rows.length }, req });
  return { ended: rows.length };
}

function formatSession(s, currentId = null) {
  return {
    id: s.id,
    current: s.id === currentId,
    device: s.device_label || describeUserAgent(s.user_agent || '').label,
    approximateIp: maskIp(s.ip_address),
    mfaMethod: s.mfa_method,
    createdAt: s.created_at,
    lastActiveAt: s.last_active_at,
    expiresAt: s.expires_at,
    idleMinutes: s.idle_minutes,
    endedAt: s.ended_at,
    endReason: s.end_reason,
    admin: s.account?.profile ? { id: s.account.profile.id, name: s.account.profile.full_name, email: s.account.profile.email } : undefined,
  };
}

export async function mySessions(user, session) {
  const { rows } = await adminRepo.listSessions({ userId: user.id, activeOnly: true, page: 1, pageSize: 50 });
  return rows.map((s) => formatSession(s, session.id));
}

export async function revokeSession(user, id, req, { byStaff = false } = {}) {
  const target = await adminRepo.findSession(id);
  if (!target || (!byStaff && target.user_id !== user.id)) throw AppError.notFound('Session not found');
  if (target.ended_at) return;
  await adminRepo.updateSession(id, { ended_at: new Date().toISOString(), end_reason: 'revoked' });
  forgetSessions();
  await auditService.record({ actorId: user.id, action: 'admin.session.revoked', resourceType: 'admin_session', resourceId: id, metadata: { owner: target.user_id }, req });
}

export async function listAllSessions({ page, pageSize, activeOnly = true, userId = null }) {
  const { rows, total } = await adminRepo.listSessions({ page, pageSize, activeOnly, userId });
  return { items: rows.map((s) => formatSession(s)), total };
}

// Password & recovery -------------------------------------------------------------------------------------
export async function changePassword(user, session, { currentPassword, newPassword, code }, req) {
  await stepUp(user, session, { code }, req);
  if (currentPassword === newPassword) throw AppError.unprocessable('Choose a password different from your current one', 'PASSWORD_UNCHANGED');
  if (!(await authService.verifyPassword(user.email, currentPassword))) {
    await auditService.record({ actorId: user.id, action: 'admin.auth.password_change', resourceType: 'admin_account', resourceId: user.id, result: 'failure', req });
    throw AppError.badRequest('Your current password is incorrect', 'INVALID_CREDENTIALS');
  }
  await authService.assertPasswordPolicy(newPassword);
  await authService.setPassword(user.id, newPassword, 'password_changed');
  const ended = await adminRepo.endSessions(user.id, 'password_changed', { exceptId: session.id });
  forgetSessions();
  await securityService.recordChange({ userId: user.id, type: 'password_changed', req });
  await auditService.record({ actorId: user.id, action: 'admin.auth.password_changed', resourceType: 'admin_account', resourceId: user.id, metadata: { otherSessionsEnded: ended.length }, req });
  const profile = await userRepo.findById(user.id);
  alert(profile, 'Your password was changed from the admin platform. Other admin and member sessions were signed out.');
  return { otherSessionsEnded: ended.length };
}

export async function regenerateBackupCodes(user, session, { code }, req) {
  await stepUp(user, session, { code }, req);
  const codes = await issueBackupCodes(user.id);
  await auditService.record({ actorId: user.id, action: 'admin.mfa.backup_codes_regenerated', resourceType: 'admin_account', resourceId: user.id, req });
  const profile = await userRepo.findById(user.id);
  alert(profile, 'New admin backup codes were generated. Previous codes no longer work.');
  return { backupCodes: codes };
}

export async function mfaStatus(user) {
  const [factor, backupCodesLeft] = await Promise.all([adminRepo.activeFactor(user.id), adminRepo.countBackupCodes(user.id)]);
  return { authenticator: Boolean(factor), enrolledAt: factor?.confirmed_at ?? null, backupCodesLeft };
}

/** After a password reset by email: end every admin session for that person. */
export async function afterPasswordReset(email, req) {
  const profile = await userRepo.findByEmail(String(email).toLowerCase());
  if (!profile || !(await adminRepo.findAccount(profile.id))) return;
  await adminRepo.endSessions(profile.id, 'password_changed');
  forgetSessions();
  await auditService.record({ actorId: profile.id, action: 'admin.auth.password_reset', resourceType: 'admin_account', resourceId: profile.id, req });
}

export async function describe(userId) {
  const [profile, account, mfa] = await Promise.all([userRepo.findById(userId), adminRepo.findAccount(userId), mfaStatus({ id: userId })]);
  const roles = staffRoles(profile);
  return {
    id: profile.id,
    name: profile.full_name,
    email: profile.email,
    roles,
    permissions: await permissionService.permissionsForRoles(roles),
    lastLoginAt: account?.last_login_at ?? null,
    mfa,
  };
}

export const __test__ = { tokenHash, backupHash, box, ADMIN_LOCK, MAX_CODE_ATTEMPTS };
