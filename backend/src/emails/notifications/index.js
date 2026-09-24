import { renderEmail } from '../layouts/baseEmail.js';
import { payments } from '../payments/index.js';
import { osusu } from '../osusu/index.js';
import { collector } from '../collector/index.js';
import { support } from '../support/index.js';
import { security } from '../security/index.js';

/**
 * Registry: notification.type -> email template. Every value comes from the
 * notification row or the records it references; missing fields are omitted.
 *
 * ctx = { name, n: notification row, tx?, group?, plan?, contribution?, payout?, ret?, url?, unsubscribeUrl? }
 */
export const generic = (ctx) => renderEmail({
  subject: ctx.n.title,
  title: ctx.n.title,
  name: ctx.name,
  paragraphs: [ctx.n.body],
  cta: ctx.url ? { label: 'View in ACHIEVER', url: ctx.url } : undefined,
  category: ['system', 'marketing'].includes(ctx.n.category) ? 'marketing' : 'transactional',
  unsubscribeUrl: ctx.unsubscribeUrl,
});

/** notification.type → renderer */
export const BY_TYPE = {
  osusu_contribution_paid: payments.contributionReceived,
  payment_failed: payments.paymentFailed,
  payment_duplicate: payments.refund,
  payment_refund: payments.refund,
  refund_completed: payments.refund,
  transaction_reversed: payments.refund,
  bill_delivered: payments.billResult,
  bill_failed: payments.billResult,
  osusu_contribution_due: osusu.contributionReminder,
  osusu_cycle_open: osusu.contributionReminder,
  osusu_contribution_overdue: osusu.contributionOverdue,
  osusu_group_overdue: osusu.contributionOverdue,
  osusu_payout_approved: osusu.payoutNotification,
  osusu_payout_paid: osusu.payoutNotification,
  osusu_cycle_funded: osusu.groupUpdate,
  osusu_group_started: osusu.groupUpdate,
  osusu_group_completed: osusu.groupUpdate,
  osusu_group_cancelled: osusu.groupUpdate,
  osusu_member_approved: osusu.groupUpdate,
  osusu_member_removed: osusu.groupUpdate,
  collector_savings_paid: collector.savingsReceived,
  collector_savings_received: collector.savingsReceived,
  collector_plan_matured: collector.maturityNotification,
  collector_return_requested: collector.settlementNotification,
  collector_return_approved: collector.settlementNotification,
  collector_return_paid: collector.settlementNotification,
  collector_commission_paid: collector.settlementNotification,
  disbursement_failed: collector.settlementNotification,
  support_ticket_created: support.ticketCreated,
  support_reply: support.ticketUpdated,
  support_resolved: support.ticketUpdated,
  dispute_opened: support.ticketUpdated,
  new_device_sign_in: security.alert,
  payout_account_changed: security.alert,
  account_status: security.alert,
  account_review: security.accountNotice,
  kyc_status: security.accountNotice,
  collector_status_changed: security.accountNotice,
};
