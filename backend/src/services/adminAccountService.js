import { ROLES, STAFF_ROLES } from '../config/constants.js';
import * as adminRepo from '../repositories/adminRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import * as auditService from './auditService.js';
import * as securityService from './securityService.js';
import * as permissionService from './permissionService.js';
import * as adminAuthService from './adminAuthService.js';
import { sendEmail } from '../integrations/resend/resendClient.js';
import { templates } from '../integrations/resend/templates.js';
import { AppError } from '../utils/AppError.js';
import { pageMeta } from '../utils/pagination.js';

/**
 * Administrator management. An administrator is an existing, verified
 * ACHIEVER identity that is given an admin_accounts row plus one or more
 * staff roles. They must enrol an authenticator app at first sign-in.
 * Every change needs a reason, a fresh authenticator code (route level) and
 * is audited; nobody can change their own administrator access.
 */
const staffRolesOf = (profile) => (profile?.user_roles || []).map((r) => r.role_code).filter((r) => STAFF_ROLES.includes(r));

function assertRoles(roles, actor) {
  if (!roles.length) throw AppError.unprocessable('Choose at least one administrator role', 'ROLE_REQUIRED');
  const unknown = roles.filter((r) => !STAFF_ROLES.includes(r));
  if (unknown.length) throw AppError.unprocessable(`Not an administrator role: ${unknown.join(', ')}`, 'INVALID_ROLE');
  if (roles.includes(ROLES.SUPER_ADMIN) && !actor.roles.includes(ROLES.SUPER_ADMIN)) {
    throw AppError.forbidden('Only a super admin can grant super admin', 'SUPER_ADMIN_REQUIRED');
  }
}

async function activeSuperAdmins() {
  const { rows } = await adminRepo.listAccounts({ page: 1, pageSize: 100, status: 'active' });
  return rows.filter((a) => (a.profile?.user_roles || []).some((r) => r.role_code === ROLES.SUPER_ADMIN)).map((a) => a.user_id);
}

function notify(profile, event) {
  const t = templates.securityAlert({ name: profile.full_name, event });
  sendEmail({ to: profile.email, ...t }).catch(() => {});
}

export async function list({ page, pageSize, status }) {
  const { rows, total } = await adminRepo.listAccounts({ page, pageSize, status });
  const items = await Promise.all(rows.map(async (a) => {
    const [factor, sessions] = await Promise.all([
      adminRepo.activeFactor(a.user_id),
      adminRepo.listSessions({ userId: a.user_id, activeOnly: true, page: 1, pageSize: 1 }),
    ]);
    return {
      id: a.user_id,
      name: a.profile?.full_name,
      email: a.profile?.email,
      roles: (a.profile?.user_roles || []).map((r) => r.role_code).filter((r) => STAFF_ROLES.includes(r)),
      status: a.status,
      disabledReason: a.disabled_reason,
      createdAt: a.created_at,
      lastLoginAt: a.last_login_at,
      lockedUntil: a.locked_until && new Date(a.locked_until).getTime() > Date.now() ? a.locked_until : null,
      mfaEnrolled: Boolean(factor),
      activeSessions: sessions.total,
    };
  }));
  return { items, meta: pageMeta({ page, pageSize }, total) };
}

/** Give an existing verified account administrator access. */
export async function create(actor, { email, roles, reason }, req) {
  assertRoles(roles, actor);
  const profile = await userRepo.findByEmail(String(email).toLowerCase());
  if (!profile) throw AppError.notFound('No ACHIEVER account uses that email. The person must register and verify their email first.', 'ACCOUNT_NOT_FOUND');
  if (profile.id === actor.id) throw AppError.forbidden('You cannot change your own administrator access', 'SELF_CHANGE_FORBIDDEN');
  if (!profile.email_verified_at) throw AppError.unprocessable('That account has not verified its email address yet', 'EMAIL_NOT_VERIFIED');
  if (['suspended', 'closed'].includes(profile.account_status)) throw AppError.unprocessable('That account is not active', 'ACCOUNT_NOT_ACTIVE');
  const existing = await adminRepo.findAccount(profile.id);
  if (existing?.status === 'active') throw AppError.conflict('That person is already an administrator', 'ALREADY_ADMIN');

  if (existing) await adminRepo.updateAccount(profile.id, { status: 'active', disabled_at: null, disabled_by: null, disabled_reason: null, failed_login_count: 0, locked_until: null });
  else await adminRepo.insertAccount({ user_id: profile.id, created_by: actor.id });
  for (const role of roles) await userRepo.addRole(profile.id, role, actor.id);
  permissionService.clearCache();

  await securityService.recordEvent({ userId: profile.id, type: 'admin_action', severity: 'medium', source: 'admin', description: `Administrator access granted (${roles.join(', ')}).`, metadata: { actor_id: actor.id, reason } });
  await auditService.record({ actorId: actor.id, action: 'admin.admins.created', resourceType: 'admin_account', resourceId: profile.id, reason, permission: 'admins.manage', newState: { status: 'active', roles }, req });
  notify(profile, `You were given administrator access (${roles.join(', ')}). Sign in at the admin platform; you will set up an authenticator app at first sign-in.`);
  return { id: profile.id, roles };
}

