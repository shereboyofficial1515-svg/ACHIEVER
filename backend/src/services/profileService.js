import { env } from '../config/env.js';
import { BUCKETS } from '../config/constants.js';
import { paystack } from '../integrations/paystack/paystackClient.js';
import { sendEmail } from '../integrations/resend/resendClient.js';
import { sendSms } from '../integrations/termii/termiiClient.js';
import { templates } from '../integrations/resend/templates.js';
import * as userRepo from '../repositories/userRepository.js';
import * as complianceRepo from '../repositories/complianceRepository.js';
import * as authService from './authService.js';
import * as auditService from './auditService.js';
import * as notificationService from './notificationService.js';
import * as onboardingService from './onboardingService.js';
import * as storageService from './storageService.js';
import * as securityService from './securityService.js';
import * as sessionService from './sessionService.js';
import * as settingsService from './settingsService.js';
import * as kycService from './kycService.js';
import * as otpService from './otpService.js';
import { permissionsForRoles } from './permissionService.js';
import { AppError } from '../utils/AppError.js';
import { hmac } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { maskEmail, maskPhone } from '../utils/sanitize.js';

function ageYears(dob) {
  if (!dob) return null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  const [by, bm, bd] = String(dob).split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export async function me(userId) {
  const [profile, onboarding, kyc] = await Promise.all([
    userRepo.findWithLocation(userId),
    onboardingService.getStatus(userId),
    kycService.summary(userId),
  ]);
  const roles = (profile.user_roles || []).map((r) => r.role_code);
  return {
    id: profile.id,
    fullName: profile.full_name,
    firstName: profile.first_name,
    middleName: profile.middle_name,
    lastName: profile.last_name,
    preferredName: profile.preferred_name,
    gender: profile.gender,
    nationality: profile.nationality,
    occupation: profile.occupation,
    employmentStatus: profile.employment_status,
    businessName: profile.business_name,
    email: profile.email,
    phone: profile.phone,
    address: profile.address,
    addressUnit: profile.address_unit,
    city: profile.city,
    state: profile.state ? { code: profile.state.code, name: profile.state.name } : null,
    lga: profile.lga ? { id: profile.lga.id, name: profile.lga.name } : null,
    postalCode: profile.postal_code,
    country: profile.country,
    addressVerification: profile.address_verification_status,
    showPublicLocation: profile.show_public_location,
    dateOfBirth: profile.date_of_birth,
    age: ageYears(profile.date_of_birth),
    avatarUrl: storageService.publicUrl(BUCKETS.avatars, profile.avatar_path),
    primaryAccountType: profile.primary_account_type,
    status: profile.account_status,
    emailVerified: Boolean(profile.email_verified_at),
    phoneVerified: Boolean(profile.phone_verified_at),
    roles,
    permissions: await permissionsForRoles(roles),
    kyc,
    identityLocked: kyc.level >= 2,
    createdAt: profile.created_at,
    onboarding,
  };
}

/**
 * Profile update. Legal names and date of birth are locked once an identity
 * document has been verified (KYC level 2); after that they change only
 * through support. Every identity/address change is written to the
 * append-only account change history.
 */
export async function update(user, patch, req) {
  const profile = await userRepo.findById(user.id);
  const { level } = await kycService.levelOf(user.id);
  const row = {};
  const changes = [];

  const identityFields = ['firstName', 'middleName', 'lastName', 'dateOfBirth'].filter((k) => patch[k] !== undefined);
  if (identityFields.length && level >= 2) {
    throw AppError.conflict('Your legal name and date of birth are verified. Contact support to correct them.', 'IDENTITY_LOCKED');
  }
  if (patch.firstName !== undefined) row.first_name = patch.firstName;
  if (patch.middleName !== undefined) row.middle_name = patch.middleName || null;
  if (patch.lastName !== undefined) row.last_name = patch.lastName;
  if (['firstName', 'middleName', 'lastName'].some((k) => patch[k] !== undefined)) {
    const first = row.first_name ?? profile.first_name;
    const middle = row.middle_name !== undefined ? row.middle_name : profile.middle_name;
    const last = row.last_name ?? profile.last_name;
    row.full_name = [first, middle, last].filter(Boolean).join(' ');
    changes.push({ type: 'name_changed', previous: profile.full_name, next: row.full_name });
  } else if (patch.fullName !== undefined && !profile.first_name) {
    row.full_name = patch.fullName; // legacy accounts without structured names
    changes.push({ type: 'name_changed', previous: profile.full_name, next: patch.fullName });
  }
  if (patch.dateOfBirth !== undefined && patch.dateOfBirth !== profile.date_of_birth) {
    row.date_of_birth = patch.dateOfBirth;
    changes.push({ type: 'dob_changed' });
  }
  for (const [k, col] of [['preferredName', 'preferred_name'], ['gender', 'gender'], ['occupation', 'occupation'],
    ['employmentStatus', 'employment_status'], ['businessName', 'business_name'], ['showPublicLocation', 'show_public_location'],
    ['nationality', 'nationality']]) {
    if (patch[k] !== undefined) row[col] = patch[k] === '' ? null : patch[k];
  }

  const addressFields = ['address', 'addressUnit', 'city', 'stateCode', 'lgaId', 'postalCode'].filter((k) => patch[k] !== undefined);
  if (addressFields.length) {
    const stateCode = patch.stateCode ?? profile.state_code;
    const lgaId = patch.lgaId ?? profile.lga_id;
    if (lgaId) {
      const lga = await complianceRepo.findLga(lgaId);
      if (!lga || lga.state_code !== stateCode) throw AppError.unprocessable('The selected LGA does not belong to the selected state', 'INVALID_LGA');
    }
    if (patch.address !== undefined) row.address = patch.address || null;
    if (patch.addressUnit !== undefined) row.address_unit = patch.addressUnit || null;
    if (patch.city !== undefined) row.city = patch.city;
    if (patch.stateCode !== undefined) row.state_code = patch.stateCode;
    if (patch.lgaId !== undefined) row.lga_id = patch.lgaId;
    if (patch.postalCode !== undefined) row.postal_code = patch.postalCode || null;
    // A changed address must be verified again.
    if (profile.address_verification_status !== 'unverified') {
      row.address_verification_status = 'unverified';
      row.address_verified_at = null;
    }
    changes.push({ type: 'address_changed' });
  }

  if (!Object.keys(row).length) return me(user.id);
  await userRepo.update(user.id, row);
  for (const c of changes) {
    await securityService.recordChange({ userId: user.id, type: c.type, previous: c.previous ?? null, next: c.next ?? null, req });
  }
  await kycService.recompute(user.id);
  authService.invalidateUserCache(user.id);
  await auditService.record({ actorId: user.id, action: 'profile.update', resourceType: 'profile', resourceId: user.id, metadata: { fields: Object.keys(row) }, req });
  return me(user.id);
}

export async function uploadAvatar(user, file, req) {
  const profile = await userRepo.findById(user.id);
  const path = storageService.objectPath(user.id, file.detectedExt);
  await storageService.upload(BUCKETS.avatars, path, file);
  await userRepo.update(user.id, { avatar_path: path });
  if (profile.avatar_path) await storageService.remove(BUCKETS.avatars, profile.avatar_path);
  authService.invalidateUserCache(user.id);
  await auditService.record({ actorId: user.id, action: 'profile.avatar', resourceType: 'profile', resourceId: user.id, req });
  return { avatarUrl: storageService.publicUrl(BUCKETS.avatars, path) };
}

// Email & phone changes (verified on the NEW contact, alert on the OLD) --------------------------
async function requirePassword(user, password) {
  if (!(await authService.verifyPassword(user.email, password))) {
    throw AppError.badRequest('Your password is incorrect', 'INVALID_CREDENTIALS');
  }
}

export async function requestEmailChange(user, { newEmail, password }, req) {
  const email = newEmail.toLowerCase();
  if (email === user.email.toLowerCase()) throw AppError.badRequest('That is already your email address', 'SAME_EMAIL');
  await requirePassword(user, password);
  if (await userRepo.findByEmail(email)) throw AppError.conflict('An account with this email already exists', 'EMAIL_IN_USE');
  const code = await otpService.issue(user.id, 'email_change', 'email', email);
  const result = await sendEmail({ to: email, ...templates.emailVerification({ name: user.fullName, code }) });
  if (!result.ok && !env.isProduction) logger.warn({ userId: user.id }, `Email not delivered (${result.error}). Development email-change code: ${code}`);
  await auditService.record({ actorId: user.id, action: 'profile.email_change.requested', resourceType: 'profile', resourceId: user.id, metadata: { to: maskEmail(email) }, req });
  return { sent: result.ok, to: maskEmail(email) };
}

export async function confirmEmailChange(user, { code }, req) {
  const row = await otpService.verify(user.id, 'email_change', code);
  const email = row.pending_value;
  if (!email) throw AppError.badRequest('The code is invalid or has expired', 'OTP_INVALID');
  if (await userRepo.findByEmail(email)) throw AppError.conflict('An account with this email already exists', 'EMAIL_IN_USE');
  const previous = user.email;
  await authService.updateAuthEmail(user.id, email);
  await userRepo.update(user.id, { email, email_verified_at: new Date().toISOString() });
  await securityService.recordChange({ userId: user.id, type: 'email_changed', previous: maskEmail(previous), next: maskEmail(email), req });
  await kycService.recompute(user.id);
  authService.invalidateUserCache(user.id);
  await auditService.record({ actorId: user.id, action: 'profile.email_changed', resourceType: 'profile', resourceId: user.id, req });
  const t = templates.securityAlert({ name: user.fullName, event: `The email address on your ACHIEVER account was changed to ${maskEmail(email)}. If this was not you, contact support immediately.` });
  sendEmail({ to: previous, ...t }).catch(() => {});
  return me(user.id);
}

export async function requestPhoneChange(user, { newPhone, password }, req) {
  if (newPhone === user.phone) throw AppError.badRequest('That is already your phone number', 'SAME_PHONE');
  await requirePassword(user, password);
  if (await userRepo.findByPhone(newPhone)) throw AppError.conflict('An account with this phone number already exists', 'PHONE_IN_USE');
  if (!env.features.sms && env.isProduction) throw AppError.unavailable('SMS verification is temporarily unavailable', 'SMS_NOT_CONFIGURED');
  const code = await otpService.issue(user.id, 'phone_change', 'sms', newPhone);
  const result = await sendSms({ to: newPhone, message: `Your ACHIEVER code to confirm this phone number is ${code}. It expires in 10 minutes. Do not share it.` });
  if (!result.ok) {
    if (env.isProduction) throw AppError.unavailable('We could not send the SMS. Please try again shortly.', 'SMS_SEND_FAILED');
    logger.warn({ userId: user.id }, `SMS not delivered (${result.error}). Development phone-change code: ${code}`);
  }
  await auditService.record({ actorId: user.id, action: 'profile.phone_change.requested', resourceType: 'profile', resourceId: user.id, metadata: { to: maskPhone(newPhone) }, req });
  return { sent: result.ok, to: maskPhone(newPhone) };
}

export async function confirmPhoneChange(user, { code }, req) {
  const row = await otpService.verify(user.id, 'phone_change', code);
  const phone = row.pending_value;
  if (!phone) throw AppError.badRequest('The code is invalid or has expired', 'OTP_INVALID');
  if (await userRepo.findByPhone(phone)) throw AppError.conflict('An account with this phone number already exists', 'PHONE_IN_USE');
  const previous = user.phone;
  await userRepo.update(user.id, { phone, phone_verified_at: new Date().toISOString() });
  await securityService.recordChange({ userId: user.id, type: 'phone_changed', previous: maskPhone(previous), next: maskPhone(phone), req });
  await kycService.recompute(user.id);
  authService.invalidateUserCache(user.id);
  await auditService.record({ actorId: user.id, action: 'profile.phone_changed', resourceType: 'profile', resourceId: user.id, req });
  const t = templates.securityAlert({ name: user.fullName, event: `The phone number on your ACHIEVER account was changed to ${maskPhone(phone)}. If this was not you, contact support immediately.` });
  sendEmail({ to: user.email, ...t }).catch(() => {});
  return me(user.id);
}

// Payout account (payment-account protection) -------------------------------------------------
function formatPayoutAccount(a) {
  if (!a) return null;
  const coolingDown = a.cooldown_until && new Date(a.cooldown_until).getTime() > Date.now();
  return {
    bankCode: a.bank_code, bankName: a.bank_name, accountName: a.account_name, last4: a.account_last4,
    verifiedAt: a.verified_at, transferReady: Boolean(a.paystack_recipient_code),
    status: coolingDown ? 'cooldown' : a.status ?? 'verified', cooldownUntil: coolingDown ? a.cooldown_until : null,
  };
}

export async function getPayoutAccount(user) {
  const [account, history] = await Promise.all([userRepo.getPayoutAccount(user.id), complianceRepo.listPaymentAccountChanges(user.id, 10)]);
  return account ? { ...formatPayoutAccount(account), history } : null;
}

async function resolveBankAccount(bankCode, accountNumber) {
  const banks = await paystack.listBanks();
  const bank = banks.find((b) => b.code === bankCode);
  if (!bank) throw AppError.badRequest('Choose a valid bank', 'INVALID_BANK');
  try {
    const resolved = await paystack.resolveAccount({ accountNumber, bankCode });
    return { bank, accountName: resolved.account_name };
  } catch (err) {
    if (err.code === 'PAYSTACK_ERROR') throw AppError.unprocessable('We could not verify that account number with the bank', 'ACCOUNT_NOT_RESOLVED');
    throw err;
  }
}

// The full account number is never stored; the OTP is bound to a keyed hash of it.
const accountBinding = (bankCode, accountNumber) => `${bankCode}:${hmac(env.SESSION_SECRET, `payout:${bankCode}:${accountNumber}`)}`;

async function saveAccount(user, { bank, accountName, bankCode, accountNumber }, previous, method, req) {
  let recipientCode = null;
  if (env.features.transfers) {
    const recipient = await paystack.createTransferRecipient({ name: accountName, accountNumber, bankCode });
    recipientCode = recipient.recipient_code;
  }
  const hours = Number(await settingsService.get('security.payment_account_cooldown_hours', 24)) || 0;
  const cooldownUntil = previous && hours > 0 ? new Date(Date.now() + hours * 3600_000).toISOString() : null;
  const last4 = accountNumber.slice(-4);
  const saved = await userRepo.upsertPayoutAccount({
    user_id: user.id, bank_code: bankCode, bank_name: bank.name, account_name: accountName, account_last4: last4,
    paystack_recipient_code: recipientCode, verified_at: new Date().toISOString(),
    status: cooldownUntil ? 'cooldown' : 'verified', cooldown_until: cooldownUntil, provider: 'paystack',
    change_count: (previous?.change_count ?? 0) + (previous ? 1 : 0),
  });
  await complianceRepo.insertPaymentAccountChange({
    user_id: user.id, previous_bank_name: previous?.bank_name ?? null, previous_last4: previous?.account_last4 ?? null,
    new_bank_name: bank.name, new_last4: last4, new_account_name: accountName, verification_method: method,
    actor_id: user.id, session_id: user.sessionId ?? null, ip_address: req.ip || null, cooldown_until: cooldownUntil,
  });
  await securityService.recordChange({
    userId: user.id, type: previous ? 'payment_account_changed' : 'payment_account_added',
    previous: previous ? `${previous.bank_name} ****${previous.account_last4}` : null, next: `${bank.name} ****${last4}`, req,
  });
  if (previous) {
    await securityService.recordEvent({
      userId: user.id, type: 'payment_account_change', severity: 'medium', sessionId: user.sessionId ?? null,
      description: `Payout account changed to ${bank.name} ****${last4}. Automated payouts are held until ${cooldownUntil ?? 'review'}.`,
      metadata: { change_count: saved.change_count },
    });
  }
  await auditService.record({ actorId: user.id, action: 'profile.payout_account.set', resourceType: 'payout_account', resourceId: user.id, metadata: { bank: bank.name, last4, method, cooldownUntil }, req });
  await notificationService.notify(user.id, {
    type: 'payout_account_changed', category: 'security', title: previous ? 'Payout account changed' : 'Payout account added',
    body: `Your payout account is now ${bank.name} ****${last4}.${cooldownUntil ? ` For your protection, automated payouts to it start after ${new Date(cooldownUntil).toUTCString()}.` : ''} If this was not you, contact support immediately.`,
    data: {}, dedupeKey: `payout_account:${user.id}:${Date.now()}`,
  });
  if (previous) {
    const t = templates.securityAlert({ name: user.fullName, event: `Your payout account was changed from ${previous.bank_name} ****${previous.account_last4} to ${bank.name} ****${last4}. If this was not you, contact support immediately.` });
    sendEmail({ to: user.email, ...t }).catch(() => {});
  }
  return formatPayoutAccount(saved);
}

/**
 * First account: saved after bank resolution. Changing an existing account
 * needs a one-time code (step 1 here, step 2 in confirmPayoutAccountChange),
 * triggers alerts, and starts a cool-down during which payouts are held.
 */
export async function setPayoutAccount(user, { bankCode, accountNumber }, req) {
  const previous = await userRepo.getPayoutAccount(user.id);
  const resolved = await resolveBankAccount(bankCode, accountNumber);
  if (!previous) return { account: await saveAccount(user, { ...resolved, bankCode, accountNumber }, null, 'first_account', req), otpRequired: false };

  const code = await otpService.issue(user.id, 'payout_account_change', 'email', accountBinding(bankCode, accountNumber));
  const result = await sendEmail({ to: user.email, ...templates.emailVerification({ name: user.fullName, code }) });
  if (!result.ok && !env.isProduction) logger.warn({ userId: user.id }, `Email not delivered (${result.error}). Development payout-change code: ${code}`);
  await auditService.record({ actorId: user.id, action: 'profile.payout_account.change_requested', resourceType: 'payout_account', resourceId: user.id, metadata: { bank: resolved.bank.name, last4: accountNumber.slice(-4) }, req });
  return { otpRequired: true, sent: result.ok, accountName: resolved.accountName, bankName: resolved.bank.name, last4: accountNumber.slice(-4) };
}

export async function confirmPayoutAccountChange(user, { bankCode, accountNumber, code }, req) {
  const previous = await userRepo.getPayoutAccount(user.id);
  if (!previous) throw AppError.badRequest('Add a payout account first', 'NO_PAYOUT_ACCOUNT');
  const row = await otpService.verify(user.id, 'payout_account_change', code);
  if (row.pending_value !== accountBinding(bankCode, accountNumber)) {
    throw AppError.badRequest('This code was issued for a different account. Start the change again.', 'OTP_MISMATCH');
  }
  const resolved = await resolveBankAccount(bankCode, accountNumber);
  return { account: await saveAccount(user, { ...resolved, bankCode, accountNumber }, previous, 'otp_email', req), otpRequired: false };
}

// Deactivation (financial and security records are always retained) ---------------------------------
export async function deactivate(user, { password, reason }, req) {
  await requirePassword(user, password);
  const o = await userRepo.openObligations(user.id);
  const blockers = [];
  if (o.organisedGroups) blockers.push(`${o.organisedGroups} Osusu group(s) you organise are still open`);
  if (o.activeMemberships) blockers.push(`you are a member of ${o.activeMemberships} active Osusu group(s)`);
  if (o.plans) blockers.push(`${o.plans} savings plan(s) are still open`);
  if (o.pendingPayouts) blockers.push(`${o.pendingPayouts} payout(s) to you are still being processed`);
  if (blockers.length) {
    throw AppError.unprocessable(`Your account cannot be deactivated yet: ${blockers.join('; ')}.`, 'OPEN_OBLIGATIONS', o);
  }
  const now = new Date().toISOString();
  await userRepo.update(user.id, {
    account_status: 'closed', status_reason: 'Deactivated by the account owner', deactivated_at: now,
    deactivation_reason: reason ?? null, sessions_revoked_at: now,
  });
  await sessionService.revokeAll(user.id, 'account_deactivated');
  await securityService.recordChange({ userId: user.id, type: 'account_deactivated', reason: reason ?? null, req });
  authService.invalidateUserCache(user.id);
  await auditService.record({ actorId: user.id, action: 'profile.deactivate', resourceType: 'profile', resourceId: user.id, metadata: { reason }, req });
  const t = templates.securityAlert({ name: user.fullName, event: 'Your ACHIEVER account was deactivated. Your transaction history is retained as required. Contact support to reactivate it.' });
  sendEmail({ to: user.email, ...t }).catch(() => {});
}

// Trust profile (safe public information only) ------------------------------------------------
export async function trustProfile(userId) {
  const t = await complianceRepo.userTrustProfile(userId);
  if (!t) throw AppError.notFound('User not found');
  return {
    userId: t.user_id,
    displayName: t.display_name,
    avatarUrl: storageService.publicUrl(BUCKETS.avatars, t.avatar_path),
    location: t.public_location || null,
    memberSince: t.member_since,
    verification: {
      email: t.email_verified, phone: t.phone_verified, identity: t.identity_verified, paymentAccount: t.payment_account_verified,
    },
    completedGroups: Number(t.completed_groups),
    contributionsPaid: Number(t.contributions_paid),
    onTimeRate: Number(t.contributions_paid) ? Math.round((Number(t.contributions_on_time) / Number(t.contributions_paid)) * 100) : null,
    active: t.active,
  };
}

export function publicContact(profile) {
  return { email: maskEmail(profile.email), phone: maskPhone(profile.phone) };
}
