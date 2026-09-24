import { env } from '../config/env.js';
import { REGISTRATION_ROLE_MAP } from '../config/constants.js';
import { supabaseAdmin, createPkceClient } from '../integrations/supabase/client.js';
import * as userRepo from '../repositories/userRepository.js';
import * as complianceRepo from '../repositories/complianceRepository.js';
import * as auditService from './auditService.js';
import * as securityService from './securityService.js';
import * as emailService from './emailService.js';
import { AppError } from '../utils/AppError.js';
import { hmac, safeEqual } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

/**
 * Google / Facebook sign-in through Supabase Auth (the authentication
 * authority). The PKCE exchange happens on the server so tokens stay in
 * HTTP-only cookies, exactly like email/password sessions.
 *
 *   start    -> signed state cookie (code verifier, provider, next, mode) + redirect to provider
 *   callback -> exchange code with Supabase -> existing profile: sign in
 *                                            -> no profile: complete-profile step
 *
 * A social identity never satisfies ACHIEVER KYC on its own: new users still
 * complete their legal profile, phone verification and KYC.
 */
export const PROVIDERS = ['google', 'facebook'];
const STATE_COOKIE = 'ach_oauth';
const STATE_TTL_MS = 10 * 60_000;

let providerCache = { value: null, until: 0 };
/** Which providers are enabled in the Supabase project (public auth settings). */
export async function enabledProviders() {
  if (providerCache.value && providerCache.until > Date.now()) return providerCache.value;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: env.SUPABASE_ANON_KEY } });
    const body = await res.json();
    const value = Object.fromEntries(PROVIDERS.map((p) => [p, Boolean(body?.external?.[p])]));
    providerCache = { value, until: Date.now() + 5 * 60_000 };
    return value;
  } catch (err) {
    logger.warn({ err: err.message }, 'could not read Supabase auth settings');
    return Object.fromEntries(PROVIDERS.map((p) => [p, false]));
  }
}

export function callbackUrl() {
  return env.OAUTH_CALLBACK_URL || `${env.CLIENT_URL.replace(/\/$/, '')}/api/auth/oauth/callback`;
}