export async function updateRoles(actor, userId, { roles, reason }, req) {
  if (userId === actor.id) throw AppError.forbidden('You cannot change your own administrator access', 'SELF_CHANGE_FORBIDDEN');
  assertRoles(roles, actor);
  const [profile, account] = await Promise.all([userRepo.findById(userId), adminRepo.findAccount(userId)]);
  if (!profile || !account) throw AppError.notFound('Administrator not found');
  const current = staffRolesOf(profile);
  if (current.includes(ROLES.SUPER_ADMIN) && !actor.roles.includes(ROLES.SUPER_ADMIN)) {
    throw AppError.forbidden('Only a super admin can change another super admin', 'SUPER_ADMIN_REQUIRED');
  }
  if (current.includes(ROLES.SUPER_ADMIN) && !roles.includes(ROLES.SUPER_ADMIN)) {
    const supers = await activeSuperAdmins();
    if (supers.filter((id) => id !== userId).length === 0) throw AppError.conflict('At least one active super admin must remain', 'LAST_SUPER_ADMIN');
  }
  const add = roles.filter((r) => !current.includes(r));
  const remove = current.filter((r) => !roles.includes(r));
  for (const role of add) await userRepo.addRole(userId, role, actor.id);
  for (const role of remove) await userRepo.removeRole(userId, role);
  permissionService.clearCache();
  adminAuthService.forgetSessions();

  await securityService.recordEvent({ userId, type: 'admin_action', severity: 'medium', source: 'admin', description: `Administrator roles changed to ${roles.join(', ')}.`, metadata: { actor_id: actor.id, reason, added: add, removed: remove } });
  await auditService.record({ actorId: actor.id, action: 'admin.admins.roles_changed', resourceType: 'admin_account', resourceId: userId, reason, permission: 'admins.manage', previousState: { roles: current }, newState: { roles }, req });
  notify(profile, `Your administrator roles were changed to: ${roles.join(', ')}.`);
  return { id: userId, roles };
}

export async function setStatus(actor, userId, { status, reason }, req) {
  if (userId === actor.id) throw AppError.forbidden('You cannot change your own administrator access', 'SELF_CHANGE_FORBIDDEN');
  const [profile, account] = await Promise.all([userRepo.findById(userId), adminRepo.findAccount(userId)]);
  if (!profile || !account) throw AppError.notFound('Administrator not found');
  if (account.status === status) throw AppError.conflict(`That administrator is already ${status}`, 'UNCHANGED');
  const roles = staffRolesOf(profile);
  if (status === 'disabled') {
    if (roles.includes(ROLES.SUPER_ADMIN)) {
      if (!actor.roles.includes(ROLES.SUPER_ADMIN)) throw AppError.forbidden('Only a super admin can disable a super admin', 'SUPER_ADMIN_REQUIRED');
      const supers = await activeSuperAdmins();
      if (supers.filter((id) => id !== userId).length === 0) throw AppError.conflict('At least one active super admin must remain', 'LAST_SUPER_ADMIN');
    }
    await adminRepo.updateAccount(userId, { status: 'disabled', disabled_at: new Date().toISOString(), disabled_by: actor.id, disabled_reason: reason });
    await adminRepo.endSessions(userId, 'account_disabled');
  } else {
    await adminRepo.updateAccount(userId, { status: 'active', disabled_at: null, disabled_by: null, disabled_reason: null, failed_login_count: 0, locked_until: null });
  }
  adminAuthService.forgetSessions();
  await securityService.recordEvent({ userId, type: 'admin_action', severity: 'high', source: 'admin', description: `Administrator access ${status === 'disabled' ? 'disabled' : 're-enabled'}.`, metadata: { actor_id: actor.id, reason } });
  await auditService.record({ actorId: actor.id, action: status === 'disabled' ? 'admin.admins.disabled' : 'admin.admins.enabled', resourceType: 'admin_account', resourceId: userId, reason, permission: 'admins.manage', previousState: { status: account.status }, newState: { status }, req });
  notify(profile, status === 'disabled' ? 'Your administrator access was disabled.' : 'Your administrator access was re-enabled.');
  return { id: userId, status };
}

/** Recovery when an administrator lost their authenticator and backup codes. */
export async function resetMfa(actor, userId, { reason }, req) {
  if (userId === actor.id) throw AppError.forbidden('Ask another administrator to reset your authenticator', 'SELF_CHANGE_FORBIDDEN');
  const [profile, account] = await Promise.all([userRepo.findById(userId), adminRepo.findAccount(userId)]);
  if (!profile || !account) throw AppError.notFound('Administrator not found');
  if (staffRolesOf(profile).includes(ROLES.SUPER_ADMIN) && !actor.roles.includes(ROLES.SUPER_ADMIN)) {
    throw AppError.forbidden('Only a super admin can reset a super admin\'s authenticator', 'SUPER_ADMIN_REQUIRED');
  }
  await adminRepo.revokeFactors(userId, 'reset_by_admin');
  await adminRepo.replaceBackupCodes(userId, []);
  await adminRepo.endSessions(userId, 'mfa_reset');
  await adminRepo.updateAccount(userId, { mfa_reset_at: new Date().toISOString() });
  adminAuthService.forgetSessions();
  await securityService.recordChange({ userId, type: 'mfa_changed', previous: 'authenticator app', next: 'reset by administrator', actorId: actor.id, reason, req });
  await securityService.recordEvent({ userId, type: 'admin_action', severity: 'high', source: 'admin', description: 'Administrator authenticator reset; a new one must be set up at next sign-in.', metadata: { actor_id: actor.id, reason } });
  await auditService.record({ actorId: actor.id, action: 'admin.admins.mfa_reset', resourceType: 'admin_account', resourceId: userId, reason, permission: 'admins.manage', req });
  notify(profile, 'Your admin authenticator app was reset by another administrator. You will set up a new one at your next sign-in. If you did not ask for this, contact your security team.');
  return { id: userId };
}
