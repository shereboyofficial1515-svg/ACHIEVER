import { env } from '../config/env.js';
import { BUCKETS } from '../config/constants.js';
import { paystack } from '../integrations/paystack/paystackClient.js';
import * as userRepo from '../repositories/userRepository.js';
import * as authService from './authService.js';
import * as auditService from './auditService.js';
import * as notificationService from './notificationService.js';
import * as onboardingService from './onboardingService.js';
import * as storageService from './storageService.js';
import { AppError } from '../utils/AppError.js';
import { maskEmail, maskPhone } from '../utils/sanitize.js';

export async function me(userId) {
  const profile = await userRepo.findById(userId);
  const onboarding = await onboardingService.getStatus(userId);
  return {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email,
    phone: profile.phone,
    address: profile.address,
    dateOfBirth: profile.date_of_birth,
    avatarUrl: storageService.publicUrl(BUCKETS.avatars, profile.avatar_path),
    primaryAccountType: profile.primary_account_type,
    status: profile.account_status,
    emailVerified: Boolean(profile.email_verified_at),
    phoneVerified: Boolean(profile.phone_verified_at),
    roles: (profile.user_roles || []).map((r) => r.role_code),
    createdAt: profile.created_at,
    onboarding,
  };
}

export async function update(user, patch, req) {
  const row = {};
  if (patch.fullName !== undefined) row.full_name = patch.fullName;
  if (patch.address !== undefined) row.address = patch.address;
  if (patch.dateOfBirth !== undefined) row.date_of_birth = patch.dateOfBirth;
  await userRepo.update(user.id, row);
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

function formatPayoutAccount(a) {
  return a ? { bankCode: a.bank_code, bankName: a.bank_name, accountName: a.account_name, last4: a.account_last4, verifiedAt: a.verified_at, transferReady: Boolean(a.paystack_recipient_code) } : null;
}

export async function getPayoutAccount(user) {
  return formatPayoutAccount(await userRepo.getPayoutAccount(user.id));
}

/**
 * Resolve the account name with Paystack before saving; the full account
 * number is only held long enough to create a transfer recipient.
 */
export async function setPayoutAccount(user, { bankCode, accountNumber }, req) {
  const banks = await paystack.listBanks();
  const bank = banks.find((b) => b.code === bankCode);
  if (!bank) throw AppError.badRequest('Choose a valid bank', 'INVALID_BANK');
  let resolved;
  try {
    resolved = await paystack.resolveAccount({ accountNumber, bankCode });
  } catch (err) {
    if (err.code === 'PAYSTACK_ERROR') throw AppError.unprocessable('We could not verify that account number with the bank', 'ACCOUNT_NOT_RESOLVED');
    throw err;
  }
  let recipientCode = null;
  if (env.features.transfers) {
    const recipient = await paystack.createTransferRecipient({ name: resolved.account_name, accountNumber, bankCode });
    recipientCode = recipient.recipient_code;
  }
  const saved = await userRepo.upsertPayoutAccount({
    user_id: user.id,
    bank_code: bankCode,
    bank_name: bank.name,
    account_name: resolved.account_name,
    account_last4: accountNumber.slice(-4),
    paystack_recipient_code: recipientCode,
    verified_at: new Date().toISOString(),
  });
  await auditService.record({ actorId: user.id, action: 'profile.payout_account.set', resourceType: 'payout_account', resourceId: user.id, metadata: { bank: bank.name, last4: accountNumber.slice(-4) }, req });
  await notificationService.notify(user.id, {
    type: 'payout_account_changed', category: 'security', title: 'Payout account updated',
    body: `Your payout account was set to ${bank.name} ****${accountNumber.slice(-4)}. If this was not you, contact support immediately.`,
    data: {}, dedupeKey: `payout_account:${user.id}:${Date.now()}`,
  });
  return formatPayoutAccount(saved);
}

export function publicContact(profile) {
  return { email: maskEmail(profile.email), phone: maskPhone(profile.phone) };
}
