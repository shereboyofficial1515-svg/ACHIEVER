import { BUCKETS, OPERATOR_ROLES, ROLES, SELF_SERVICE_ROLES } from '../config/constants.js';
import { getIdentityProvider } from '../integrations/identity/index.js';
import * as userRepo from '../repositories/userRepository.js';
import * as verificationRepo from '../repositories/verificationRepository.js';
import * as auditService from './auditService.js';
import * as authService from './authService.js';
import * as notificationService from './notificationService.js';
import * as settingsService from './settingsService.js';
import * as storageService from './storageService.js';
import * as kycService from './kycService.js';
import * as securityService from './securityService.js';
import { AppError } from '../utils/AppError.js';
import { hashIdentityNumber, sha256 } from '../utils/crypto.js';

/**
 * Operator undertaking. The text is versioned; changing it requires a new
 * version in app_settings so every operator re-accepts.
 */
export const UNDERTAKING_TEXT = {
  '2026-09-v1': [
    'I confirm that I am responsible for all funds handled through my ACHIEVER account on behalf of members or savers.',
    'I will not abscond with, withhold, divert or misuse any member\'s or saver\'s funds.',
    'I understand that misappropriation of funds may result in civil and criminal legal consequences under Nigerian law.',
    'I consent to my verified identity details and address being used to hold me accountable, including disclosure to law enforcement or a court where legally required.',
    'I will follow the rules of each group or savings plan I manage and treat members and savers fairly.',
  ],
};

const operatorCache = new Map();

export async function currentUndertaking() {
  const version = await settingsService.get('undertaking.current_version', '2026-09-v1');
  const clauses = UNDERTAKING_TEXT[version];
  if (!clauses) throw AppError.unavailable('Undertaking text is not configured', 'UNDERTAKING_MISSING');
  return { version, clauses, sha256: sha256(clauses.join('\n')) };
}

export async function getStatus(userId) {
  const [profile, identity, undertakings, undertaking, kyc] = await Promise.all([
    userRepo.findById(userId),
    verificationRepo.latestForUser(userId),
    verificationRepo.undertakingsForUser(userId),
    currentUndertaking(),
    kycService.summary(userId),
  ]);
  const roles = (profile.user_roles || []).map((r) => r.role_code);
  const accepted = (role) => undertakings.some((u) => u.role_context === role && u.undertaking_version === undertaking.version);
  const operatorLevel = Number(kyc.requiredLevels?.operator ?? 2);
  const kycOk = kyc.level >= operatorLevel && !kyc.restricted;
  const operators = OPERATOR_ROLES.filter((r) => roles.includes(r)).map((role) => ({
    role,
    undertakingAccepted: accepted(role),
    kycLevelRequired: operatorLevel,
    active: Boolean(profile.phone_verified_at) && kycOk && accepted(role),
  }));
  return {
    emailVerified: Boolean(profile.email_verified_at),
    phoneVerified: Boolean(profile.phone_verified_at),
    identity: identity
      ? {
          status: identity.status,
          idType: identity.id_type,
          last4: identity.id_last4,
          documentNumberMasked: identity.document_number_masked,
          issuingCountry: identity.issuing_country,
          expiryDate: identity.expiry_date,
          liveness: identity.liveness_status,
          documentUploaded: Boolean(identity.document_path),
          failureReason: identity.status === 'failed' ? identity.failure_reason || identity.review_note : null,
          submittedAt: identity.created_at,
        }
      : null,
    identityDocumentRequired: getIdentityProvider().requiresDocument === true,
    kyc,
    livenessAvailable: false,
    undertakingVersion: undertaking.version,
    operators,
    roles,
  };
}

export async function isOperatorActive(userId, role) {
  const key = `${userId}:${role}`;
  const hit = operatorCache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const status = await getStatus(userId);
  const value = status.operators.find((o) => o.role === role)?.active ?? false;
  operatorCache.set(key, { value, until: Date.now() + 30_000 });
  return value;
}

function clearOperatorCache(userId) {
  for (const key of operatorCache.keys()) if (key.startsWith(`${userId}:`)) operatorCache.delete(key);
}

function maskDocumentNumber(value) {
  const v = String(value);
  return `${'•'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}`;
}