/** Only same-site relative paths may be used as the post-login destination. */
export function safeNext(next) {
  return typeof next === 'string' && /^\/(?!\/)[\w\-/?=&.%]*$/.test(next) ? next : '/app';
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(env.SESSION_SECRET, `oauth:${body}`)}`;
}
export function readState(value) {
  if (!value || typeof value !== 'string' || !value.includes('.')) return null;
  const [body, sig] = value.split('.');
  if (!safeEqual(sig, hmac(env.SESSION_SECRET, `oauth:${body}`))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return Date.now() - payload.t > STATE_TTL_MS ? null : payload;
  } catch {
    return null;
  }
}
const stateCookieOptions = () => ({ httpOnly: true, secure: env.isProduction, sameSite: 'lax', path: '/api/auth/oauth', maxAge: STATE_TTL_MS });

async function assertEnabled(provider) {
  if (!PROVIDERS.includes(provider)) throw AppError.notFound('Unknown sign-in provider');
  if (!(await enabledProviders())[provider]) {
    throw AppError.unavailable(`${provider === 'google' ? 'Google' : 'Facebook'} sign-in is not configured yet.`, 'OAUTH_PROVIDER_DISABLED');
  }
}

/** Begin sign-in: returns the provider URL to redirect to and sets the state cookie. */
export async function start(provider, next, res) {
  await assertEnabled(provider);
  const { client, store } = createPkceClient();
  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    options: { redirectTo: callbackUrl(), skipBrowserRedirect: true, scopes: provider === 'facebook' ? 'email public_profile' : undefined },
  });
  if (error || !data?.url) throw AppError.unavailable('Could not start social sign-in. Please try again.', 'OAUTH_START_FAILED');
  res.cookie(STATE_COOKIE, sign({ s: Object.fromEntries(store), p: provider, n: safeNext(next), m: 'signin', t: Date.now() }), stateCookieOptions());
  return data.url;
}

/** Begin linking another sign-in method to the signed-in account. */
export async function startLink(user, provider, tokens, res) {
  await assertEnabled(provider);
  const { client, store } = createPkceClient();
  const { error: sessionError } = await client.auth.setSession(tokens);
  if (sessionError) throw AppError.unauthorized('Please sign in again to link an account', 'SESSION_EXPIRED');
  const { data, error } = await client.auth.linkIdentity({ provider, options: { redirectTo: callbackUrl(), skipBrowserRedirect: true } });
  if (error || !data?.url) {
    if (/manual linking/i.test(error?.message || '')) throw AppError.unavailable('Linking sign-in methods is not enabled for this project yet.', 'OAUTH_LINKING_DISABLED');
    throw AppError.unavailable('Could not start account linking.', 'OAUTH_LINK_FAILED');
  }
  // Keep only the PKCE verifier, never the user's session tokens, in the state cookie.
  const verifier = Object.fromEntries([...store].filter(([k]) => k.endsWith('-code-verifier')));
  res.cookie(STATE_COOKIE, sign({ s: verifier, p: provider, n: '/app/settings/security', m: 'link', u: user.id, t: Date.now() }), stateCookieOptions());
  return data.url;
}

export function clearState(res) {
  res.clearCookie(STATE_COOKIE, { path: '/api/auth/oauth' });
}

/**
 * Exchange the authorization code. Returns one of:
 *   { kind: 'signin', session, user, profile }
 *   { kind: 'new', session, user }            (profile must be completed)
 *   { kind: 'linked', provider }
 */
export async function callback({ code, stateCookie }, req) {
  const state = readState(stateCookie);
  if (!state) throw AppError.badRequest('Your sign-in link expired. Please try again.', 'OAUTH_STATE_INVALID');
  if (!code) throw AppError.badRequest('Sign-in was cancelled.', 'OAUTH_CANCELLED');
  const { client } = createPkceClient(state.s);
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  if (error || !data?.session || !data.user) throw AppError.badRequest('Social sign-in could not be completed. Please try again.', 'OAUTH_EXCHANGE_FAILED');
  const { session, user } = data;

  if (state.m === 'link') {
    // The provider identity is now linked to the same Supabase user; drop the extra session.
    await supabaseAdmin.auth.admin.signOut(session.access_token, 'local').catch(() => {});
    if (user.id !== state.u) throw AppError.forbidden('That account could not be linked', 'OAUTH_LINK_MISMATCH');
    await securityService.recordChange({ userId: user.id, type: 'login_method_linked', next: state.p, req });
    await auditService.record({ actorId: user.id, action: `auth.oauth.link.${state.p}`, resourceType: 'profile', resourceId: user.id, req });
    const profile = await userRepo.findById(user.id);
    if (profile) emailService.sendLoginAlert(profile.email, profile.full_name, { device: `${state.p === 'google' ? 'Google' : 'Facebook'} sign-in linked`, time: new Date(), newDevice: true }).catch(() => {});
    return { kind: 'linked', provider: state.p, next: state.n };
  }

  const profile = await userRepo.findById(user.id);
  if (profile) {
    if (profile.account_status === 'suspended' || profile.account_status === 'closed') {
      await supabaseAdmin.auth.admin.signOut(session.access_token, 'local').catch(() => {});
      throw AppError.forbidden('This account is not active. Contact support for help.', 'ACCOUNT_SUSPENDED');
    }
    if (!profile.email_verified_at && user.email_confirmed_at && user.email?.toLowerCase() === profile.email) {
      await userRepo.update(user.id, { email_verified_at: new Date().toISOString(), account_status: profile.account_status === 'pending_verification' ? 'active' : profile.account_status });
      await complianceRepo.recomputeKyc(user.id);
    }
    await userRepo.registerLoginSuccess(user.id);
    await auditService.record({ actorId: user.id, action: `auth.login.oauth_${state.p}`, resourceType: 'profile', resourceId: user.id, req });
    return { kind: 'signin', session, user, profile, provider: state.p, next: state.n };
  }

  // No ACHIEVER profile for this Supabase user. Never merge by name; if the
  // email already belongs to another ACHIEVER account, refuse and explain.
  const email = user.email?.toLowerCase();
  if (email && (await userRepo.findByEmail(email))) {
    await supabaseAdmin.auth.admin.signOut(session.access_token, 'local').catch(() => {});
    await supabaseAdmin.auth.admin.deleteUser(user.id).catch(() => {});
    throw AppError.conflict('An ACHIEVER account already uses this email. Sign in with your password, then link Google or Facebook in Settings → Security.', 'OAUTH_EMAIL_IN_USE');
  }
  if (!email) {
    await supabaseAdmin.auth.admin.deleteUser(user.id).catch(() => {});
    throw AppError.unprocessable('Your social account did not share an email address. Please register with email instead.', 'OAUTH_EMAIL_REQUIRED');
  }
  await auditService.record({ actorId: null, action: `auth.oauth.new_identity.${state.p}`, resourceType: 'auth_user', resourceId: user.id, req });
  return { kind: 'new', session, user, provider: state.p, next: state.n };
}

/** Identity-only authentication for the complete-profile step (no ACHIEVER profile yet). */
export async function pendingIdentity(accessToken) {
  if (!accessToken) throw AppError.unauthorized();
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data?.user) throw AppError.unauthorized('Please sign in again', 'SESSION_EXPIRED');
  if (await userRepo.findById(data.user.id)) throw AppError.conflict('Your profile is already complete', 'PROFILE_EXISTS');
  const u = data.user;
  const provider = u.app_metadata?.provider;
  const meta = u.user_metadata || {};
  return {
    id: u.id,
    email: u.email,
    emailVerified: Boolean(u.email_confirmed_at),
    provider,
    suggested: { firstName: meta.given_name || meta.first_name || (meta.full_name || meta.name || '').split(' ')[0] || '', lastName: meta.family_name || meta.last_name || (meta.full_name || meta.name || '').split(' ').slice(1).join(' ') || '' },
  };
}

/** Create the ACHIEVER profile for a new social-login user. */
export async function completeProfile(identity, input, req) {
  const roles = REGISTRATION_ROLE_MAP[`${input.accountType}:${input.role}`];
  if (!roles) throw AppError.unprocessable('Choose a valid account type and role', 'INVALID_ACCOUNT_TYPE');
  const lga = await complianceRepo.findLga(input.lgaId);
  if (!lga || lga.state_code !== input.stateCode) throw AppError.unprocessable('The selected LGA does not belong to the selected state', 'INVALID_LGA');
  if (await userRepo.findByPhone(input.phone)) throw AppError.conflict('An account with this phone number already exists', 'PHONE_IN_USE');
  if (await userRepo.findByEmail(identity.email)) throw AppError.conflict('An account with this email already exists', 'EMAIL_IN_USE');
  const fullName = [input.firstName, input.middleName, input.lastName].filter(Boolean).join(' ');
  await userRepo.createProfileWithRoles({
    p_user_id: identity.id, p_full_name: fullName, p_email: identity.email.toLowerCase(), p_phone: input.phone,
    p_account_type: input.accountType, p_roles: roles, p_address: input.address ?? null, p_dob: input.dateOfBirth,
  });
  await userRepo.update(identity.id, {
    first_name: input.firstName, middle_name: input.middleName || null, last_name: input.lastName, preferred_name: input.preferredName || null,
    gender: input.gender, nationality: input.nationality || 'NG', occupation: input.occupation || null, employment_status: input.employmentStatus || null,
    business_name: input.businessName || null, country: 'NG', state_code: input.stateCode, lga_id: input.lgaId, city: input.city,
    address_unit: input.addressUnit || null, postal_code: input.postalCode || null,
    // The provider has verified this email address with Supabase Auth.
    ...(identity.emailVerified ? { email_verified_at: new Date().toISOString(), account_status: 'active' } : {}),
  });
  await complianceRepo.recomputeKyc(identity.id);
  await auditService.record({ actorId: identity.id, action: `auth.register.oauth_${identity.provider}`, resourceType: 'profile', resourceId: identity.id, req });
  if (identity.emailVerified) emailService.sendWelcomeEmail(identity.email, input.firstName).catch(() => {});
  return { userId: identity.id, emailVerificationRequired: !identity.emailVerified };
}

/** Sign-in methods on the account (Supabase identities). */
export async function identities(user) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(user.id);
  if (error || !data?.user) throw AppError.unavailable('Could not load sign-in methods');
  const list = (data.user.identities || []).map((i) => ({
    id: i.identity_id || i.id, provider: i.provider, email: i.identity_data?.email ?? null, linkedAt: i.created_at, lastUsedAt: i.last_sign_in_at,
  }));
  return { methods: list, providers: await enabledProviders() };
}

/** Remove a linked social sign-in (at least one method must remain). */
export async function unlink(user, provider, tokens, req) {
  const { client } = createPkceClient();
  const { error: sessionError } = await client.auth.setSession(tokens);
  if (sessionError) throw AppError.unauthorized('Please sign in again', 'SESSION_EXPIRED');
  const { data } = await client.auth.getUserIdentities();
  const all = data?.identities || [];
  const target = all.find((i) => i.provider === provider);
  if (!target) throw AppError.notFound('That sign-in method is not linked');
  if (all.length < 2) throw AppError.conflict('You must keep at least one way to sign in', 'LAST_LOGIN_METHOD');
  const { error } = await client.auth.unlinkIdentity(target);
  if (error) throw AppError.unavailable('Could not remove that sign-in method', 'OAUTH_UNLINK_FAILED');
  await securityService.recordChange({ userId: user.id, type: 'login_method_unlinked', previous: provider, req });
  await auditService.record({ actorId: user.id, action: `auth.oauth.unlink.${provider}`, resourceType: 'profile', resourceId: user.id, req });
}
