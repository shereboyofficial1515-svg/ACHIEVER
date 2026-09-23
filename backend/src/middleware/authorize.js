import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/http.js';
import * as onboardingService from '../services/onboardingService.js';

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
