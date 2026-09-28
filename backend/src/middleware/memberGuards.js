import { LIMITED_STATES } from '../config/constants.js';
import * as settingsService from '../services/settingsService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/http.js';

// Member API paths that keep working during maintenance (status page, sign-out, email links).
const MAINTENANCE_ALLOW = [/^\/status$/, /^\/reference\//, /^\/auth\/(csrf|logout|verification-methods|providers)$/];

/**
 * Maintenance mode applies to the member app only. The admin API is mounted
 * separately, so administrators are never locked out by it.
 */
export const maintenanceGate = asyncHandler(async (req, _res, next) => {
  if (!(await settingsService.maintenanceMode())) return next();
  if (MAINTENANCE_ALLOW.some((re) => re.test(req.path))) return next();
  throw AppError.unavailable('ACHIEVER is temporarily undergoing maintenance. Please try again soon.', 'MAINTENANCE_MODE');
});

const READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Restricted / verification-required accounts can sign in, read their data and
 * contact support, but cannot move money or change payout details.
 */
export function blockLimitedAccounts(req, _res, next) {
  if (READ_ONLY.has(req.method) || !LIMITED_STATES.includes(req.user?.status)) return next();
  const message = req.user.status === 'verification_required'
    ? 'Complete the requested verification before making payments or changes. Contact support if you need help.'
    : 'Payments, withdrawals and payout changes are paused on your account while a review is completed. Contact support for help.';
  return next(AppError.forbidden(message, req.user.status === 'verification_required' ? 'VERIFICATION_REQUIRED' : 'ACCOUNT_RESTRICTED'));
}
