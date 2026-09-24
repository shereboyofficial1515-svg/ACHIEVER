import { BUCKETS } from '../config/constants.js';
import * as privacyRepo from '../repositories/privacyRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import * as challengeService from './challengeService.js';
import * as securityService from './securityService.js';
import * as sessionService from './sessionService.js';
import * as notificationService from './notificationService.js';
import * as storageService from './storageService.js';
import * as auditService from './auditService.js';
import { AppError } from '../utils/AppError.js';
import { pageMeta } from '../utils/pagination.js';

/**
 * Account and personal-data deletion requests.
 *
 *  - account:        the account is closed and optional personal data erased
 *  - personal_data:  optional personal data is erased; the account stays open
 *
 * Records that must be kept for legal, financial, dispute and fraud-prevention
 * purposes (identity/KYC evidence, ledger and payment records, contributions,
 * payouts, disputes and evidence, audit and security logs) are RETAINED.
 * Requests have a 7-day cancellation window and are completed by compliance
 * staff (never the requester).
 */
export const RETAINED = [
  'Legal name, date of birth and identity verification records',
  'Transactions, payments, contributions, payouts, refunds and savings plan records',
  'Dispute cases, evidence and support conversations',
  'Audit, security and sensitive-data access logs',
];
const ERASED = ['Preferred name', 'Occupation, employment and business name', 'Profile photo', 'Public location display', 'Settings and preferences', 'Unused device records'];

function format(r) {
  if (!r) return null;
  return {
    id: r.id,
    type: r.request_type,
    status: r.status,
    reason: r.reason,
    cancellableUntil: r.cancellable_until,
    canCancel: r.status === 'pending' && new Date(r.cancellable_until) > new Date(),
    decisionNote: r.decision_note,
    retainedSummary: r.retained_summary,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    createdAt: r.created_at,
    user: r.user ? { id: r.user.id, name: r.user.full_name, email: r.user.email } : undefined,
  };
}

export function policy() {
  return { retained: RETAINED, erased: ERASED, cancellationDays: 7 };
}

export async function request(user, { type, reason, challengeId, code }, req) {
  await challengeService.use(user, { challengeId, code, action: 'account_deletion' }, req);
  if (await privacyRepo.openForUser(user.id, type)) throw AppError.conflict('You already have an open request of this type', 'REQUEST_ALREADY_OPEN');
  const row = await privacyRepo.insert({ user_id: user.id, request_type: type, reason: reason ?? null });
  await securityService.recordChange({ userId: user.id, type: 'deletion_requested', next: type, reason: reason ?? null, req });
  await auditService.record({ actorId: user.id, action: `privacy.deletion.request.${type}`, resourceType: 'data_deletion_request', resourceId: row.id, req });
  await notificationService.notify(user.id, {
    type: 'deletion_requested', category: 'security',
    title: type === 'account' ? 'Account deletion requested' : 'Personal data deletion requested',
    body: `We received your ${type === 'account' ? 'account deletion' : 'personal data deletion'} request. You can cancel it until ${new Date(row.cancellable_until).toUTCString()}. Records we must keep by law are retained.`,
    data: { request_id: row.id }, dedupeKey: `deletion_requested:${row.id}`,
  });
  return format(row);
}

export async function listMine(user) {
  return (await privacyRepo.listForUser(user.id)).map(format);
}

export async function cancel(user, id, req) {
  const r = await privacyRepo.find(id);
  if (!r || r.user_id !== user.id) throw AppError.notFound('Request not found');
  if (new Date(r.cancellable_until) <= new Date()) throw AppError.conflict('The cancellation period for this request has ended. Contact support.', 'CANCELLATION_CLOSED');
  const updated = await privacyRepo.transition(id, ['pending'], { status: 'cancelled', cancelled_at: new Date().toISOString() });
  if (!updated) throw AppError.conflict('Only pending requests can be cancelled', 'NOT_PENDING');
  await securityService.recordChange({ userId: user.id, type: 'deletion_cancelled', previous: r.request_type, req });
  await auditService.record({ actorId: user.id, action: 'privacy.deletion.cancel', resourceType: 'data_deletion_request', resourceId: id, req });
  return format(updated);
}

