import { ROLES, STAFF_ROLES } from '../config/constants.js';
import { rpc } from '../integrations/supabase/db.js';
import * as userRepo from '../repositories/userRepository.js';
import * as osusuRepo from '../repositories/osusuRepository.js';
import * as collectorRepo from '../repositories/collectorRepository.js';
import * as paymentRepo from '../repositories/paymentRepository.js';
import * as riskRepo from '../repositories/riskRepository.js';
import * as verificationRepo from '../repositories/verificationRepository.js';
import * as adminRepo from '../repositories/adminRepository.js';
import * as authService from './authService.js';
import * as auditService from './auditService.js';
import * as notificationService from './notificationService.js';
import * as osusuService from './osusuService.js';
import * as collectorService from './collectorService.js';
import * as complianceRepo from '../repositories/complianceRepository.js';
import * as securityService from './securityService.js';
import * as sessionService from './sessionService.js';
import * as kycService from './kycService.js';
import * as riskService from './riskService.js';
import { can } from './permissionService.js';
import { maskEmail, maskPhone } from '../utils/sanitize.js';
import { AppError } from '../utils/AppError.js';
import { pageMeta } from '../utils/pagination.js';

/** Operations dashboard: aggregate counts only (computed in SQL, no row transfer). */
export async function dashboard() {
  const [metrics, overviewData] = await Promise.all([adminRepo.dashboardMetrics(), rpc('platform_overview')]);
  return { metrics, overview: overviewData };
}

export function overview() {
  return rpc('platform_overview');
}

