/**
 * Maps backend statuses to the badge vocabulary used across the UI:
 * Paid, Pending, Overdue, Completed, Failed, Processing, Under review.
 */
const MAP = {
  // contributions
  paid: ['Paid', 'success'],
  pending: ['Pending', 'warning'],
  overdue: ['Overdue', 'danger'],
  // transactions / attempts
  success: ['Successful', 'success'],
  processing: ['Processing', 'info'],
  failed: ['Failed', 'danger'],
  reversed: ['Reversed', 'neutral'],
  initialized: ['Awaiting payment', 'warning'],
  abandoned: ['Not completed', 'neutral'],
  amount_mismatch: ['Under review', 'danger'],
  duplicate: ['Refund due', 'warning'],
  // cycles
  upcoming: ['Upcoming', 'neutral'],
  open: ['Collecting', 'info'],
  funded: ['Fully funded', 'success'],
  payout_pending: ['Payout processing', 'info'],
  paid_out: ['Completed', 'success'],
  // payouts / returns
  scheduled: ['Scheduled', 'neutral'],
  approved: ['Approved', 'info'],
  requested: ['Requested', 'warning'],
  rejected: ['Declined', 'neutral'],
  accrued: ['Accrued', 'info'],
  settled: ['Settled', 'success'],
  // groups & plans
  recruiting: ['Recruiting', 'info'],
  active: ['Active', 'success'],
  completed: ['Completed', 'success'],
  cancelled: ['Cancelled', 'neutral'],
  matured: ['Matured', 'gold'],
  return_requested: ['Return requested', 'warning'],
  return_processing: ['Return processing', 'info'],
  returned: ['Returned', 'success'],
  // members
  pending_approval: ['Awaiting approval', 'warning'],
  removed: ['Removed', 'neutral'],
  left: ['Left', 'neutral'],
  good: ['Good standing', 'success'],
  payment_overdue: ['Payment overdue', 'danger'],
  review_required: ['Under review', 'danger'],
  risk_review: ['Under review', 'danger'],
  // bills
  awaiting_payment: ['Awaiting payment', 'warning'],
  delivered: ['Delivered', 'success'],
  refund_pending: ['Refund pending', 'warning'],
  refunded: ['Refunded', 'neutral'],
  // verification
  verified: ['Verified', 'success'],
  manual_review: ['Under review', 'warning'],
  // support
  in_progress: ['In progress', 'info'],
  awaiting_user: ['Awaiting your reply', 'warning'],
  resolved: ['Resolved', 'success'],
  closed: ['Closed', 'neutral'],
  dismissed: ['Dismissed', 'neutral'],
  // calls/meetings
  ringing: ['Ringing', 'info'],
  ended: ['Ended', 'neutral'],
  missed: ['Missed', 'danger'],
  // accounts
  pending_verification: ['Verification pending', 'warning'],
  suspended: ['Suspended', 'danger'],
};

export function statusMeta(status) {
  const hit = MAP[status];
  if (hit) return { label: hit[0], tone: hit[1] };
  return { label: String(status || 'Unknown').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), tone: 'neutral' };
}

export const TX_TYPE_LABEL = {
  osusu_contribution: 'Osusu contribution',
  osusu_payout: 'Osusu payout',
  collector_savings: 'Savings deposit',
  saver_return: 'Savings return',
  commission: 'Collector commission',
  refund: 'Refund',
  bill_payment: 'Bill payment',
};
