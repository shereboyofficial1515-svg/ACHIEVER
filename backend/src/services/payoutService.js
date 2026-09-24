import { env } from '../config/env.js';
import { DISBURSEMENT_KINDS, REFERENCE_PREFIX } from '../config/constants.js';
import { paystack } from '../integrations/paystack/paystackClient.js';
import * as disbursementRepo from '../repositories/disbursementRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import * as riskRepo from '../repositories/riskRepository.js';
import * as notificationService from './notificationService.js';
import * as auditService from './auditService.js';
import * as riskService from './riskService.js';
import * as settingsService from './settingsService.js';
import * as complianceRepo from '../repositories/complianceRepository.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';

/**
 * STEP 4/5 — Payout instruction vs. actual movement of funds.
 *
 * SQL approves an instruction (osusu payout, saver return, commission). This
 * service performs the movement through the configured custody rail:
 *   - manual: a platform finance admin disburses and records the reference
 *   - paystack_transfer: Paystack Transfers from the merchant balance
 * A record is only marked paid on confirmation (webhook or admin).
 */
const REASONS = {
  osusu_payout: 'ACHIEVER Osusu payout',
  saver_return: 'ACHIEVER savings return',
  commission: 'ACHIEVER collector commission',
};

export function kindFromReference(reference = '') {
  if (reference.startsWith(`${REFERENCE_PREFIX.osusuPayout}-`)) return 'osusu_payout';
  if (reference.startsWith(`${REFERENCE_PREFIX.saverReturn}-`)) return 'saver_return';
  if (reference.startsWith(`${REFERENCE_PREFIX.commission}-`)) return 'commission';
  return null;
}

export async function execute(kind, id) {
  const item = await disbursementRepo.find(kind, id);
  if (!item || item.executionMode !== 'paystack_transfer' || !env.features.transfers) return { executed: false };
  const readyStatus = disbursementRepo.meta(kind).ready;
  if (item.status !== readyStatus || item.transferCode) return { executed: false };

  // Withdrawal security: held items are never sent automatically.
  const evaluation = await riskService.evaluateDisbursement(item);
  await riskService.recordEvaluation(kind, id, evaluation);
  if (evaluation.hold) {
    const account = evaluation.reasons.some((r) => r.code === 'no_payout_account');
    if (!account) return { executed: false, reason: 'HELD_FOR_REVIEW', holdReasons: evaluation.reasons };
  }

  const account = await userRepo.getPayoutAccount(item.userId);
  if (!account?.paystack_recipient_code) {
    await notificationService.notify(item.userId, {
      type: 'payout_account_required',
      category: 'payouts',
      title: 'Add a bank account to receive funds',
      body: 'A payout is ready for you. Add your bank account in Settings → Payment accounts so it can be sent.',
      dedupeKey: `payout_account_required:${kind}:${id}`,
    });
    return { executed: false, reason: 'NO_PAYOUT_ACCOUNT' };
  }

  try {
    const data = await paystack.initiateTransfer({
      amount: item.amount,
      recipientCode: account.paystack_recipient_code,
      reference: item.reference,
      reason: REASONS[kind],
    });
    const status = String(data.status || '').toLowerCase();
    if (status === 'success') {
      await disbursementRepo.complete(kind, id, data.transfer_code, null);
    } else if (status === 'failed' || status === 'reversed') {
      await disbursementRepo.fail(kind, id, `Transfer ${status}`, null);
    } else {
      // pending / otp / received — final state arrives by webhook
      await disbursementRepo.markProcessing(kind, id, data.transfer_code);
    }
    notificationService.kickDispatcher();
    return { executed: true, status };
  } catch (err) {
    if (err.providerStatus && err.providerStatus >= 400 && err.providerStatus < 500) {
      await disbursementRepo.fail(kind, id, err.message.slice(0, 300), null);
      notificationService.kickDispatcher();
    }
    logger.warn({ kind, id, err: err.message }, 'transfer initiation failed');
    return { executed: false, reason: err.code };
  }
}

export async function handleTransferEvent(event, data) {
  const kind = kindFromReference(data.reference);
  if (!kind) {
    logger.warn({ event }, 'transfer event with unknown reference');
    return;
  }
  const item = await disbursementRepo.findByReference(kind, data.reference);
  if (!item) {
    logger.warn({ event, kind }, 'transfer event for unknown disbursement');
    return;
  }
  if (event === 'transfer.success') {
    await disbursementRepo.complete(kind, item.id, data.transfer_code || data.reference, null);
  } else if (['paid', 'settled'].includes(item.status)) {
    // Reversal after completion: the ledger is final, so raise it for review instead.
    await riskRepo.insert({
      subject_user_id: item.userId,
      context: 'payments',
      reason_code: 'manual',
      severity: 'high',
      status: 'review_required',
      details: { event, kind, disbursement_id: item.id, reference: data.reference },
    });
  } else {
    await disbursementRepo.fail(kind, item.id, `Transfer ${event.split('.')[1]}`, null);
  }
  notificationService.kickDispatcher();
}