export async function submitIdentity(user, { idType, idNumber, firstName, lastName, dateOfBirth, issuingCountry, issueDate, expiryDate }, req) {
  const normalised = String(idNumber).toUpperCase().replace(/\s+/g, '');
  const latest = await verificationRepo.latestForUser(user.id);
  if (latest?.status === 'verified') throw AppError.conflict('Your identity is already verified', 'ALREADY_VERIFIED');
  if (latest && ['pending', 'manual_review'].includes(latest.status)) {
    throw AppError.conflict('Your identity verification is already under review', 'VERIFICATION_IN_PROGRESS');
  }
  const hash = hashIdentityNumber(idType, normalised);
  if (await verificationRepo.identityUsedByOther(idType, hash, user.id)) {
    await auditService.record({ actorId: user.id, action: 'verification.submit', resourceType: 'verification_record', result: 'denied', metadata: { reason: 'identity_in_use', idType }, req });
    throw AppError.conflict('This identity cannot be used for verification. Contact support if you believe this is an error.', 'IDENTITY_UNAVAILABLE');
  }

  const provider = getIdentityProvider();
  // Documents other than BVN/NIN cannot be checked automatically: staff review them.
  const automated = ['bvn', 'nin'].includes(idType);
  const outcome = automated
    ? await provider.verify({ idType, idNumber: normalised, firstName, lastName, dateOfBirth })
    : { status: 'manual_review', reason: 'Awaiting document review by ACHIEVER staff' };
  const record = await verificationRepo.insert({
    user_id: user.id,
    id_type: idType,
    id_number_hash: hash,
    id_last4: normalised.slice(-4),
    document_number_masked: maskDocumentNumber(normalised),
    issuing_country: issuingCountry ?? 'NG',
    issue_date: issueDate ?? null,
    expiry_date: expiryDate ?? null,
    provider: automated ? provider.name : 'manual',
    provider_reference: outcome.providerReference ?? null,
    status: outcome.status,
    name_match: outcome.nameMatch ?? null,
    failure_reason: outcome.status === 'failed' ? outcome.reason ?? 'Verification failed' : null,
    verified_at: outcome.status === 'verified' ? new Date().toISOString() : null,
  });
  const profile = await userRepo.findById(user.id);
  const fill = {};
  if (dateOfBirth && !profile.date_of_birth) fill.date_of_birth = dateOfBirth;
  if (firstName && !profile.first_name) fill.first_name = firstName;
  if (lastName && !profile.last_name) fill.last_name = lastName;
  if (Object.keys(fill).length) await userRepo.update(user.id, fill);
  if (outcome.status === 'failed') {
    await securityService.recordEvent({
      userId: user.id, type: 'identity_verification_failure', severity: 'low',
      description: 'An identity verification attempt was unsuccessful.', metadata: { idType },
    });
  }
  await kycService.recompute(user.id);
  clearOperatorCache(user.id);
  await auditService.record({ actorId: user.id, action: 'verification.submit', resourceType: 'verification_record', resourceId: record.id, metadata: { idType, provider: provider.name, status: outcome.status }, req });
  return { status: record.status, idType: record.id_type, last4: record.id_last4, documentRequired: !automated || provider.requiresDocument === true };
}

export async function uploadIdentityDocument(user, file, req) {
  const latest = await verificationRepo.latestForUser(user.id);
  if (!latest || !['pending', 'manual_review'].includes(latest.status)) {
    throw AppError.unprocessable('Submit your identity document details before uploading a document', 'NO_PENDING_VERIFICATION');
  }
  const path = storageService.objectPath(user.id, file.detectedExt);
  await storageService.upload(BUCKETS.verification, path, file);
  if (latest.document_path) await storageService.remove(BUCKETS.verification, latest.document_path);
  await verificationRepo.update(latest.id, { document_path: path, status: 'manual_review' });
  await kycService.recompute(user.id);
  await auditService.record({ actorId: user.id, action: 'verification.document_upload', resourceType: 'verification_record', resourceId: latest.id, req });
  return { uploaded: true };
}

