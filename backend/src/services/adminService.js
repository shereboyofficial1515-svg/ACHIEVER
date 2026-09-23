import { ROLES, STAFF_ROLES } from '../config/constants.js';
import { rpc } from '../integrations/supabase/db.js';
import * as userRepo from '../repositories/userRepository.js';
import * as osusuRepo from '../repositories/osusuRepository.js';
import * as collectorRepo from '../repositories/collectorRepository.js';
import * as paymentRepo from '../repositories/paymentRepository.js';
import * as riskRepo from '../repositories/riskRepository.js';
import * as verificationRepo from '../repositories/verificationRepository.js';
import * as authService from './authService.js';
import * as auditService from './auditService.js';
import * as notificationService from './notificationService.js';
import * as osusuService from './osusuService.js';
import * as collectorService from './collectorService.js';
import { AppError } from '../utils/AppError.js';
import { pageMeta } from '../utils/pagination.js';

export function overview() {
  return rpc('platform_overview');
}

export async function listUsers(filters) {
  const result = await userRepo.search(filters);
  return {
    items: result.rows.map((u) => ({
      id: u.id,
      fullName: u.full_name,
      email: u.email,
      phone: u.phone,
      status: u.account_status,
      primaryAccountType: u.primary_account_type,
      emailVerified: Boolean(u.email_verified_at),
      phoneVerified: Boolean(u.phone_verified_at),
      roles: (u.user_roles || []).map((r) => r.role_code),
      lastSeenAt: u.last_seen_at,
      createdAt: u.created_at,
    })),
    meta: pageMeta(filters, result.total),
  };
}

export async function getUser(actor, id, req) {
  const profile = await userRepo.findById(id);
  if (!profile) throw AppError.notFound('User not found');
  const [identity, flags, memberships, plans] = await Promise.all([
    verificationRepo.latestForUser(id),
    riskRepo.openForUser(id),
    osusuRepo.listMemberships(id),
    collectorRepo.listPlans({ saverId: id, page: 1, pageSize: 50 }),
  ]);
  await auditService.record({ actorId: actor.id, action: 'admin.user.view', resourceType: 'profile', resourceId: id, req });
  return {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email,
    phone: profile.phone,
    address: profile.address,
    status: profile.account_status,
    statusReason: profile.status_reason,
    roles: (profile.user_roles || []).map((r) => r.role_code),
    emailVerified: Boolean(profile.email_verified_at),
    phoneVerified: Boolean(profile.phone_verified_at),
    lastLoginAt: profile.last_login_at,
    createdAt: profile.created_at,
    identity: identity ? { status: identity.status, idType: identity.id_type, last4: identity.id_last4 } : null,
    openRiskFlags: flags,
    groupMemberships: memberships.length,
    savingsPlans: plans.total,
  };
}

export async function setUserStatus(actor, id, { status, reason }, req) {
  if (id === actor.id) throw AppError.badRequest('You cannot change your own status');
  const profile = await userRepo.findById(id);
  if (!profile) throw AppError.notFound('User not found');
  const targetRoles = (profile.user_roles || []).map((r) => r.role_code);
  if (targetRoles.includes(ROLES.SUPER_ADMIN) && !actor.roles.includes(ROLES.SUPER_ADMIN)) throw AppError.forbidden();
  const patch = { account_status: status, status_reason: reason ?? null };
  if (status === 'suspended' || status === 'closed') patch.sessions_revoked_at = new Date().toISOString();
  await userRepo.update(id, patch);
  authService.invalidateUserCache(id);
  await auditService.record({ actorId: actor.id, action: 'admin.user.status', resourceType: 'profile', resourceId: id, metadata: { status, reason }, req });
  await notificationService.notify(id, {
    type: 'account_status', category: 'security', title: 'Account status changed',
    body: status === 'active' ? 'Your ACHIEVER account has been reactivated.' : `Your ACHIEVER account is now ${status}. Contact support for details.`,
    data: {}, dedupeKey: `status:${id}:${status}:${Date.now()}`,
  });
}

