import { env } from '../config/env.js';
import { LOGIN_LOCK, REGISTRATION_ROLE_MAP } from '../config/constants.js';
import { supabaseAdmin, createAuthClient } from '../integrations/supabase/client.js';
import { sendEmail } from '../integrations/resend/resendClient.js';
import { sendSms } from '../integrations/termii/termiiClient.js';
import { templates } from '../integrations/resend/templates.js';
import * as userRepo from '../repositories/userRepository.js';
import * as otpService from './otpService.js';
import * as auditService from './auditService.js';
import * as storageService from './storageService.js';
import { AppError } from '../utils/AppError.js';
import { sha256 } from '../utils/crypto.js';
import { sessionMaxAgeMs } from '../utils/cookies.js';
import { logger } from '../utils/logger.js';
import { BUCKETS } from '../config/constants.js';

// ---------------------------------------------------------------------------
// Session resolution (used by the authenticate middleware)
// ---------------------------------------------------------------------------
const tokenCache = new Map(); // sha256(token) -> { userId, iat, exp, until }
const profileCache = new Map(); // userId -> { user, until }
const TOKEN_CACHE_MS = 60_000;
const PROFILE_CACHE_MS = 15_000;
const MAX_CACHE = 5000;

function decodeJwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

function prune(map) {
  if (map.size <= MAX_CACHE) return;
  const now = Date.now();
  for (const [k, v] of map) if (v.until < now) map.delete(k);
  while (map.size > MAX_CACHE) map.delete(map.keys().next().value);
}

export function invalidateUserCache(userId) {
  profileCache.delete(userId);
}

export function toSessionUser(profile) {
  const roles = (profile.user_roles || []).map((r) => r.role_code);
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    phone: profile.phone,
    roles,
    status: profile.account_status,
    primaryAccountType: profile.primary_account_type,
    emailVerified: Boolean(profile.email_verified_at),
    phoneVerified: Boolean(profile.phone_verified_at),
    sessionsRevokedAt: profile.sessions_revoked_at,
    avatarUrl: storageService.publicUrl(BUCKETS.avatars, profile.avatar_path),
  };
}

async function loadUser(userId) {
  const hit = profileCache.get(userId);
  if (hit && hit.until > Date.now()) return hit.user;
  const profile = await userRepo.findById(userId);
  if (!profile) return null;
  const user = toSessionUser(profile);
  profileCache.set(userId, { user, until: Date.now() + PROFILE_CACHE_MS });
  prune(profileCache);
  return user;
}

/**
 * Validate an access token with Supabase Auth, then enforce ACHIEVER's own
 * session rules (absolute lifetime, revocation after password change,
 * account suspension).
 */
export async function resolveUser(accessToken, sessionStartedAt) {
  const key = sha256(accessToken);
  let entry = tokenCache.get(key);
  if (!entry || entry.until < Date.now()) {
    const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (error || !data?.user) {
      const expired = /expired/i.test(error?.message || '');
      throw AppError.unauthorized(
        expired ? 'Your session has expired' : 'Please sign in to continue',
        expired ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED',
      );
    }
    const payload = decodeJwtPayload(accessToken);
    entry = { userId: data.user.id, iat: payload.iat, exp: payload.exp, until: Date.now() + TOKEN_CACHE_MS };
    tokenCache.set(key, entry);
    prune(tokenCache);
  }
  if (entry.exp && entry.exp * 1000 < Date.now()) throw AppError.unauthorized('Your session has expired', 'TOKEN_EXPIRED');

  const user = await loadUser(entry.userId);
  if (!user) throw AppError.unauthorized('Account not found', 'UNAUTHENTICATED');

  const started = sessionStartedAt ?? (entry.iat ? entry.iat * 1000 : Date.now());
  if (Date.now() - started > sessionMaxAgeMs()) {
    throw AppError.unauthorized('Your session has ended. Please sign in again.', 'SESSION_EXPIRED');
  }
  if (user.sessionsRevokedAt && started < new Date(user.sessionsRevokedAt).getTime()) {
    throw AppError.unauthorized('Your session was signed out. Please sign in again.', 'SESSION_REVOKED');
  }
  if (user.status === 'suspended' || user.status === 'closed') {
    throw AppError.forbidden('This account is not active. Contact support for help.', 'ACCOUNT_SUSPENDED');
  }
  return user;
}

