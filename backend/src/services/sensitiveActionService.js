import * as complianceRepo from '../repositories/complianceRepository.js';
import * as paymentRepo from '../repositories/paymentRepository.js';
import * as collectorRepo from '../repositories/collectorRepository.js';
import * as disbursementRepo from '../repositories/disbursementRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import * as auditService from './auditService.js';
import * as notificationService from './notificationService.js';
import * as refundService from './refundService.js';
import * as riskService from './riskService.js';
import { can } from './permissionService.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { pageMeta } from '../utils/pagination.js';

/**
 * Two-person rule for high-impact actions. One authorised person requests
 * (with a reason), a DIFFERENT authorised person approves, and only then can
 * it be executed. The database enforces requester ≠ approver, single use,
 * one open request per target, and a 48-hour expiry.
 */
export const ACTIONS = {
  transaction_reversal: { request: 'finance.reversal.request', approve: 'finance.reversal.approve', targetType: 'transaction' },
  transaction_adjustment: { request: 'finance.reversal.request', approve: 'finance.reversal.approve', targetType: 'transaction' },
  collector_revoke: { request: 'collectors.status', approve: 'collectors.status', targetType: 'collector_account' },
  risk_restriction_lift: { request: 'risk.review', approve: 'risk.review', targetType: 'profile' },
  large_payout_confirm: { request: 'finance.payouts.execute', approve: 'finance.reversal.approve', targetType: 'disbursement' },
};

function format(r) {
  if (!r) return null;
  return {
    id: r.id,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    payload: r.payload,
    reason: r.reason,
    status: r.status !== 'executed' && ['pending', 'approved'].includes(r.status) && new Date(r.expires_at) < new Date() ? 'expired' : r.status,
    requestedBy: { id: r.requested_by, name: r.requester?.full_name },
    requestedAt: r.requested_at,
    decidedBy: r.decided_by ? { id: r.decided_by, name: r.decider?.full_name } : null,
    decidedAt: r.decided_at,
    decisionNote: r.decision_note,
    executedAt: r.executed_at,
    executionResult: r.execution_result,
    expiresAt: r.expires_at,
  };
}

async function validateTarget(action, targetId, payload) {
  switch (action) {
    case 'transaction_reversal': {
      const tx = await paymentRepo.findTransaction(targetId);
      if (!tx) throw AppError.notFound('Transaction not found');
      if (tx.status !== 'success') throw AppError.conflict('Only successful transactions can be reversed', 'NOT_REVERSIBLE');
      if (!['osusu_contribution', 'collector_savings'].includes(tx.type)) {
        throw AppError.unprocessable('This transaction type cannot be reversed; request an adjustment instead', 'REVERSAL_NOT_SUPPORTED');
      }
      return { subjectUserId: tx.user_id, payload: { refund: Boolean(payload?.refund) } };
    }
    case 'transaction_adjustment': {
      const tx = await paymentRepo.findTransaction(targetId);
      if (!tx) throw AppError.notFound('Transaction not found');
      const { amount, direction, description } = payload ?? {};
      if (!Number.isSafeInteger(amount) || amount <= 0) throw AppError.badRequest('Enter a valid adjustment amount');
      if (!['debit', 'credit'].includes(direction)) throw AppError.badRequest('Choose debit or credit');
      return { subjectUserId: tx.user_id, payload: { user_id: tx.user_id, related_transaction_id: tx.id, amount, direction, description: description ?? null } };
    }
    case 'collector_revoke': {
      const account = await collectorRepo.findAccount(targetId);
      if (!account) throw AppError.notFound('Collector account not found');
      if (account.status === 'revoked') throw AppError.conflict('This collector is already revoked', 'ALREADY_REVOKED');
      return { subjectUserId: account.collector_id, payload: {} };
    }
    case 'risk_restriction_lift': {
      if ((await riskService.statusOf(targetId)) !== 'restricted') throw AppError.conflict('This account is not restricted', 'NOT_RESTRICTED');
      const status = payload?.status === 'review_required' ? 'review_required' : 'normal';
      return { subjectUserId: targetId, payload: { status } };
    }
    case 'large_payout_confirm': {
      const kind = payload?.kind;
      if (!['osusu_payout', 'saver_return', 'commission'].includes(kind)) throw AppError.badRequest('Unknown payout type');
      const item = await disbursementRepo.find(kind, targetId);
      if (!item) throw AppError.notFound('Payout not found');
      return { subjectUserId: item.userId, payload: { kind, amount: item.amount } };
    }
    default:
      throw AppError.badRequest('Unknown action', 'UNKNOWN_ACTION');
  }
}

export async function request(actor, { action, targetId, payload, reason }, req) {
  const def = ACTIONS[action];
  if (!def) throw AppError.badRequest('Unknown action', 'UNKNOWN_ACTION');
  if (!can(actor, def.request)) throw AppError.forbidden('You do not have permission to request this action', 'PERMISSION_DENIED');
  const target = await validateTarget(action, targetId, payload);
  if (target.subjectUserId === actor.id) throw AppError.forbidden('You cannot request this action on your own account', 'SELF_REVIEW_FORBIDDEN');
  if (await complianceRepo.findOpenApproval(action, targetId)) {
    throw AppError.conflict('There is already an open request for this item', 'REQUEST_ALREADY_OPEN');
  }
  const row = await complianceRepo.insertApproval({
    action, target_type: def.targetType, target_id: targetId, payload: target.payload, reason, requested_by: actor.id,
  });
  await auditService.record({ actorId: actor.id, action: `approval.request.${action}`, resourceType: def.targetType, resourceId: targetId, metadata: { request_id: row.id, reason }, req });
  return format(row);
}

