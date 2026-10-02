/**
 * Admin critical-action matrix (same confirmation system as the member app).
 * Server-side, sensitive admin actions additionally require a permission, a
 * reason and a fresh authenticator code, and every one is audited.
 */
export const CRITICAL_ACTIONS = {
  logout: { severity: 'warning', title: 'Sign out of the admin platform?', message: 'You will need your password and authenticator code to sign in again.', confirmLabel: 'Sign out' },
  logout_all: { severity: 'warning', title: 'Sign out everywhere?', message: 'Every admin session for your account ends, including this one.', confirmLabel: 'Sign out everywhere' },
  end_admin_session: { severity: 'danger', title: 'End this administrator session?', message: 'The administrator is signed out immediately. This is recorded in the audit log.', confirmLabel: 'End session' },
  end_own_session: { severity: 'warning', title: 'Sign out this device?', message: 'That device will need to sign in again.', confirmLabel: 'Sign out device' },
  reward_start_review: { severity: 'info', title: 'Start reviewing this reward?', message: 'The referrer will see the reward as “Under review”. Your name and reason are recorded.', confirmLabel: 'Start review' },
  reward_approve: { severity: 'warning', title: 'Approve this referral reward?', message: 'Check every referral is genuine and qualified. A different administrator must record the payment. Your approval and reason are recorded in the audit log.', confirmLabel: 'Approve reward' },
  reward_reject: { severity: 'danger', title: 'Reject this referral reward?', message: 'The referrer will see that the reward was not approved. Give a clear reason; it is recorded.', confirmLabel: 'Reject reward' },
  wallet_freeze: { severity: 'danger', title: 'Place this wallet on hold?', message: 'The member cannot send or spend from the wallet until the hold is released. They are notified. Your reason is recorded.', confirmLabel: 'Place on hold' },
  wallet_unfreeze: { severity: 'warning', title: 'Release the hold on this wallet?', message: 'The member can use the wallet again. Your reason is recorded.', confirmLabel: 'Release hold' },
  wallet_adjust_request: { severity: 'warning', title: 'Request this wallet adjustment?', message: 'Nothing is posted until a different administrator approves it. The request and your reason are recorded.', confirmLabel: 'Request adjustment' },
  wallet_adjust_approve: { severity: 'danger', title: 'Approve and post this adjustment?', message: 'It is posted to the ledger immediately and cannot be edited. A correction would need another adjustment.', confirmLabel: 'Approve and post' },
  wallet_adjust_reject: { severity: 'warning', title: 'Reject this adjustment?', message: 'Nothing is posted. Your reason is recorded.', confirmLabel: 'Reject' },
  wallet_transfer_approve: { severity: 'danger', title: 'Approve this transfer?', message: 'The held money moves to the recipient immediately. Check the sender has confirmed it.', confirmLabel: 'Approve transfer' },
  wallet_transfer_reject: { severity: 'warning', title: 'Reject this transfer?', message: 'The hold is released and the money is available to the sender again. They are notified.', confirmLabel: 'Reject transfer' },
  reward_pay_wallet: { severity: 'danger', title: 'Pay this reward into the member’s ACHIEVER Wallet?', message: 'The reward is credited to their wallet immediately through the ledger and marked as paid. A different administrator from the approver must do this.', confirmLabel: 'Pay into wallet' },
  reward_mark_paid: { severity: 'danger', title: 'Record this reward as paid?', message: 'Only confirm after the money has actually been sent. Enter the bank/transfer reference. This cannot be undone except by a recorded reversal.', confirmLabel: 'Record payment' },
  reward_reverse: { severity: 'danger', title: 'Reverse this paid reward?', message: 'Use only when a payment failed or was recovered. The reversal and reason are recorded.', confirmLabel: 'Reverse reward' },
  referral_flag: { severity: 'warning', title: 'Record this review decision?', message: 'A flag is not proof of wrongdoing. Your decision and reason are recorded and affect whether the referral counts.', confirmLabel: 'Record decision' },
  bill_service_toggle: { severity: 'warning', title: 'Change this bill service?', message: 'Switching a service off stops new purchases immediately; purchases already paid are still delivered or refunded.', confirmLabel: 'Change service' },
  bill_reconcile: { severity: 'info', title: 'Check this transaction with VTpass?', message: 'ACHIEVER will requery VTpass. A final record is never overwritten; mismatches are flagged for review.', confirmLabel: 'Requery VTpass' },
};

export function criticalAction(type) {
  const a = CRITICAL_ACTIONS[type];
  if (!a) throw new Error(`Unknown critical action: ${type}`);
  return a;
}