// ---------------------------------------------------------------------------
// Registration & login
// ---------------------------------------------------------------------------
async function signIn(email, password) {
  const client = createAuthClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data?.session) return null;
  return data.session;
}

export async function register(input, req) {
  const roles = REGISTRATION_ROLE_MAP[`${input.accountType}:${input.role}`];
  if (!roles) throw AppError.unprocessable('Choose a valid account type and role', 'INVALID_ACCOUNT_TYPE');

  const email = input.email.toLowerCase();
  if (await userRepo.findByEmail(email)) throw AppError.conflict('An account with this email already exists', 'EMAIL_IN_USE');
  if (await userRepo.findByPhone(input.phone)) throw AppError.conflict('An account with this phone number already exists', 'PHONE_IN_USE');

  // Supabase Auth stores credentials (bcrypt). Email confirmation is tracked
  // by ACHIEVER itself (profiles.email_verified_at) and sent via Resend.
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });
  if (error || !data?.user) {
    if (/already/i.test(error?.message || '')) throw AppError.conflict('An account with this email already exists', 'EMAIL_IN_USE');
    if (/password/i.test(error?.message || '')) throw AppError.unprocessable('Choose a stronger password', 'WEAK_PASSWORD');
    logger.error({ message: error?.message }, 'createUser failed');
    throw AppError.unavailable('We could not create your account right now. Please try again.', 'REGISTRATION_FAILED');
  }

  const userId = data.user.id;
  try {
    await userRepo.createProfileWithRoles({
      p_user_id: userId,
      p_full_name: input.fullName,
      p_email: email,
      p_phone: input.phone,
      p_account_type: input.accountType,
      p_roles: roles,
      p_address: input.address ?? null,
      p_dob: input.dateOfBirth ?? null,
    });
  } catch (err) {
    await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
    throw err;
  }

  await sendEmailVerification(userId).catch((err) => logger.warn({ err: err.message }, 'verification email not sent'));
  const session = await signIn(email, input.password);
  await auditService.record({ actorId: userId, action: 'auth.register', resourceType: 'profile', resourceId: userId, req });
  return { userId, session };
}

export async function login({ email, password }, req) {
  const normalised = email.toLowerCase();
  const profile = await userRepo.findByEmail(normalised);

  if (profile?.locked_until && new Date(profile.locked_until).getTime() > Date.now()) {
    const minutes = Math.ceil((new Date(profile.locked_until).getTime() - Date.now()) / 60000);
    await auditService.record({ actorId: profile.id, action: 'auth.login', resourceType: 'profile', resourceId: profile.id, result: 'denied', metadata: { reason: 'locked' }, req });
    throw AppError.tooMany(`Too many failed sign-in attempts. Try again in ${minutes} minute(s).`, 'ACCOUNT_LOCKED');
  }

  const session = await signIn(normalised, password);
  if (!session || !profile) {
    if (profile) {
      const lockedUntil = await userRepo.registerLoginFailure(profile.id, LOGIN_LOCK.maxFailures, LOGIN_LOCK.lockMinutes);
      await auditService.record({ actorId: profile.id, action: 'auth.login', resourceType: 'profile', resourceId: profile.id, result: 'failure', req });
      if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
        const t = templates.securityAlert({ name: profile.full_name, event: 'Your account was temporarily locked after several failed sign-in attempts.' });
        sendEmail({ to: profile.email, ...t }).catch(() => {});
      }
    }
    throw AppError.unauthorized('Incorrect email or password', 'INVALID_CREDENTIALS');
  }

  if (profile.account_status === 'suspended' || profile.account_status === 'closed') {
    throw AppError.forbidden('This account is not active. Contact support for help.', 'ACCOUNT_SUSPENDED');
  }
  await userRepo.registerLoginSuccess(profile.id);
  invalidateUserCache(profile.id);
  await auditService.record({ actorId: profile.id, action: 'auth.login', resourceType: 'profile', resourceId: profile.id, req });
  return { session, userId: profile.id };
}

