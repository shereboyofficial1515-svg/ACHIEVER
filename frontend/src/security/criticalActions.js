/**
 * Critical-action matrix: every high-impact action in the member app and what
 * it requires. confirmAction({ type }) takes its default copy from here, so
 * wording and safeguards stay consistent. The server enforces the real checks
 * (password, security code, permissions, idempotency); this only makes sure
 * nothing high-impact happens on a single click.
 *
 * severity: info | warning | danger
 * steps: what follows the confirmation (shown in docs/tests, enforced server-side)
 */
export const CRITICAL_ACTIONS = {
  logout: {
    severity: 'warning',
    title: 'Log out of ACHIEVER?',
    message: 'You will need to sign in again to access your account.',
    confirmLabel: 'Log out',
    steps: ['confirm'],
  },
  change_password: {
    severity: 'warning',
    title: 'Change your password?',
    message: 'Changing your password may sign you out of other devices for security.',
    confirmLabel: 'Continue',
    steps: ['confirm', 'current_password', 'email_security_code', 'new_password'],
  },
  change_email: {
    severity: 'warning',
    title: 'Change your email address?',
    message: 'Changing your email will change where important ACHIEVER account and security notifications are delivered.',
    confirmLabel: 'Continue',
    steps: ['confirm', 'current_password', 'email_security_code', 'new_email_code'],
  },
  change_phone: {
    severity: 'warning',
    title: 'Change your phone number?',
    message: "You're about to change the phone number associated with your ACHIEVER account. This may affect account verification and security notifications.",
    confirmLabel: 'Continue',
    steps: ['confirm', 'current_password', 'email_security_code', 'new_phone_sms_or_email_fallback'],
  },
  change_payment_account: {
    severity: 'warning',
    title: 'Change your payout account?',
    message: 'Payouts and returns will be sent to the new account. For your protection, new accounts have a waiting period before they can receive money.',
    confirmLabel: 'Continue',
    steps: ['confirm', 'email_security_code', 'cooldown'],
  },
  payment: {
    severity: 'info',
    title: 'Review your payment',
    message: 'Check the details carefully. You will pay on Paystack’s secure page; your balance updates only after Paystack confirms the payment.',
    confirmLabel: 'Confirm payment',
    steps: ['review', 'confirm', 'server_initialise', 'provider_checkout', 'server_verification'],
  },
  withdrawal: {
    severity: 'warning',
    title: 'Please review your withdrawal details carefully',
    message: 'Money is sent to the payout account shown. It cannot be recalled once sent.',
    confirmLabel: 'Confirm withdrawal',
    steps: ['review', 'confirm', 'verification', 'server_authorisation'],
  },
  delete_account: {
    severity: 'danger',
    title: 'Delete your ACHIEVER account?',
    message: 'Deleting your ACHIEVER account will remove your access to the application. Some financial, transaction, audit, or legally required records may need to be retained.',
    confirmLabel: 'Continue to verification',
    requireText: 'DELETE',
    steps: ['warning', 'type_to_confirm', 'current_password', 'email_security_code', 'final_confirm', 'request'],
  },
  disable_security: {
    severity: 'danger',
    title: 'Turn off this protection?',
    message: 'Disabling this security feature may reduce the protection of your ACHIEVER account.',
    confirmLabel: 'Turn off',
    steps: ['confirm', 'current_password'],
  },
  sign_out_others: {
    severity: 'warning',
    title: 'Sign out all other devices?',
    message: 'Every other phone and browser signed in to your account will be signed out.',
    confirmLabel: 'Sign out others',
    steps: ['confirm'],
  },
  leave_group: {
    severity: 'warning',
    title: 'Leave this group?',
    message: 'You will stop receiving updates and cannot contribute unless you are invited again.',
    confirmLabel: 'Leave group',
    steps: ['confirm'],
  },
  delete_message: {
    severity: 'warning',
    title: 'Delete this message?',
    message: 'It will be removed for everyone in the conversation.',
    confirmLabel: 'Delete message',
    steps: ['confirm'],
  },
};

export function criticalAction(type) {
  const a = CRITICAL_ACTIONS[type];
  if (!a) throw new Error(`Unknown critical action: ${type}`);
  return a;
}
