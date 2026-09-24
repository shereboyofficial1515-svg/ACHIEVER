import { BUCKETS, ROLES } from '../config/constants.js';
import { can, canOversee } from './permissionService.js';
import * as collectorRepo from '../repositories/collectorRepository.js';
import * as complianceRepo from '../repositories/complianceRepository.js';
import * as userRepo from '../repositories/userRepository.js';
import * as authService from './authService.js';
import * as auditService from './auditService.js';
import * as messageService from './messageService.js';
import * as notificationService from './notificationService.js';
import * as paymentService from './paymentService.js';
import * as payoutService from './payoutService.js';
import * as settingsService from './settingsService.js';
import * as storageService from './storageService.js';
import { AppError } from '../utils/AppError.js';
import { calcCollectorCommission } from '../utils/money.js';
import { pageMeta } from '../utils/pagination.js';

const isStaff = (user) => canOversee(user);
const isFinanceStaff = (user) => can(user, 'finance.payouts.execute');

function lagosToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
}

function daysBetween(fromIso, toIso) {
  return Math.round((new Date(`${toIso}T00:00:00Z`) - new Date(`${fromIso}T00:00:00Z`)) / 86400000);
}

export function formatAccount(a) {
  if (!a) return null;
  return {
    id: a.id,
    collectorId: a.collector_id,
    businessName: a.business_name,
    description: a.description,
    operatingArea: a.operating_area,
    defaultCommissionType: a.default_commission_type,
    defaultCommissionValue: Number(a.default_commission_value),
    status: a.status,
    statusReason: ['restricted', 'suspended', 'revoked', 'rejected'].includes(a.status) ? a.status_reason ?? a.rejection_reason ?? null : null,
    approvedAt: a.approved_at ?? null,
    createdAt: a.created_at,
  };
}

export function formatPlan(p, viewerId) {
  const balance = Number(p.balance);
  const totalContributed = Number(p.total_contributed);
  const commission = calcCollectorCommission({
    type: p.commission_type,
    value: Number(p.commission_value),
    totalContributed,
    balance,
  });
  const today = lagosToday();
  return {
    id: p.id,
    planName: p.plan_name,
    collectorAccountId: p.collector_account_id,
    businessName: p.account?.business_name,
    collector: p.collector ? { id: p.collector.id, name: p.collector.full_name, avatarUrl: storageService.publicUrl(BUCKETS.avatars, p.collector.avatar_path) } : { id: p.collector_id },
    saver: p.saver ? { id: p.saver.id, name: p.saver.full_name, avatarUrl: storageService.publicUrl(BUCKETS.avatars, p.saver.avatar_path) } : { id: p.saver_id },
    frequency: p.frequency,
    expectedAmount: p.expected_amount ? Number(p.expected_amount) : null,
    startDate: p.start_date,
    endDate: p.end_date,
    daysRemaining: Math.max(0, daysBetween(today, p.end_date)),
    commissionType: p.commission_type,
    commissionValue: Number(p.commission_value),
    balance,
    totalContributed,
    totalReturned: Number(p.total_returned),
    estimatedCommission: commission,
    expectedReturn: balance - commission,
    status: p.status,
    maturedAt: p.matured_at,
    createdAt: p.created_at,
    viewerRole: viewerId === p.saver_id ? 'saver' : viewerId === p.collector_id ? 'collector' : 'staff',
  };
}

async function planAccess(user, planId) {
  const plan = await collectorRepo.findPlan(planId);
  if (!plan) throw AppError.notFound('Savings plan not found');
  const isSaver = plan.saver_id === user.id;
  const isCollector = plan.collector_id === user.id;
  if (!isSaver && !isCollector && !isStaff(user)) throw AppError.forbidden('You are not part of this savings plan');
  return { plan, isSaver, isCollector };
}

// Collector account --------------------------------------------------------------
export async function getMyAccount(user) {
  return formatAccount(await collectorRepo.findAccountByCollector(user.id));
}