export async function refresh(refreshToken, sessionStartedAt) {
  if (!refreshToken || !sessionStartedAt) throw AppError.unauthorized('Please sign in again', 'SESSION_EXPIRED');
  if (Date.now() - sessionStartedAt > sessionMaxAgeMs()) throw AppError.unauthorized('Your session has ended. Please sign in again.', 'SESSION_EXPIRED');
  const client = createAuthClient();
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data?.session || !data.user) throw AppError.unauthorized('Please sign in again', 'SESSION_EXPIRED');
  const profile = await userRepo.findById(data.user.id);
  if (!profile) throw AppError.unauthorized('Please sign in again', 'SESSION_EXPIRED');
  if (profile.sessions_revoked_at && sessionStartedAt < new Date(profile.sessions_revoked_at).getTime()) {
    throw AppError.unauthorized('Your session was signed out. Please sign in again.', 'SESSION_REVOKED');
  }
  if (profile.account_status === 'suspended' || profile.account_status === 'closed') {
    throw AppError.forbidden('This account is not active.', 'ACCOUNT_SUSPENDED');
  }
  return data.session;
}

export async function logout(accessToken, userId, req) {
  if (accessToken) {
    await supabaseAdmin.auth.admin.signOut(accessToken, 'local').catch(() => {});
    tokenCache.delete(sha256(accessToken));
  }
  if (userId) await auditService.record({ actorId: userId, action: 'auth.logout', resourceType: 'profile', resourceId: userId, req });
}

// ---------------------------------------------------------------------------
// Email / phone verification
// ---------------------------------------------------------------------------
export async function sendEmailVerification(userId) {
  const profile = await userRepo.findById(userId);
  if (!profile) throw AppError.notFound('Account not found');
  if (profile.email_verified_at) throw AppError.conflict('Your email is already verified', 'ALREADY_VERIFIED');
  const code = await otpService.issue(userId, 'email_verification', 'email');
  const result = await sendEmail({ to: profile.email, ...templates.emailVerification({ name: profile.full_name, code }) });
  if (!result.ok && !env.isProduction) {
    // Development convenience only: surface the code in server logs when email is not configured.
    logger.warn({ userId }, `Email not delivered (${result.error}). Development verification code: ${code}`);
  }
  return { sent: result.ok };
}

export async function verifyEmail(userId, code, req) {
  const profile = await userRepo.findById(userId);
  if (profile.email_verified_at) return;
  await otpService.verify(userId, 'email_verification', code);
  await userRepo.update(userId, {
    email_verified_at: new Date().toISOString(),
    account_status: profile.account_status === 'pending_verification' ? 'active' : profile.account_status,
  });
  invalidateUserCache(userId);
  await auditService.record({ actorId: userId, action: 'auth.email_verified', resourceType: 'profile', resourceId: userId, req });
  sendEmail({ to: profile.email, ...templates.welcome({ name: profile.full_name }) }).catch(() => {});
}

export async function sendPhoneOtp(userId) {
  const profile = await userRepo.findById(userId);
  if (profile.phone_verified_at) throw AppError.conflict('Your phone number is already verified', 'ALREADY_VERIFIED');
  if (!env.features.sms && env.isProduction) {
    throw AppError.unavailable('SMS verification is temporarily unavailable', 'SMS_NOT_CONFIGURED');
  }
  const code = await otpService.issue(userId, 'phone_verification', 'sms');
  const result = await sendSms({ to: profile.phone, message: `Your ACHIEVER verification code is ${code}. It expires in 10 minutes. Do not share it.` });
  if (!result.ok) {
    if (env.isProduction) throw AppError.unavailable('We could not send the SMS. Please try again shortly.', 'SMS_SEND_FAILED');
    logger.warn({ userId }, `SMS not delivered (${result.error}). Development phone code: ${code}`);
  }
  return { sent: result.ok };
}

