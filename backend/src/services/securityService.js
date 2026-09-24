import * as securityRepo from '../repositories/securityRepository.js';
import * as auditService from './auditService.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { pageMeta } from '../utils/pagination.js';

/**
 * Security events are neutral observations ("flagged", "review required") —
 * never accusations. The observation is immutable; only the investigation
 * status/resolution may change (enforced by a database trigger).
 *
 * recordEvent never throws: detection must not break the user's request.
 */
export async function recordEvent({
  userId = null, type, severity = 'low', description, sessionId = null, metadata = {},
  relatedTransactionId = null, relatedGroupId = null, relatedCaseId = null, source = 'system', status,
}) {
  try {
    return await securityRepo.insertSecurityEvent({
      user_id: userId,
      event_type: type,
      severity,
      description,
      session_id: sessionId,
      related_transaction_id: relatedTransactionId,
      related_group_id: relatedGroupId,
      related_case_id: relatedCaseId,
      detection_source: source,
      metadata,
      ...(status ? { status } : {}),
    });
  } catch (err) {
    logger.error({ type, err: err.message }, 'security event not recorded');
    return null;
  }
}

/**
 * Append-only account change history. This DOES throw: a security-relevant
 * change must not go through without its history record.
 */
export async function recordChange({ userId, type, previous = null, next = null, actorId = null, sessionId = null, reason = null, req }) {
  await securityRepo.insertAccountChange({
    user_id: userId,
    event_type: type,
    previous_ref: previous,
    new_ref: next,
    actor_id: actorId ?? userId,
    session_id: sessionId ?? req?.user?.sessionId ?? null,
    ip_address: req?.ip || null,
    reason,
  });
}

/**
 * Sensitive-data access log. Written BEFORE the data is returned; if it
 * cannot be written the data is not released.
 */
export async function logDataAccess({ actor, subjectUserId = null, resourceType, resourceId = null, fields = [], reason, req }) {
  if (!reason || reason.trim().length < 5) {
    throw AppError.unprocessable('Give a reason (at least 5 characters) for viewing this information', 'ACCESS_REASON_REQUIRED');
  }
  await securityRepo.insertDataAccess({
    actor_id: actor.id,
    subject_user_id: subjectUserId,
    resource_type: resourceType,
    resource_id: resourceId ? String(resourceId) : null,
    fields,
    reason: reason.trim().slice(0, 500),
    session_id: actor.sessionId ?? null,
    ip_address: req?.ip || null,
  });
}

// User-facing security activity (safe fields only) ---------------------------------------
const CHANGE_LABELS = {
  password_changed: 'Password changed',
  password_reset: 'Password reset',
  phone_changed: 'Phone number changed',
  email_changed: 'Email address changed',
  name_changed: 'Name updated',
  dob_changed: 'Date of birth updated',
  address_changed: 'Address updated',
  identity_changed: 'Identity details updated',
  payment_account_added: 'Payout account added',
  payment_account_changed: 'Payout account changed',
  collector_status_changed: 'Collector status changed',
  group_role_changed: 'Group role changed',
  mfa_changed: 'Two-step verification changed',
  recovery_changed: 'Recovery details changed',
  device_added: 'New device signed in',
  device_removed: 'Device removed',
  risk_status_changed: 'Account review status changed',
  account_deactivated: 'Account deactivated',
  kyc_restriction_changed: 'Verification restriction changed',
};

export async function myActivity(user) {
  const [changes, events] = await Promise.all([
    securityRepo.listAccountChanges(user.id, 50),
    securityRepo.listSecurityEvents({ userId: user.id, page: 1, pageSize: 30 }),
  ]);
  return {
    changes: changes.map((c) => ({ id: c.id, type: c.event_type, label: CHANGE_LABELS[c.event_type] ?? c.event_type, byYou: c.actor_id === user.id, createdAt: c.created_at })),
    alerts: events.rows.map((e) => ({ id: e.id, type: e.event_type, description: e.description, severity: e.severity, createdAt: e.created_at })),
  };
}

// Staff ---------------------------------------------------------------------------------------
export async function listEvents(filters) {
  const result = await securityRepo.listSecurityEvents(filters);
  return { items: result.rows, meta: pageMeta(filters, result.total) };
}

export async function updateEvent(actor, id, { status, resolution }, req) {
  const event = await securityRepo.findSecurityEvent(id);
  if (!event) throw AppError.notFound('Security event not found');
  if (event.user_id === actor.id) throw AppError.forbidden('You cannot review a security event about your own account', 'SELF_REVIEW_FORBIDDEN');
  const patch = { status, reviewed_by: actor.id, reviewed_at: new Date().toISOString() };
  if (resolution !== undefined) patch.resolution = resolution;
  const updated = await securityRepo.updateSecurityEvent(id, patch);
  await auditService.record({ actorId: actor.id, action: 'security.event.update', resourceType: 'security_event', resourceId: id, metadata: { status }, req });
  return updated;
}

export async function accountChanges(userId) {
  return securityRepo.listAccountChanges(userId, 100);
}

export async function listDataAccess(filters) {
  const result = await securityRepo.listDataAccess(filters);
  return { items: result.rows, meta: pageMeta(filters, result.total) };
}