export async function createAccount(user, input, req) {
  if (await collectorRepo.findAccountByCollector(user.id)) throw AppError.conflict('You already have a collector account', 'ACCOUNT_EXISTS');
  const account = await collectorRepo.insertAccount({
    collector_id: user.id,
    business_name: input.businessName,
    description: input.description ?? null,
    operating_area: input.operatingArea ?? null,
    default_commission_type: input.defaultCommissionType,
    default_commission_value: input.defaultCommissionValue,
  });
  await auditService.record({ actorId: user.id, action: 'collector.account.create', resourceType: 'collector_account', resourceId: account.id, req });
  await notificationService.notify(user.id, {
    type: 'collector_application', category: 'account', title: 'Collector application received',
    body: `Your collector account "${account.business_name}" is awaiting review. You can accept savers once it is approved.`,
    data: { collector_account_id: account.id }, dedupeKey: `collector_application:${account.id}`,
  });
  return formatAccount(account);
}

export async function updateAccount(user, patch, req) {
  const account = await collectorRepo.findAccountByCollector(user.id);
  if (!account) throw AppError.notFound('Create your collector account first');
  const row = {};
  if (patch.businessName !== undefined) row.business_name = patch.businessName;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.operatingArea !== undefined) row.operating_area = patch.operatingArea;
  // Defaults apply to NEW plans only; existing plans keep their agreed terms.
  if (patch.defaultCommissionType !== undefined) row.default_commission_type = patch.defaultCommissionType;
  if (patch.defaultCommissionValue !== undefined) row.default_commission_value = patch.defaultCommissionValue;
  const updated = await collectorRepo.updateAccount(account.id, row);
  await auditService.record({ actorId: user.id, action: 'collector.account.update', resourceType: 'collector_account', resourceId: account.id, metadata: { fields: Object.keys(row) }, req });
  return formatAccount(updated);
}

const COLLECTOR_STATUS_MESSAGES = {
  pending_review: 'Your collector application is awaiting review. You can accept savers once it is approved.',
  verified: 'Your collector application has been verified and is awaiting activation.',
  restricted: 'Your collector account is restricted while a review is completed. Existing savers are not affected.',
  suspended: 'Your collector account is suspended. Contact support for details.',
  revoked: 'Your collector permission has been revoked.',
  rejected: 'Your collector application was not approved. Contact support for details.',
};

/**
 * Collector trust information. Savers see safe aggregates (no balances,
 * amounts or complaint details); the collector and oversight staff see all.
 */
export async function trust(user, accountId) {
  const [account, stats] = await Promise.all([collectorRepo.findAccount(accountId), complianceRepo.collectorTrustStats(accountId)]);
  if (!account || !stats) throw AppError.notFound('Collector not found');
  const full = account.collector_id === user.id || isStaff(user);
  const base = {
    collectorAccountId: account.id,
    businessName: account.business_name,
    operatingArea: account.operating_area,
    status: stats.status,
    approvedAt: stats.approved_at,
    membersManaged: Number(stats.members_managed),
    overdueSettlements: Number(stats.overdue_settlements),
    openDisputes: Number(stats.open_disputes),
  };
  if (!full) return base;
  const history = await complianceRepo.collectorHistory(accountId);
  return {
    ...base,
    applicationDate: stats.application_date,
    plansTotal: Number(stats.plans_total),
    totalProcessed: Number(stats.total_processed),
    totalSettled: Number(stats.total_settled),
    outstandingSettlements: Number(stats.outstanding_settlements),
    complaints: Number(stats.complaints),
    suspensions: Number(stats.suspensions),
    statusHistory: history.map((h) => ({ from: h.from_status, to: h.to_status, reason: h.reason, by: h.actor?.full_name, at: h.created_at })),
  };
}

export async function requireActiveAccount(user) {
  const account = await collectorRepo.findAccountByCollector(user.id);
  if (!account) throw AppError.notFound('Create your collector account first', 'NO_COLLECTOR_ACCOUNT');
  if (account.status !== 'active') throw AppError.forbidden(COLLECTOR_STATUS_MESSAGES[account.status] ?? 'Your collector account is not active', 'COLLECTOR_NOT_ACTIVE');
  return account;
}

export async function dashboard(user) {
  const account = await collectorRepo.findAccountByCollector(user.id);
  if (!account) return { account: null };
  const { plans, commissions, pendingReturns } = await collectorRepo.collectorStats(user.id);
  const today = lagosToday();
  return {
    account: formatAccount(account),
    totalSavers: plans.length,
    totalHeld: plans.reduce((s, p) => s + Number(p.balance), 0),
    maturingSoon: plans.filter((p) => p.status === 'active' && daysBetween(today, p.end_date) <= 14).length,
    matured: plans.filter((p) => p.status === 'matured').length,
    commissionEarned: commissions.filter((c) => c.status === 'settled').reduce((s, c) => s + Number(c.amount), 0),
    commissionPending: commissions.filter((c) => ['accrued', 'processing'].includes(c.status)).reduce((s, c) => s + Number(c.amount), 0),
    pendingReturns,
  };
}