// Platform finance admin operations -------------------------------------------------
function assertKind(kind) {
  if (!DISBURSEMENT_KINDS.includes(kind)) throw AppError.badRequest('Unknown payout type');
}

export async function queue() {
  const result = {};
  for (const kind of DISBURSEMENT_KINDS) {
    const ready = disbursementRepo.meta(kind).ready;
    const items = await disbursementRepo.listByStatus(kind, [ready, 'processing', 'failed']);
    result[kind] = await Promise.all(
      items.map(async (i) => {
        const [profile, account] = await Promise.all([userRepo.findById(i.userId), userRepo.getPayoutAccount(i.userId)]);
        return {
          kind,
          id: i.id,
          status: i.status,
          reference: i.reference,
          amount: i.amount,
          holdReason: i.holdReason,
          evaluation: i.riskEvaluation,
          destinationSnapshot: i.destination,
          executionMode: i.executionMode,
          failureReason: i.failureReason,
          updatedAt: i.updatedAt,
          recipient: { id: i.userId, name: profile?.full_name, phone: profile?.phone },
          payoutAccount: account ? { bankName: account.bank_name, accountName: account.account_name, last4: account.account_last4 } : null,
        };
      }),
    );
  }
  return result;
}

export async function confirmManual(actor, kind, id, { externalReference, note, overrideReason, approvalRequestId }, req) {
  assertKind(kind);
  const item = await disbursementRepo.find(kind, id);
  if (!item) throw AppError.notFound('Payout not found');
  if (item.userId === actor.id) throw AppError.forbidden('You cannot confirm a payout to yourself', 'SELF_PAYOUT_FORBIDDEN');

  // Held items need an explicit, recorded override reason.
  const evaluation = await riskService.evaluateDisbursement(item);
  await riskService.recordEvaluation(kind, id, evaluation);
  if (evaluation.hold && !overrideReason) {
    throw new AppError(409, 'PAYOUT_HELD', `This payout is held for review: ${evaluation.reasons.map((r) => r.label).join('; ')}. Record an override reason to continue.`, { reasons: evaluation.reasons });
  }
  // Large payouts need a second authorised person (two-person rule).
  const largeThreshold = Number(await settingsService.get('finance.large_payout_threshold_kobo', 100_000_000));
  if (item.amount >= largeThreshold) {
    if (!approvalRequestId) {
      throw AppError.conflict('Payouts of this size need approval from a second authorised person first', 'APPROVAL_REQUIRED');
    }
    await complianceRepo.consumeApproval(approvalRequestId, 'large_payout_confirm', id, actor.id);
  }
  if (item.executionMode === 'paystack_transfer' && item.status === 'processing') {
    throw AppError.conflict('This transfer is in progress with Paystack; wait for its confirmation', 'TRANSFER_IN_PROGRESS');
  }
  const result = await disbursementRepo.complete(kind, id, externalReference, actor.id);
  await auditService.record({
    actorId: actor.id, action: 'disbursement.confirm_manual', resourceType: kind, resourceId: id,
    metadata: { externalReference, note, overrideReason: overrideReason ?? null, holdReasons: evaluation.hold ? evaluation.reasons.map((r) => r.code) : [], approvalRequestId: approvalRequestId ?? null },
    req,
  });
  notificationService.kickDispatcher();
  return result;
}

export async function markFailed(actor, kind, id, reason, req) {
  assertKind(kind);
  await disbursementRepo.fail(kind, id, reason, actor.id);
  await auditService.record({ actorId: actor.id, action: 'disbursement.mark_failed', resourceType: kind, resourceId: id, metadata: { reason }, req });
  notificationService.kickDispatcher();
}

export async function retry(actor, kind, id, req) {
  assertKind(kind);
  const item = await disbursementRepo.find(kind, id);
  if (item?.userId === actor.id) throw AppError.forbidden('You cannot retry a payout to yourself', 'SELF_PAYOUT_FORBIDDEN');
  const reference = await disbursementRepo.retry(kind, id, actor.id);
  await auditService.record({ actorId: actor.id, action: 'disbursement.retry', resourceType: kind, resourceId: id, req });
  const result = await execute(kind, id);
  return { reference, ...result };
}

/** Job: push approved transfers that have not been sent yet. */
export async function executeReady() {
  if (!env.features.transfers) return 0;
  let n = 0;
  for (const kind of DISBURSEMENT_KINDS) {
    const items = await disbursementRepo.listByStatus(kind, [disbursementRepo.meta(kind).ready], 25);
    for (const item of items) {
      if (item.executionMode === 'paystack_transfer' && !item.transferCode) {
        await execute(kind, item.id);
        n += 1;
      }
    }
  }
  return n;
}