export async function decide(actor, id, { decision, note }, req) {
  const r = await complianceRepo.findApproval(id);
  if (!r) throw AppError.notFound('Request not found');
  const def = ACTIONS[r.action];
  if (!can(actor, def.approve)) throw AppError.forbidden('You do not have permission to approve this action', 'PERMISSION_DENIED');
  if (r.requested_by === actor.id) throw AppError.forbidden('A different person must approve this request', 'SELF_APPROVAL_FORBIDDEN');
  if (r.status !== 'pending') throw AppError.conflict('This request has already been decided', 'ALREADY_DECIDED');
  if (new Date(r.expires_at) < new Date()) {
    await complianceRepo.updateApproval(id, { status: 'expired' }, 'pending');
    throw AppError.conflict('This request has expired', 'APPROVAL_EXPIRED');
  }
  const updated = await complianceRepo.updateApproval(id, {
    status: decision === 'approve' ? 'approved' : 'rejected',
    decided_by: actor.id, decided_at: new Date().toISOString(), decision_note: note ?? null,
  }, 'pending');
  if (!updated) throw AppError.conflict('This request has already been decided', 'ALREADY_DECIDED');
  await auditService.record({ actorId: actor.id, action: `approval.${decision}.${r.action}`, resourceType: 'sensitive_action_request', resourceId: id, metadata: { note }, req });
  await notificationService.notify(r.requested_by, {
    type: 'approval_decision', category: 'system',
    title: decision === 'approve' ? 'Request approved' : 'Request rejected',
    body: `Your ${r.action.replace(/_/g, ' ')} request was ${decision === 'approve' ? 'approved' : 'rejected'}.`,
    data: { request_id: id }, dedupeKey: `approval:${id}:${decision}`,
  });
  return format(updated);
}

export async function cancel(actor, id, req) {
  const r = await complianceRepo.findApproval(id);
  if (!r) throw AppError.notFound('Request not found');
  if (r.requested_by !== actor.id) throw AppError.forbidden('Only the requester can cancel this request');
  const updated = await complianceRepo.updateApproval(id, { status: 'cancelled' }, 'pending');
  if (!updated) throw AppError.conflict('Only pending requests can be cancelled', 'NOT_PENDING');
  await auditService.record({ actorId: actor.id, action: 'approval.cancel', resourceType: 'sensitive_action_request', resourceId: id, req });
  return format(updated);
}

export function consumeApproval(requestId, action, targetId, executorId) {
  return complianceRepo.consumeApproval(requestId, action, targetId, executorId);
}

/** Execute an approved request. The database re-checks approval atomically. */
export async function execute(actor, id, req) {
  const r = await complianceRepo.findApproval(id);
  if (!r) throw AppError.notFound('Request not found');
  const def = ACTIONS[r.action];
  if (!can(actor, def.request) && !can(actor, def.approve)) throw AppError.forbidden();
  if (r.status !== 'approved') throw AppError.conflict('This request must be approved by a second person first', 'APPROVAL_REQUIRED');
  let result;
  switch (r.action) {
    case 'transaction_reversal':
      result = await complianceRepo.reverseTransaction(r.target_id, r.id, actor.id);
      if (result?.refund_transaction_id) {
        refundService.processRefund(result.refund_transaction_id).catch((err) => logger.error({ err: err.message }, 'reversal refund failed to start'));
      }
      notificationService.kickDispatcher();
      break;
    case 'transaction_adjustment':
      result = await complianceRepo.recordAdjustment(r.id, actor.id);
      break;
    case 'collector_revoke': {
      result = await complianceRepo.setCollectorStatus(r.target_id, 'revoked', actor.id, r.reason, r.id);
      const account = await collectorRepo.findAccount(r.target_id);
      if (account) {
        const { invalidateUserCache } = await import('./authService.js');
        invalidateUserCache(account.collector_id);
      }
      notificationService.kickDispatcher();
      break;
    }
    case 'risk_restriction_lift':
      result = await riskService.setStatus(actor, r.target_id, { status: r.payload?.status ?? 'normal', reason: r.reason, approvalRequestId: r.id }, req, { consumeApproval });
      break;
    case 'large_payout_confirm':
      throw AppError.badRequest('Confirm this payout from the payout queue using the approved request', 'USE_PAYOUT_CONFIRM');
    default:
      throw AppError.badRequest('Unknown action');
  }
  await auditService.record({ actorId: actor.id, action: `approval.execute.${r.action}`, resourceType: def.targetType, resourceId: r.target_id, metadata: { request_id: r.id }, req });
  return { request: format(await complianceRepo.findApproval(id)), result };
}

export async function list(filters) {
  const result = await complianceRepo.listApprovals(filters);
  return { items: result.rows.map(format), meta: pageMeta(filters, result.total) };
}

export async function get(id) {
  const r = await complianceRepo.findApproval(id);
  if (!r) throw AppError.notFound('Request not found');
  const subject = r.payload?.user_id ? await userRepo.findById(r.payload.user_id) : null;
  return { ...format(r), subject: subject ? { id: subject.id, name: subject.full_name } : null };
}