// Plans ------------------------------------------------------------------------------
export async function listSavers(user, filters) {
  const result = await collectorRepo.listPlans({ ...filters, collectorId: user.id });
  return { items: result.rows.map((p) => formatPlan(p, user.id)), meta: pageMeta(filters, result.total) };
}

export async function listMyPlans(user, filters) {
  const result = await collectorRepo.listPlans({ ...filters, saverId: user.id });
  return { items: result.rows.map((p) => formatPlan(p, user.id)), meta: pageMeta(filters, result.total) };
}

export async function getPlan(user, planId) {
  const { plan } = await planAccess(user, planId);
  const openReturn = await collectorRepo.findOpenReturn(planId);
  return {
    ...formatPlan(plan, user.id),
    openReturn: openReturn
      ? {
          id: openReturn.id,
          status: openReturn.status,
          grossAmount: Number(openReturn.gross_amount),
          commissionAmount: Number(openReturn.commission_amount),
          netAmount: Number(openReturn.net_amount),
          isEarly: openReturn.is_early,
          requestedAt: openReturn.requested_at,
          requestedBy: openReturn.requested_by,
        }
      : null,
    canContribute: plan.saver_id === user.id && plan.status === 'active' && plan.end_date >= lagosToday(),
  };
}

/** Called by inviteService when a saver accepts a collector's invitation. */
export async function createPlanFromInvite(user, invite, req) {
  const account = await collectorRepo.findAccount(invite.collector_account_id);
  if (!account || account.status !== 'active') throw AppError.conflict('This collector is not currently accepting savers', 'COLLECTOR_UNAVAILABLE');
  if (account.collector_id === user.id) throw AppError.badRequest('You cannot save with yourself');
  if (!user.roles.includes(ROLES.SAVER)) {
    await userRepo.addRole(user.id, ROLES.SAVER, user.id);
    authService.invalidateUserCache(user.id);
  }
  const t = invite.terms;
  const startDate = t.start_date < lagosToday() ? lagosToday() : t.start_date;
  if (t.end_date <= startDate) throw AppError.conflict('This invitation has expired terms. Ask the collector for a new invitation.', 'TERMS_EXPIRED');
  const plan = await collectorRepo.insertPlan({
    collector_account_id: account.id,
    collector_id: account.collector_id,
    saver_id: user.id,
    plan_name: t.plan_name,
    frequency: t.frequency,
    expected_amount: t.expected_amount ?? null,
    start_date: startDate,
    end_date: t.end_date,
    commission_type: t.commission_type,
    commission_value: t.commission_value,
  });
  const conv = await messageService.ensurePlanConversation(plan.id, account.collector_id, user.id, t.plan_name);
  await messageService.postSystemMessage(conv.id, `Savings plan "${t.plan_name}" started. Term ends ${t.end_date}.`);
  await notificationService.notify(account.collector_id, {
    type: 'collector_plan_started', category: 'account', title: 'New saver joined',
    body: `${user.fullName} accepted your savings invitation.`, data: { plan_id: plan.id }, dedupeKey: `plan_started:${plan.id}`,
  });
  await auditService.record({ actorId: user.id, action: 'collector.plan.create', resourceType: 'collector_saver', resourceId: plan.id, metadata: { collectorId: account.collector_id, terms: t }, req });
  return { planId: plan.id };
}

export async function listPlanContributions(user, planId, paging) {
  await planAccess(user, planId);
  const result = await collectorRepo.listPlanContributions(planId, paging);
  return {
    items: result.rows.map((c) => ({ id: c.id, amount: Number(c.amount), status: c.status, paidAt: c.paid_at, transactionId: c.transaction_id })),
    meta: pageMeta(paging, result.total),
  };
}

