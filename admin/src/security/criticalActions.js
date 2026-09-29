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
};

export function criticalAction(type) {
  const a = CRITICAL_ACTIONS[type];
  if (!a) throw new Error(`Unknown critical action: ${type}`);
  return a;
}