export async function verifyPhone(userId, code, req) {
  await otpService.verify(userId, 'phone_verification', code);
  await userRepo.update(userId, { phone_verified_at: new Date().toISOString() });
  invalidateUserCache(userId);
  await auditService.record({ actorId: userId, action: 'auth.phone_verified', resourceType: 'profile', resourceId: userId, req });
}

// ---------------------------------------------------------------------------
// Password management
// ---------------------------------------------------------------------------
export async function forgotPassword(email, req) {
  const profile = await userRepo.findByEmail(email.toLowerCase());
  // Same response whether or not the account exists (no user enumeration).
  if (!profile) return;
  try {
    const code = await otpService.issue(profile.id, 'password_reset', 'email');
    const url = `${env.CLIENT_URL}/reset-password?email=${encodeURIComponent(profile.email)}`;
    await sendEmail({ to: profile.email, ...templates.passwordReset({ name: profile.full_name, code, url }) });
    if (!env.features.email && !env.isProduction) logger.warn(`Development password reset code: ${code}`);
    await auditService.record({ actorId: profile.id, action: 'auth.password_reset_requested', resourceType: 'profile', resourceId: profile.id, req });
  } catch (err) {
    if (err.code !== 'OTP_COOLDOWN') throw err;
  }
}

async function setPasswordAndRevoke(profile, newPassword) {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.id, { password: newPassword });
  if (error) {
    if (/password/i.test(error.message)) throw AppError.unprocessable('Choose a stronger password', 'WEAK_PASSWORD');
    throw AppError.unavailable('Could not update password. Please try again.', 'PASSWORD_UPDATE_FAILED');
  }
  // Any session started before now is rejected by resolveUser()/refresh().
  await userRepo.update(profile.id, { sessions_revoked_at: new Date().toISOString(), failed_login_count: 0, locked_until: null });
  invalidateUserCache(profile.id);
  tokenCache.clear();
}

export async function resetPassword({ email, code, newPassword }, req) {
  const profile = await userRepo.findByEmail(email.toLowerCase());
  if (!profile) throw AppError.badRequest('The code is invalid or has expired', 'OTP_INVALID');
  await otpService.verify(profile.id, 'password_reset', code);
  await setPasswordAndRevoke(profile, newPassword);
  await auditService.record({ actorId: profile.id, action: 'auth.password_reset', resourceType: 'profile', resourceId: profile.id, req });
  const t = templates.securityAlert({ name: profile.full_name, event: 'Your ACHIEVER password was reset and all devices were signed out.' });
  sendEmail({ to: profile.email, ...t }).catch(() => {});
}

export async function changePassword(userId, { currentPassword, newPassword }, req) {
  const profile = await userRepo.findById(userId);
  if (!(await signIn(profile.email, currentPassword))) {
    await auditService.record({ actorId: userId, action: 'auth.password_change', resourceType: 'profile', resourceId: userId, result: 'failure', req });
    throw AppError.badRequest('Your current password is incorrect', 'INVALID_CREDENTIALS');
  }
  await setPasswordAndRevoke(profile, newPassword);
  // Give this device a fresh session that post-dates the revocation.
  await new Promise((r) => setTimeout(r, 5));
  const session = await signIn(profile.email, newPassword);
  await auditService.record({ actorId: userId, action: 'auth.password_change', resourceType: 'profile', resourceId: userId, req });
  const t = templates.securityAlert({ name: profile.full_name, event: 'Your ACHIEVER password was changed. Other devices were signed out.' });
  sendEmail({ to: profile.email, ...t }).catch(() => {});
  return session;
}
