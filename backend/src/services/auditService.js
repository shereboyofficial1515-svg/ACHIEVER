import * as auditRepo from '../repositories/auditRepository.js';
import { logger } from '../utils/logger.js';

/**
 * Record a security- or finance-relevant action. Never throws: an audit write
 * failure is logged loudly but does not break the user's request (financial
 * functions write their own audit rows inside the same DB transaction).
 */
export async function record({ actorId = null, action, resourceType, resourceId = null, result = 'success', metadata = {}, req }) {
  const row = {
    actor_id: actorId,
    action,
    resource_type: resourceType,
    resource_id: resourceId ? String(resourceId) : null,
    result,
    metadata,
    ip_address: req?.ip || null,
    user_agent: req?.get?.('user-agent')?.slice(0, 300) || null,
  };
  try {
    const error = await auditRepo.insert(row);
    if (error) logger.error({ action, code: error.code }, 'audit insert failed');
  } catch (err) {
    logger.error({ action, err: err.message }, 'audit insert failed');
  }
}

export function list(filters) {
  return auditRepo.list(filters);
}