export async function acceptUndertaking(user, { role, accept }, req) {
  if (!accept) throw AppError.badRequest('You must accept the undertaking to continue', 'UNDERTAKING_REQUIRED');
  if (!OPERATOR_ROLES.includes(role) || !user.roles.includes(role)) throw AppError.forbidden();
  const undertaking = await currentUndertaking();
  await verificationRepo.insertUndertaking({
    user_id: user.id,
    undertaking_version: undertaking.version,
    role_context: role,
    text_sha256: undertaking.sha256,
    accepted: true,
    ip_address: req.ip || null,
    user_agent: req.get('user-agent')?.slice(0, 300) || null,
  });
  clearOperatorCache(user.id);
  await auditService.record({ actorId: user.id, action: 'undertaking.accept', resourceType: 'admin_undertaking', resourceId: user.id, metadata: { role, version: undertaking.version }, req });
  return { accepted: true, version: undertaking.version };
}

/** Self-service role addition (e.g. a member who wants to organise a group). */
export async function addSelfServiceRole(user, role, req) {
  if (!SELF_SERVICE_ROLES.includes(role)) throw AppError.forbidden('This role cannot be self-assigned');
  await userRepo.addRole(user.id, role, user.id);
  authService.invalidateUserCache(user.id);
  clearOperatorCache(user.id);
  await auditService.record({ actorId: user.id, action: 'role.self_add', resourceType: 'profile', resourceId: user.id, metadata: { role }, req });
  return { role };
}

// Staff review -----------------------------------------------------------------
export function listForReview(filters) {
  return verificationRepo.list(filters);
}

export async function getForReview(id) {
  const record = await verificationRepo.find(id);
  if (!record) throw AppError.notFound('Verification record not found');
  return record;
}

/**
 * Liveness / selfie verification needs a licensed provider. None is
 * configured, so this reports that honestly instead of simulating a pass.
 */
export async function startLiveness() {
  throw AppError.unavailable('Liveness verification is not available yet. A verification provider has not been configured.', 'LIVENESS_PROVIDER_NOT_CONFIGURED');
}

export async function documentUrl(actor, id, reason, req) {
  const record = await getForReview(id);
  if (!record.document_path) throw AppError.notFound('No document uploaded');
  await securityService.logDataAccess({ actor, subjectUserId: record.user_id, resourceType: 'verification_document', resourceId: id, fields: ['document'], reason, req });
  await auditService.record({ actorId: actor.id, action: 'verification.document_view', resourceType: 'verification_record', resourceId: id, req });
  return storageService.signedUrl(BUCKETS.verification, record.document_path, 120);
}

export async function decide(actor, id, { decision, note }, req) {
  const record = await getForReview(id);
  // Separation of duties: nobody may approve (or reject) their own identity.
  if (record.user_id === actor.id) throw AppError.forbidden('You cannot review your own identity verification', 'SELF_REVIEW_FORBIDDEN');
  if (!['pending', 'manual_review'].includes(record.status)) throw AppError.conflict('This record has already been decided', 'ALREADY_DECIDED');
  const updated = await verificationRepo.update(id, {
    status: decision,
    reviewed_by: actor.id,
    review_note: note ?? null,
    failure_reason: decision === 'failed' ? note ?? 'Verification could not be completed' : null,
    verified_at: decision === 'verified' ? new Date().toISOString() : null,
  });
  await kycService.recompute(record.user_id);
  if (decision === 'failed') {
    await securityService.recordEvent({
      userId: record.user_id, type: 'identity_verification_failure', severity: 'low', source: 'admin',
      description: 'An identity document could not be verified on review.', metadata: { verification_id: id },
    });
  }
  clearOperatorCache(record.user_id);
  await auditService.record({ actorId: actor.id, action: `verification.${decision}`, resourceType: 'verification_record', resourceId: id, metadata: { subject: record.user_id }, req });
  await notificationService.notify(record.user_id, {
    type: 'verification_decision',
    category: 'account',
    title: decision === 'verified' ? 'Identity verified' : 'Identity verification unsuccessful',
    body:
      decision === 'verified'
        ? 'Your identity has been verified. Operator features are now available once your undertaking is accepted.'
        : `We could not verify your identity. ${note ?? 'Please resubmit with a clear, valid document.'}`,
    data: {},
    dedupeKey: `verification:${id}:${decision}`,
  });
  return updated;
}

export const OPERATOR_ROLE_LIST = [ROLES.OSUSU_ADMIN, ROLES.COLLECTOR];