// Staff ---------------------------------------------------------------------------------------
export async function list(filters) {
  const result = await privacyRepo.list(filters);
  return { items: result.rows.map(format), meta: pageMeta(filters, result.total) };
}

export async function decide(actor, id, { decision, note }, req) {
  const r = await privacyRepo.find(id);
  if (!r) throw AppError.notFound('Request not found');
  if (r.user_id === actor.id) throw AppError.forbidden('You cannot decide your own request', 'SELF_REVIEW_FORBIDDEN');
  const now = new Date().toISOString();

  if (decision === 'in_review') {
    const updated = await privacyRepo.transition(id, ['pending'], { status: 'in_review', decided_by: actor.id, decision_note: note ?? null });
    if (!updated) throw AppError.conflict('Only pending requests can be moved to review', 'NOT_PENDING');
    return format(updated);
  }
  if (decision === 'reject') {
    if (!note) throw AppError.unprocessable('Explain why the request is rejected', 'REASON_REQUIRED');
    const updated = await privacyRepo.transition(id, ['pending', 'in_review'], { status: 'rejected', decided_by: actor.id, decided_at: now, decision_note: note });
    if (!updated) throw AppError.conflict('This request is already closed', 'ALREADY_DECIDED');
    await notifyOutcome(r, 'rejected', note);
    await auditService.record({ actorId: actor.id, action: 'privacy.deletion.reject', resourceType: 'data_deletion_request', resourceId: id, metadata: { note }, req });
    return format(updated);
  }

  // complete
  if (!['pending', 'in_review'].includes(r.status)) throw AppError.conflict('This request is already closed', 'ALREADY_DECIDED');
  if (new Date(r.cancellable_until) > new Date()) {
    throw AppError.conflict('The user can still cancel this request. Complete it after the cancellation period ends.', 'COOLING_OFF');
  }
  if (r.request_type === 'account') {
    const o = await userRepo.openObligations(r.user_id);
    const open = Object.entries(o).filter(([, n]) => n > 0);
    if (open.length) {
      throw new AppError(409, 'OPEN_OBLIGATIONS', 'The account still has open groups, savings plans or payouts. Resolve them before deleting the account.', o);
    }
  }
  const erased = await privacyRepo.eraseOptionalPersonalData(r.user_id, actor.id, id);
  if (erased?.avatar_path) await storageService.remove(BUCKETS.avatars, erased.avatar_path);
  if (r.request_type === 'account') {
    await userRepo.update(r.user_id, {
      account_status: 'closed', status_reason: 'Closed at the user’s request', deactivated_at: now,
      deactivation_reason: 'Account deletion request', sessions_revoked_at: now,
    });
    await sessionService.revokeAll(r.user_id, 'account_deleted');
    const { invalidateUserCache } = await import('./authService.js');
    invalidateUserCache(r.user_id);
  }
  const summary = `Retained as required: ${RETAINED.join('; ')}.`;
  const updated = await privacyRepo.transition(id, ['pending', 'in_review'], {
    status: 'completed', decided_by: actor.id, decided_at: now, completed_at: now, decision_note: note ?? null, retained_summary: summary,
  });
  await notifyOutcome(r, 'completed', note);
  await auditService.record({ actorId: actor.id, action: `privacy.deletion.complete.${r.request_type}`, resourceType: 'data_deletion_request', resourceId: id, req });
  return format(updated);
}

async function notifyOutcome(r, outcome, note) {
  await notificationService.notify(r.user_id, {
    type: 'deletion_decision', category: 'security',
    title: outcome === 'completed' ? 'Your deletion request is complete' : 'Your deletion request was not completed',
    body: outcome === 'completed'
      ? `Your ${r.request_type === 'account' ? 'account has been closed and ' : ''}optional personal data has been erased. Records we are required to keep are retained.`
      : `Your deletion request could not be completed: ${note}`,
    data: { request_id: r.id }, dedupeKey: `deletion_decision:${r.id}:${outcome}`,
  });
}
