import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/http.js';
import * as onboardingService from '../services/onboardingService.js';
import * as sessionService from '../services/sessionService.js';
import { canAny, isStaff } from '../services/permissionService.js';

export function hasAnyRole(user, roles) {
  return roles.some((r) => user?.roles?.includes(r));
}

/** Role gate. Roles come from the database via authenticate(). */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!hasAnyRole(req.user, roles)) return next(AppError.forbidden());
    return next();
  };
}

/** Any platform staff role (fine-grained checks follow with requirePermission). */
export function requireStaff(req, _res, next) {
  if (!isStaff(req.user)) return next(AppError.forbidden());
  return next();
}

/** Permission gate (least privilege): passes when the user holds ANY of the permissions. */
export function requirePermission(...permissions) {
  return (req, _res, next) => {
    if (!canAny(req.user, permissions)) {
      return next(AppError.forbidden('You do not have permission to perform this action', 'PERMISSION_DENIED'));
    }
    return next();
  };
}

/**
 * Sensitive staff actions require a recent re-authentication (step-up) on the
 * current session, in addition to the permission itself.
 */
export const requireStepUp = asyncHandler(async (req, _res, next) => {
  if (!(await sessionService.hasRecentStepUp(req.user))) {
    throw AppError.forbidden('Confirm your password to continue with this sensitive action', 'STEP_UP_REQUIRED');
  }
  next();
});

/**
 * Operators (Osusu organisers, collectors) handle other people's money and
 * must complete phone verification, identity verification and the signed
 * undertaking before they can create groups or savings relationships.
 */
export function requireActiveOperator(role) {
  return asyncHandler(async (req, _res, next) => {
    if (!req.user.roles.includes(role)) throw AppError.forbidden();
    const active = await onboardingService.isOperatorActive(req.user.id, role);
    if (!active) {
      throw AppError.forbidden(
        'Complete phone verification, identity verification and the operator undertaking first',
        'OPERATOR_ONBOARDING_INCOMPLETE',
      );
    }
    next();
  });
}