export async function contribute(user, { planId, amount }) {
  const { plan, isSaver } = await planAccess(user, planId);
  if (!isSaver) throw AppError.forbidden('Only the saver can contribute to this plan');
  if (plan.status !== 'active' || plan.end_date < lagosToday()) {
    throw AppError.conflict('This plan is no longer accepting contributions', 'PLAN_NOT_ACCEPTING');
  }
  const account = await collectorRepo.findAccount(plan.collector_account_id);
  if (!account || ['suspended', 'revoked'].includes(account.status)) {
    throw AppError.conflict('This collector cannot accept new contributions right now. Your existing balance is unaffected; contact support for help.', 'COLLECTOR_NOT_ACCEPTING');
  }
  return paymentService.initialize({ user, purpose: 'collector_savings', targetId: plan.id, amount, metadata: { plan_id: plan.id } });
}

export async function cancelPlan(user, planId, req) {
  const { plan } = await planAccess(user, planId);
  if (Number(plan.total_contributed) > 0 || plan.status !== 'active') {
    throw AppError.conflict('Plans with savings cannot be cancelled; request a return instead', 'CANNOT_CANCEL');
  }
  await collectorRepo.updatePlan(planId, { status: 'cancelled', closed_at: new Date().toISOString() });
  await auditService.record({ actorId: user.id, action: 'collector.plan.cancel', resourceType: 'collector_saver', resourceId: planId, req });
}

// Returns ---------------------------------------------------------------------------------
function formatReturn(r) {
  return {
    id: r.id,
    planId: r.collector_saver_id,
    planName: r.plan?.plan_name,
    saverName: r.saver?.full_name,
    grossAmount: Number(r.gross_amount),
    commissionAmount: Number(r.commission_amount),
    netAmount: Number(r.net_amount),
    isEarly: r.is_early,
    reason: r.reason,
    status: r.status,
    requestedAt: r.requested_at,
    approvedAt: r.approved_at,
    paidAt: r.paid_at,
    rejectionReason: r.rejection_reason,
    failureReason: r.failure_reason,
  };
}

export async function requestReturn(user, planId, reason, req) {
  await planAccess(user, planId);
  const result = await collectorRepo.requestReturn(planId, user.id, reason);
  await auditService.record({ actorId: user.id, action: 'collector.return.request.api', resourceType: 'collector_saver', resourceId: planId, req });
  notificationService.kickDispatcher();
  return result;
}

export async function listReturns(user, filters) {
  const scope = user.roles.includes(ROLES.COLLECTOR) && filters.as !== 'saver' ? { collectorId: user.id } : { saverId: user.id };
  const result = await collectorRepo.listReturns({ ...filters, ...scope });
  return { items: result.rows.map(formatReturn), meta: pageMeta(filters, result.total) };
}

export async function approveReturn(user, returnId, req) {
  const r = await collectorRepo.findReturn(returnId);
  if (!r) throw AppError.notFound('Return request not found');
  const asPlatformAdmin = r.collector_id !== user.id && isFinanceStaff(user);
  if (r.collector_id !== user.id && !asPlatformAdmin) throw AppError.forbidden();
  const mode = await settingsService.payoutMode();
  const result = await collectorRepo.approveReturn(returnId, user.id, mode, asPlatformAdmin);
  await auditService.record({ actorId: user.id, action: 'collector.return.approve.request', resourceType: 'collector_return', resourceId: returnId, metadata: { mode, asPlatformAdmin }, req });
  notificationService.kickDispatcher();
  if (mode === 'paystack_transfer') {
    await payoutService.execute('saver_return', returnId);
    if (result.commission_id) await payoutService.execute('commission', result.commission_id);
  }
  return result;
}

export async function rejectReturn(user, returnId, reason, req) {
  const r = await collectorRepo.findReturn(returnId);
  if (!r) throw AppError.notFound('Return request not found');
  const asPlatformAdmin = r.collector_id !== user.id && r.requested_by !== user.id && isFinanceStaff(user);
  if (r.collector_id !== user.id && r.requested_by !== user.id && !asPlatformAdmin) throw AppError.forbidden();
  await collectorRepo.rejectReturn(returnId, user.id, reason, asPlatformAdmin);
  await auditService.record({ actorId: user.id, action: 'collector.return.reject.request', resourceType: 'collector_return', resourceId: returnId, req });
  notificationService.kickDispatcher();
}

export async function listCommissions(user) {
  const rows = await collectorRepo.listCommissions(user.id);
  return rows.map((c) => ({ id: c.id, amount: Number(c.amount), status: c.status, planName: c.plan?.plan_name, settledAt: c.settled_at, createdAt: c.created_at }));
}

export { planAccess };