export async function grantRole(actor, id, role, req) {
  if (STAFF_ROLES.includes(role) && !actor.roles.includes(ROLES.SUPER_ADMIN)) {
    throw AppError.forbidden('Only a super admin can grant staff roles');
  }
  if (!(await userRepo.findById(id))) throw AppError.notFound('User not found');
  await userRepo.addRole(id, role, actor.id);
  authService.invalidateUserCache(id);
  await auditService.record({ actorId: actor.id, action: 'admin.role.grant', resourceType: 'profile', resourceId: id, metadata: { role }, req });
}

export async function revokeRole(actor, id, role, req) {
  if (STAFF_ROLES.includes(role) && !actor.roles.includes(ROLES.SUPER_ADMIN)) throw AppError.forbidden();
  if (id === actor.id && role === ROLES.SUPER_ADMIN) throw AppError.badRequest('You cannot remove your own super admin role');
  await userRepo.removeRole(id, role);
  authService.invalidateUserCache(id);
  await auditService.record({ actorId: actor.id, action: 'admin.role.revoke', resourceType: 'profile', resourceId: id, metadata: { role }, req });
}

export async function listGroups(filters) {
  const result = await osusuRepo.listAllGroupsForAdmin(filters);
  return {
    items: result.rows.map((g) => ({ ...osusuService.formatGroup(g), admin: { name: g.admin?.full_name, email: g.admin?.email } })),
    meta: pageMeta(filters, result.total),
  };
}

export async function listCollectors(filters) {
  const result = await collectorRepo.listAccountsForAdmin(filters);
  return {
    items: result.rows.map((a) => ({ ...collectorService.formatAccount(a), collector: { name: a.collector?.full_name, email: a.collector?.email } })),
    meta: pageMeta(filters, result.total),
  };
}

export async function setCollectorStatus(actor, accountId, status, reason, req) {
  const account = await collectorRepo.findAccount(accountId);
  if (!account) throw AppError.notFound('Collector account not found');
  await collectorRepo.updateAccount(accountId, { status });
  await auditService.record({ actorId: actor.id, action: 'admin.collector.status', resourceType: 'collector_account', resourceId: accountId, metadata: { status, reason }, req });
}

export async function listTransactions(filters) {
  const result = await paymentRepo.listTransactions({ ...filters, withUser: true });
  return { items: result.rows, meta: pageMeta(filters, result.total) };
}

export async function listPaymentAttempts(filters) {
  const result = await paymentRepo.listAttempts(filters);
  return { items: result.rows, meta: pageMeta(filters, result.total) };
}

export async function listRiskFlags(filters) {
  const result = await riskRepo.list(filters);
  return { items: result.rows, meta: pageMeta(filters, result.total) };
}

export async function updateRiskFlag(actor, id, { status, note }, req) {
  const flag = await riskRepo.find(id);
  if (!flag) throw AppError.notFound('Review case not found');
  const patch = { status, resolution_note: note ?? null };
  if (status === 'resolved' || status === 'dismissed') {
    patch.resolved_by = actor.id;
    patch.resolved_at = new Date().toISOString();
  }
  const updated = await riskRepo.update(id, patch);
  // Clearing a post-payout default review restores the member's standing.
  if (flag.reason_code === 'post_payout_default' && flag.group_id && ['resolved', 'dismissed'].includes(status)) {
    const m = await osusuRepo.findMembership(flag.group_id, flag.subject_user_id);
    if (m && m.risk_status === 'review_required') await osusuRepo.updateMember(m.id, { risk_status: 'good' });
  }
  await auditService.record({ actorId: actor.id, action: 'admin.risk.update', resourceType: 'risk_flag', resourceId: id, metadata: { status }, req });
  return updated;
}

/** In-app platform notice to all active users or everyone with a role. */
export async function broadcast(actor, { title, body, role }, req) {
  const recipients = role ? await userRepo.listByRole(role) : [];
  if (!role) {
    for (let from = 0; ; from += 1000) {
      const batch = await userRepo.listAllIds({ from, to: from + 999 });
      recipients.push(...batch);
      if (batch.length < 1000) break;
    }
  }
  const key = `broadcast:${Date.now()}`;
  for (const uid of recipients) {
    await notificationService.notify(uid, { type: 'platform_notice', category: 'system', title, body, data: {}, dedupeKey: `${key}:${uid}` });
  }
  await auditService.record({ actorId: actor.id, action: 'admin.broadcast', resourceType: 'notification', metadata: { title, role: role ?? 'all', recipients: recipients.length }, req });
  return { recipients: recipients.length };
}
