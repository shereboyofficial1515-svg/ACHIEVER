import * as securityRepo from '../repositories/securityRepository.js';
import { STAFF_ROLES } from '../config/constants.js';

/**
 * Role → permission mapping lives in the database (role_permissions) so that
 * least-privilege changes do not need a deploy. Cached briefly per instance.
 */
const TTL_MS = 60_000;
let cache = { map: null, until: 0 };

async function rolePermissionMap() {
  if (cache.map && cache.until > Date.now()) return cache.map;
  const rows = await securityRepo.listRolePermissions();
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.role_code)) map.set(r.role_code, new Set());
    map.get(r.role_code).add(r.permission_code);
  }
  cache = { map, until: Date.now() + TTL_MS };
  return map;
}

export function clearCache() {
  cache = { map: null, until: 0 };
}

export async function permissionsForRoles(roles = []) {
  if (!roles.some((r) => STAFF_ROLES.includes(r))) return [];
  const map = await rolePermissionMap();
  const out = new Set();
  for (const role of roles) for (const p of map.get(role) ?? []) out.add(p);
  return [...out].sort();
}

export function can(user, permission) {
  return Boolean(user?.permissions?.includes(permission));
}

export function canAny(user, permissions) {
  return permissions.some((p) => can(user, p));
}

/** Staff who may look into groups/plans to investigate (not every staff role). */
export const OVERSIGHT_PERMISSIONS = ['support.tickets', 'disputes.manage', 'finance.ledger.read', 'risk.review'];
export function canOversee(user) {
  return canAny(user, OVERSIGHT_PERMISSIONS);
}

export function isStaff(user) {
  return Boolean(user?.roles?.some((r) => STAFF_ROLES.includes(r)));
}