export async function listUsers(actor, filters) {
  const result = await userRepo.search(filters);
  // Contact details are masked unless the viewer may read sensitive profile data.
  const full = can(actor, 'users.read_sensitive');
  return {
    items: result.rows.map((u) => ({
      id: u.id,
      fullName: u.full_name,
      email: full ? u.email : maskEmail(u.email),
      phone: full ? u.phone : maskPhone(u.phone),
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
  const [identity, flags, memberships, plans, kyc, riskStatus] = await Promise.all([
    verificationRepo.latestForUser(id),
    riskRepo.openForUser(id),
    osusuRepo.listMemberships(id),
    collectorRepo.listPlans({ saverId: id, page: 1, pageSize: 50 }),
    kycService.levelOf(id),
    riskService.statusOf(id),
  ]);
  await auditService.record({ actorId: actor.id, action: 'admin.user.view', resourceType: 'profile', resourceId: id, req });
  return {
    id: profile.id,
    fullName: profile.full_name,
    email: maskEmail(profile.email),
    phone: maskPhone(profile.phone),
    status: profile.account_status,
    statusReason: profile.status_reason,
    deactivatedAt: profile.deactivated_at,
    roles: (profile.user_roles || []).map((r) => r.role_code),
    emailVerified: Boolean(profile.email_verified_at),
    phoneVerified: Boolean(profile.phone_verified_at),
    lastLoginAt: profile.last_login_at,
    createdAt: profile.created_at,
    kyc,
    riskStatus,
    identity: identity ? { status: identity.status, idType: identity.id_type, last4: identity.id_last4, expiryDate: identity.expiry_date } : null,
    openRiskFlags: flags,
    groupMemberships: memberships.length,
    savingsPlans: plans.total,
    canViewSensitive: can(actor, 'users.read_sensitive'),
  };
}

/** Private profile data. Requires a reason, which is written to the data access log first. */
export async function getUserSensitive(actor, id, reason, req) {
  const profile = await userRepo.findWithLocation(id);
  if (!profile) throw AppError.notFound('User not found');
  const fields = ['email', 'phone', 'date_of_birth', 'address', 'state', 'lga', 'city', 'gender', 'nationality'];
  await securityService.logDataAccess({ actor, subjectUserId: id, resourceType: 'profile', resourceId: id, fields, reason, req });
  await auditService.record({ actorId: actor.id, action: 'admin.user.view_sensitive', resourceType: 'profile', resourceId: id, metadata: { reason }, req });
  return {
    id: profile.id,
    firstName: profile.first_name,
    middleName: profile.middle_name,
    lastName: profile.last_name,
    email: profile.email,
    phone: profile.phone,
    dateOfBirth: profile.date_of_birth,
    gender: profile.gender,
    nationality: profile.nationality,
    occupation: profile.occupation,
    address: profile.address,
    addressUnit: profile.address_unit,
    city: profile.city,
    state: profile.state?.name ?? null,
    lga: profile.lga?.name ?? null,
    postalCode: profile.postal_code,
    addressVerification: profile.address_verification_status,
  };
}

export async function userSecurity(actor, id, req) {
  const [sessions, changes, events] = await Promise.all([
    sessionService.list({ id, sessionId: null }),
    securityService.accountChanges(id),
    securityService.listEvents({ userId: id, page: 1, pageSize: 50 }),
  ]);
  await auditService.record({ actorId: actor.id, action: 'admin.user.security_view', resourceType: 'profile', resourceId: id, req });
  return { sessions, accountChanges: changes, securityEvents: events.items };
}

const STATUS_LABELS = {
  active: 'active', pending_verification: 'pending verification', verification_required: 'verification required',
  restricted: 'restricted', suspended: 'suspended', closed: 'deactivated',
};
const STATUS_MESSAGES = {
  active: 'Your ACHIEVER account is active again.',
  restricted: 'Payments, withdrawals and payout changes are paused on your ACHIEVER account while a review is completed. You can still sign in and contact support.',
  verification_required: 'Please complete the requested verification to continue using payments on your ACHIEVER account.',
  suspended: 'Your ACHIEVER account has been suspended. Contact support for details.',
  closed: 'Your ACHIEVER account has been deactivated. Contact support for details.',
};

/**
 * Explicit account states. Every change has a reason, an actor, a timestamp,
 * an optional time limit, a history row and an audit record; suspension and
 * deactivation also sign the person out everywhere.
 */
export async function setUserStatus(actor, id, { status, reason, expiresAt = null }, req) {
  if (id === actor.id) throw AppError.badRequest('You cannot change your own status');
  const profile = await userRepo.findById(id);
  if (!profile) throw AppError.notFound('User not found');
  const targetRoles = (profile.user_roles || []).map((r) => r.role_code);
  if (targetRoles.some((r) => STAFF_ROLES.includes(r)) && !can(actor, 'admins.manage')) {
    throw AppError.forbidden('Only an administrator manager can change the status of a staff account');
  }
  if (profile.account_status === status) throw AppError.conflict(`The account is already ${STATUS_LABELS[status]}`, 'UNCHANGED');
  if (expiresAt) {
    if (!['restricted', 'suspended', 'verification_required'].includes(status)) {
      throw AppError.unprocessable('Only restrictions, suspensions and verification requests can have an end date', 'INVALID_EXPIRY');
    }
    const t = new Date(expiresAt).getTime();
    if (!(t > Date.now() + 60_000) || t > Date.now() + 366 * 24 * 3600_000) throw AppError.unprocessable('Choose an end date within the next year', 'INVALID_EXPIRY');
  }
  const now = new Date().toISOString();
  const patch = {
    account_status: status, status_reason: reason, status_changed_at: now, status_changed_by: actor.id,
    status_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
  };
  if (status === 'suspended' || status === 'closed') patch.sessions_revoked_at = now;
  if (status === 'active' && profile.deactivated_at) {
    patch.deactivated_at = null;
    patch.deactivation_reason = null;
  }
  await userRepo.update(id, patch);
  await adminRepo.insertStatusHistory({
    user_id: id, previous_status: profile.account_status, new_status: status, reason, actor_id: actor.id,
    expires_at: patch.status_expires_at, request_id: req?.id ?? null, admin_session_id: req?.adminSession?.id ?? null,
  });
  if (status === 'suspended' || status === 'closed') await sessionService.revokeAll(id, `account_${status}`);
  await securityService.recordEvent({
    userId: id, type: 'admin_action', severity: status === 'active' ? 'low' : 'medium', source: 'admin',
    description: `Account status set to ${STATUS_LABELS[status]} by staff.`, metadata: { actor_id: actor.id, reason, expires_at: patch.status_expires_at },
  });
  authService.invalidateUserCache(id);
  await auditService.record({
    actorId: actor.id, action: `admin.user.status.${status}`, resourceType: 'profile', resourceId: id, reason,
    previousState: { status: profile.account_status }, newState: { status, expiresAt: patch.status_expires_at }, req,
  });
  await notificationService.notify(id, {
    type: 'account_status', category: 'security', title: 'Account status changed',
    body: STATUS_MESSAGES[status] ?? `Your ACHIEVER account is now ${STATUS_LABELS[status]}.`,
    data: {}, dedupeKey: `status:${id}:${status}:${Date.now()}`,
  });
  return { id, status, expiresAt: patch.status_expires_at };
}

/** Job: time-limited restrictions/suspensions end automatically (recorded like any other change). */
export async function expireTimedStatuses() {
  const rows = await adminRepo.expiredStatuses(new Date().toISOString());
  for (const p of rows) {
    await userRepo.update(p.id, { account_status: 'active', status_reason: null, status_changed_at: new Date().toISOString(), status_changed_by: null, status_expires_at: null });
    await adminRepo.insertStatusHistory({ user_id: p.id, previous_status: p.account_status, new_status: 'active', reason: 'The time limit set for this status ended.' });
    await auditService.record({ action: 'admin.user.status.expired', resourceType: 'profile', resourceId: p.id, previousState: { status: p.account_status }, newState: { status: 'active' } });
    authService.invalidateUserCache(p.id);
    await notificationService.notify(p.id, {
      type: 'account_status', category: 'security', title: 'Account status changed', body: STATUS_MESSAGES.active, data: {}, dedupeKey: `status-expired:${p.id}:${p.status_expires_at}`,
    });
  }
  return rows.length;
}

export async function statusHistory(id) {
  return adminRepo.statusHistory(id);
}

export async function grantRole(actor, id, role, req) {
  if (STAFF_ROLES.includes(role)) throw AppError.unprocessable('Administrator roles are managed under Administrators', 'USE_ADMIN_MANAGEMENT');
  if (STAFF_ROLES.includes(role) && !can(actor, 'roles.manage')) {
    throw AppError.forbidden('Only a super admin can grant staff roles');
  }
  if (id === actor.id && STAFF_ROLES.includes(role)) throw AppError.forbidden('You cannot grant yourself a staff role', 'SELF_GRANT_FORBIDDEN');
  if (!(await userRepo.findById(id))) throw AppError.notFound('User not found');
  await userRepo.addRole(id, role, actor.id);
  if (STAFF_ROLES.includes(role)) {
    await securityService.recordEvent({ userId: id, type: 'admin_action', severity: 'medium', source: 'admin', description: `Staff role ${role} granted.`, metadata: { actor_id: actor.id, role } });
  }
  authService.invalidateUserCache(id);
  await auditService.record({ actorId: actor.id, action: 'admin.role.grant', resourceType: 'profile', resourceId: id, metadata: { role }, req });
}

export async function revokeRole(actor, id, role, req) {
  if (STAFF_ROLES.includes(role)) throw AppError.unprocessable('Administrator roles are managed under Administrators', 'USE_ADMIN_MANAGEMENT');
  if (STAFF_ROLES.includes(role) && !can(actor, 'roles.manage')) throw AppError.forbidden();
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

/**
 * Collector onboarding & status. Revocation is not possible here: it needs a
 * two-person approval (sensitive action "collector_revoke").
 */
const COLLECTOR_TRANSITIONS = {
  verified: { permission: 'collectors.review', from: ['pending_review'] },
  rejected: { permission: 'collectors.review', from: ['pending_review', 'verified'] },
  active: { permission: 'collectors.review', from: ['pending_review', 'verified', 'restricted', 'suspended'] },
  restricted: { permission: 'collectors.status', from: ['active'] },
  suspended: { permission: 'collectors.status', from: ['active', 'restricted'] },
};

export async function setCollectorStatus(actor, accountId, status, reason, req) {
  const account = await collectorRepo.findAccount(accountId);
  if (!account) throw AppError.notFound('Collector account not found');
  if (account.collector_id === actor.id) throw AppError.forbidden('You cannot review your own collector account', 'SELF_REVIEW_FORBIDDEN');
  const rule = COLLECTOR_TRANSITIONS[status];
  if (!rule) throw AppError.badRequest('Use a revocation request to revoke a collector', 'APPROVAL_REQUIRED');
  // Reinstating a restricted/suspended collector is a status decision, not an application review.
  const permission = status === 'active' && ['restricted', 'suspended'].includes(account.status) ? 'collectors.status' : rule.permission;
  if (!can(actor, permission)) throw AppError.forbidden('You do not have permission to perform this action', 'PERMISSION_DENIED');
  if (!rule.from.includes(account.status)) {
    throw AppError.conflict(`A collector that is ${account.status.replace('_', ' ')} cannot be set to ${status}`, 'INVALID_TRANSITION');
  }
  if (status === 'active' && ['pending_review', 'verified'].includes(account.status)) {
    const { level } = await kycService.levelOf(account.collector_id);
    const levels = await kycService.requiredLevels();
    if (level < Number(levels.operator ?? 2)) {
      throw AppError.conflict(`The applicant must reach verification level ${levels.operator ?? 2} before approval`, 'KYC_LEVEL_REQUIRED');
    }
  }
  const result = await complianceRepo.setCollectorStatus(accountId, status, actor.id, reason);
  await auditService.record({ actorId: actor.id, action: 'admin.collector.status', resourceType: 'collector_account', resourceId: accountId, metadata: { status, reason }, req });
  authService.invalidateUserCache(account.collector_id);
  notificationService.kickDispatcher();
  return result;
}

export async function collectorDetail(actor, accountId) {
  return collectorService.trust(actor, accountId);
}

export async function complianceOverview() {
  return complianceRepo.complianceOverview();
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
