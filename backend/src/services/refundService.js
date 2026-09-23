import { paystack } from '../integrations/paystack/paystackClient.js';
import * as paymentRepo from '../repositories/paymentRepository.js';
import * as notificationService from './notificationService.js';
import { logger } from '../utils/logger.js';

/**
 * Refunds for money that reached us but could not be applied (duplicate
 * payments, amount mismatches, failed bill deliveries). The ledger row is
 * created as 'pending' by SQL; this service asks Paystack to return the funds.
 */
export async function processRefund(refundTransactionId) {
  const tx = await paymentRepo.findTransaction(refundTransactionId);
  if (!tx || tx.type !== 'refund' || tx.status !== 'pending') return null;
  const paymentReference = tx.metadata?.payment_reference;
  if (!paymentReference) {
    logger.error({ refundTransactionId }, 'refund without payment reference');
    return null;
  }
  try {
    const refund = await paystack.createRefund({
      transactionReference: paymentReference,
      amount: Number(tx.amount),
      merchantNote: `ACHIEVER refund ${tx.reference}: ${tx.metadata?.reason || 'unapplied payment'}`,
    });
    await paymentRepo.setRefundStatus(tx.id, 'processing', refund?.id ? String(refund.id) : null);
    return refund;
  } catch (err) {
    // Stays 'pending'; the refund job will retry.
    logger.warn({ refundTransactionId, err: err.message }, 'refund request failed');
    return null;
  }
}

export async function handleRefundEvent(event, data) {
  const providerReference = data.id ? String(data.id) : null;
  const paymentReference = data.transaction_reference || data.transaction?.reference || null;
  let tx = providerReference ? await paymentRepo.findRefund({ providerReference }) : null;
  if (!tx && paymentReference) tx = await paymentRepo.findRefund({ paymentReference });
  if (!tx) {
    logger.warn({ event, providerReference }, 'refund event for unknown refund');
    return;
  }
  await paymentRepo.setRefundStatus(tx.id, event === 'refund.processed' ? 'success' : 'failed', providerReference);
  notificationService.kickDispatcher();
}

/** Job: retry refunds that could not be submitted. */
export async function retryPendingRefunds() {
  const rows = await paymentRepo.listPendingRefunds({ olderThan: new Date(Date.now() - 5 * 60 * 1000).toISOString() });
  for (const row of rows) await processRefund(row.id);
  return rows.length;
}
