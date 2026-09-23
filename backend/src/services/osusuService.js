import { BUCKETS, ROLES, STAFF_ROLES } from '../config/constants.js';
import * as osusuRepo from '../repositories/osusuRepository.js';
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
import { randomCode } from '../utils/crypto.js';
import { pageMeta } from '../utils/pagination.js';

const isStaff = (user) => user.roles.some((r) => STAFF_ROLES.includes(r));

function formatGroup(g) {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    imageUrl: storageService.publicUrl(BUCKETS.groupImages, g.image_path),
    adminId: g.admin_id,
    admin: g.admin ? { id: g.admin.id, name: g.admin.full_name } : undefined,
    contributionAmount: Number(g.contribution_amount),
    currency: g.currency,
    frequency: g.frequency,
    maxMembers: g.max_members,
    startDate: g.start_date,
    gracePeriodDays: g.grace_period_days,
    payoutOrderMethod: g.payout_order_method,
    requiresApproval: g.requires_approval,
    meetingSchedule: g.meeting_schedule,
    status: g.status,
    currentCycle: g.current_cycle,
    totalCycles: g.total_cycles,
    startedAt: g.started_at,
    completedAt: g.completed_at,
    createdAt: g.created_at,
  };
}

/** Loads a group and the caller's relationship to it; throws if unrelated. */
async function access(user, groupId, { adminOnly = false, allowPending = false } = {}) {
  const group = await osusuRepo.findGroup(groupId);
  if (!group) throw AppError.notFound('Group not found');
  const isAdmin = group.admin_id === user.id;
  const membership = await osusuRepo.findMembership(groupId, user.id);
  const activeMember = membership?.status === 'active';
  const pendingMember = membership?.status === 'pending_approval';
  const staff = isStaff(user);
  if (adminOnly && !isAdmin) throw AppError.forbidden('Only the group organiser can do this');
  if (!isAdmin && !activeMember && !staff && !(allowPending && pendingMember)) {
    throw AppError.forbidden('You are not a member of this group');
  }
  return { group, isAdmin, membership, staff };
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------
export async function createGroup(user, input, req) {
  let group;
  for (let i = 0; i < 5 && !group; i += 1) {
    try {
      group = await osusuRepo.insertGroup({
        name: input.name,
        description: input.description ?? null,
        admin_id: user.id,
        contribution_amount: input.contributionAmount,
        frequency: input.frequency,
        max_members: input.maxMembers,
        start_date: input.startDate,
        grace_period_days: input.gracePeriodDays,
        payout_order_method: input.payoutOrderMethod,
        requires_approval: input.requiresApproval,
        meeting_schedule: input.meetingSchedule ?? null,
        join_code: randomCode(8),
      });
    } catch (err) {
      if (err.code !== 'DUPLICATE') throw err; // join code collision → retry
    }
  }
  if (!group) throw AppError.unavailable('Could not create the group. Please try again.');

  if (input.adminParticipates) {
    await osusuRepo.insertMember({ group_id: group.id, user_id: user.id, status: 'active', is_admin: true, approved_at: new Date().toISOString() });
  }
  await messageService.ensureGroupConversation(group.id, group.name, user.id);
  await auditService.record({ actorId: user.id, action: 'osusu.group.create', resourceType: 'osusu_group', resourceId: group.id, metadata: { contributionAmount: input.contributionAmount, frequency: input.frequency }, req });
  return formatGroup(group);
}

export async function listGroups(user, { scope, status, search, page, pageSize }) {
  let result;
  if (scope === 'admin') {
    result = await osusuRepo.listGroups({ adminId: user.id, status, search, page, pageSize });
  } else {
    const memberships = await osusuRepo.listMemberships(user.id);
    const adminGroups = await osusuRepo.listGroups({ adminId: user.id, page: 1, pageSize: 100 });
    const ids = [...new Set([...memberships.map((m) => m.group_id), ...adminGroups.rows.map((g) => g.id)])];
    result = await osusuRepo.listGroups({ ids, status, search, page, pageSize });
    const byGroup = new Map(memberships.map((m) => [m.group_id, m]));
    result.rows = result.rows.map((g) => ({ ...g, membership: byGroup.get(g.id) }));
  }
  return {
    items: result.rows.map((g) => ({
      ...formatGroup(g),
      isAdmin: g.admin_id === user.id,
      myStatus: g.membership?.status ?? (g.admin_id === user.id ? 'organiser' : null),
      myPosition: g.membership?.payout_position ?? null,
    })),
    meta: pageMeta({ page, pageSize }, result.total),
  };
}

export async function getGroup(user, groupId) {
  const { group, isAdmin, membership, staff } = await access(user, groupId, { allowPending: true });
  const summary = membership?.status === 'pending_approval' && !isAdmin && !staff ? null : await osusuRepo.groupSummary(groupId);
  return {
    ...formatGroup(group),
    joinCode: isAdmin ? group.join_code : undefined,
    summary,
    membership: membership
      ? {
          id: membership.id,
          status: membership.status,
          payoutPosition: membership.payout_position,
          hasReceivedPayout: membership.has_received_payout,
          riskStatus: membership.risk_status,
        }
      : null,
    permissions: { isAdmin, canManage: isAdmin, isStaff: staff },
  };
}

export async function updateGroup(user, groupId, patch, req) {
  const { group } = await access(user, groupId, { adminOnly: true });
  const allowedWhileActive = ['description', 'meetingSchedule'];
  if (group.status !== 'recruiting') {
    const blocked = Object.keys(patch).filter((k) => !allowedWhileActive.includes(k));
    if (blocked.length) throw AppError.conflict('Financial terms are locked once the group has started', 'TERMS_LOCKED');
  }
  if (patch.maxMembers !== undefined) {
    const current = await osusuRepo.countMembers(groupId, ['active', 'pending_approval']);
    if (patch.maxMembers < current) throw AppError.unprocessable('Maximum members cannot be less than current members');
  }
  const map = {
    name: 'name', description: 'description', contributionAmount: 'contribution_amount', frequency: 'frequency',
    maxMembers: 'max_members', startDate: 'start_date', gracePeriodDays: 'grace_period_days',
    payoutOrderMethod: 'payout_order_method', requiresApproval: 'requires_approval', meetingSchedule: 'meeting_schedule',
  };
  const row = {};
  for (const [k, v] of Object.entries(patch)) if (map[k]) row[map[k]] = v;
  const updated = await osusuRepo.updateGroup(groupId, row);
  await auditService.record({ actorId: user.id, action: 'osusu.group.update', resourceType: 'osusu_group', resourceId: groupId, metadata: { fields: Object.keys(row) }, req });
  return formatGroup(updated);
}

export async function uploadGroupImage(user, groupId, file, req) {
  const { group } = await access(user, groupId, { adminOnly: true });
  const path = storageService.objectPath(groupId, file.detectedExt);
  await storageService.upload(BUCKETS.groupImages, path, file);
  await osusuRepo.updateGroup(groupId, { image_path: path });
  if (group.image_path) await storageService.remove(BUCKETS.groupImages, group.image_path);
  await auditService.record({ actorId: user.id, action: 'osusu.group.image', resourceType: 'osusu_group', resourceId: groupId, req });
  return { imageUrl: storageService.publicUrl(BUCKETS.groupImages, path) };
}

export async function cancelGroup(user, groupId, req) {
  const { group } = await access(user, groupId, { adminOnly: true });
  if (group.status !== 'recruiting') throw AppError.conflict('Only groups that have not started can be cancelled', 'CANNOT_CANCEL');
  await osusuRepo.updateGroup(groupId, { status: 'cancelled', cancelled_at: new Date().toISOString() });
  const members = await osusuRepo.listMembers(groupId, { statuses: ['active', 'pending_approval'] });
  for (const m of members) {
    if (m.user_id === user.id) continue;
    await notificationService.notify(m.user_id, {
      type: 'osusu_group_cancelled', category: 'account', title: 'Group cancelled',
      body: `${group.name} was cancelled by the organiser before it started. No contributions were collected.`,
      data: {}, dedupeKey: `group_cancelled:${groupId}:${m.user_id}`,
    });
  }
  await auditService.record({ actorId: user.id, action: 'osusu.group.cancel', resourceType: 'osusu_group', resourceId: groupId, req });
}

export async function startGroup(user, groupId, req) {
  await access(user, groupId, { adminOnly: true });
  const result = await osusuRepo.startGroup(groupId, user.id);
  const conv = await messageService.ensureGroupConversation(groupId, (await osusuRepo.findGroup(groupId)).name, user.id);
  await messageService.postSystemMessage(conv.id, `The group has started with ${result.total_cycles} members. Cycle 1 contributions are now open.`);
  notificationService.kickDispatcher();
  await auditService.record({ actorId: user.id, action: 'osusu.group.start.request', resourceType: 'osusu_group', resourceId: groupId, req });
  return result;
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------
async function ensureMemberRole(user, req) {
  if (!user.roles.includes(ROLES.OSUSU_MEMBER)) {
    await userRepo.addRole(user.id, ROLES.OSUSU_MEMBER, user.id);
    authService.invalidateUserCache(user.id);
    await auditService.record({ actorId: user.id, action: 'role.self_add', resourceType: 'profile', resourceId: user.id, metadata: { role: ROLES.OSUSU_MEMBER }, req });
  }
}

/** Shared by join-by-code and invite acceptance. */
export async function addMember(user, group, { viaInvite }, req) {
  if (group.status !== 'recruiting') throw AppError.conflict('This group is no longer accepting members', 'GROUP_NOT_RECRUITING');
  const existing = await osusuRepo.findMembership(group.id, user.id);
  if (existing && ['active', 'pending_approval'].includes(existing.status)) {
    throw AppError.conflict('You are already in this group', 'ALREADY_MEMBER');
  }
  const count = await osusuRepo.countMembers(group.id, ['active', 'pending_approval']);
  if (count >= group.max_members) throw AppError.conflict('This group is full', 'GROUP_FULL');

  await ensureMemberRole(user, req);
  const status = viaInvite || !group.requires_approval ? 'active' : 'pending_approval';
  const fields = {
    status,
    approved_at: status === 'active' ? new Date().toISOString() : null,
    removed_at: null,
    removal_reason: null,
    payout_position: null,
    joined_at: new Date().toISOString(),
  };
  const member = existing
    ? await osusuRepo.updateMember(existing.id, fields)
    : await osusuRepo.insertMember({ group_id: group.id, user_id: user.id, ...fields });

  if (status === 'active') await messageService.addToGroupConversation(group.id, user.id);
  await notificationService.notify(group.admin_id, {
    type: status === 'active' ? 'osusu_member_joined' : 'osusu_join_request',
    category: 'account',
    title: status === 'active' ? 'New member joined' : 'New join request',
    body: status === 'active' ? `${user.fullName} joined ${group.name}.` : `${user.fullName} asked to join ${group.name}.`,
    data: { group_id: group.id },
    dedupeKey: `join:${member.id}:${member.joined_at}`,
  });
  await auditService.record({ actorId: user.id, action: 'osusu.member.join', resourceType: 'osusu_group', resourceId: group.id, metadata: { status, viaInvite }, req });
  return { groupId: group.id, status };
}

export async function joinByCode(user, joinCode, req) {
  const group = await osusuRepo.findGroupByCode(joinCode.toUpperCase());
  if (!group) throw AppError.notFound('No group matches that code');
  return addMember(user, group, { viaInvite: false }, req);
}

export async function leaveGroup(user, groupId, req) {
  const group = await osusuRepo.findGroup(groupId);
  if (!group) throw AppError.notFound('Group not found');
  const membership = await osusuRepo.findMembership(groupId, user.id);
  if (!membership || !['active', 'pending_approval'].includes(membership.status)) throw AppError.notFound('You are not in this group');
  if (group.status !== 'recruiting') {
    throw AppError.conflict('You cannot leave after the group has started. Every member must contribute until all payouts are complete.', 'LEAVE_NOT_PERMITTED');
  }
  await osusuRepo.updateMember(membership.id, { status: 'left', removed_at: new Date().toISOString(), payout_position: null });
  if (group.admin_id !== user.id) await messageService.removeFromGroupConversation(groupId, user.id);
  await auditService.record({ actorId: user.id, action: 'osusu.member.leave', resourceType: 'osusu_group', resourceId: groupId, req });
}

export async function listMembers(user, groupId) {
  const { isAdmin, staff } = await access(user, groupId);
  const members = await osusuRepo.listMembers(groupId, {
    statuses: isAdmin || staff ? ['active', 'pending_approval', 'removed', 'rejected', 'left'] : ['active'],
  });
  return members.map((m) => ({
    id: m.id,
    userId: m.user_id,
    name: m.profile?.full_name,
    avatarUrl: storageService.publicUrl(BUCKETS.avatars, m.profile?.avatar_path),
    status: m.status,
    isOrganiser: m.is_admin,
    payoutPosition: m.payout_position,
    hasReceivedPayout: m.has_received_payout,
    payoutReceivedCycle: m.payout_received_cycle,
    // Risk status is visible to the organiser and staff only.
    riskStatus: isAdmin || staff || m.user_id === user.id ? m.risk_status : undefined,
    joinedAt: m.joined_at,
    removalReason: isAdmin || staff ? m.removal_reason : undefined,
  }));
}

async function memberInAdminGroup(user, memberId) {
  const member = await osusuRepo.findMember(memberId);
  if (!member) throw AppError.notFound('Member not found');
  const { group } = await access(user, member.group_id, { adminOnly: true });
  return { member, group };
}

export async function approveMember(user, memberId, req) {
  const { member, group } = await memberInAdminGroup(user, memberId);
  if (member.status !== 'pending_approval') throw AppError.conflict('This request is not pending', 'NOT_PENDING');
  if (group.status !== 'recruiting') throw AppError.conflict('This group is no longer recruiting', 'GROUP_NOT_RECRUITING');
  const active = await osusuRepo.countMembers(group.id, ['active']);
  if (active >= group.max_members) throw AppError.conflict('This group is full', 'GROUP_FULL');
  await osusuRepo.updateMember(memberId, { status: 'active', approved_at: new Date().toISOString() });
  await messageService.addToGroupConversation(group.id, member.user_id);
  await notificationService.notify(member.user_id, {
    type: 'osusu_member_approved', category: 'account', title: 'Join request approved',
    body: `You are now a member of ${group.name}.`, data: { group_id: group.id }, dedupeKey: `approved:${memberId}`,
  });
  await auditService.record({ actorId: user.id, action: 'osusu.member.approve', resourceType: 'osusu_member', resourceId: memberId, metadata: { groupId: group.id }, req });
}

export async function removeMember(user, memberId, reason, req) {
  const { member, group } = await memberInAdminGroup(user, memberId);
  if (group.status !== 'recruiting') {
    // Removing a member mid-rotation would break the payout schedule and the
    // obligations of members who have already been paid.
    throw AppError.conflict('Members cannot be removed after the group has started. Raise a support case for disputes.', 'MEMBER_REMOVAL_NOT_PERMITTED');
  }
  if (!['active', 'pending_approval'].includes(member.status)) throw AppError.conflict('Member is not active', 'NOT_ACTIVE');
  const status = member.status === 'pending_approval' ? 'rejected' : 'removed';
  await osusuRepo.updateMember(memberId, { status, removed_at: new Date().toISOString(), removal_reason: reason ?? null, payout_position: null });
  if (member.user_id !== group.admin_id) await messageService.removeFromGroupConversation(group.id, member.user_id);
  await notificationService.notify(member.user_id, {
    type: 'osusu_member_removed', category: 'account',
    title: status === 'rejected' ? 'Join request declined' : 'Removed from group',
    body: status === 'rejected' ? `Your request to join ${group.name} was declined.` : `You were removed from ${group.name} before it started.`,
    data: {}, dedupeKey: `removed:${memberId}:${Date.now()}`,
  });
  await auditService.record({ actorId: user.id, action: `osusu.member.${status === 'rejected' ? 'reject' : 'remove'}`, resourceType: 'osusu_member', resourceId: memberId, metadata: { groupId: group.id, reason }, req });
}

export async function setPayoutOrder(user, groupId, memberIds, req) {
  await access(user, groupId, { adminOnly: true });
  await osusuRepo.setPayoutOrder(groupId, user.id, memberIds);
  await auditService.record({ actorId: user.id, action: 'osusu.payout_order.request', resourceType: 'osusu_group', resourceId: groupId, req });
  return listMembers(user, groupId);
}

// ---------------------------------------------------------------------------
// Cycles & contributions
// ---------------------------------------------------------------------------
export async function listCycles(user, groupId) {
  await access(user, groupId);
  const cycles = await osusuRepo.listCycles(groupId);
  return cycles.map((c) => {
    const payout = Array.isArray(c.payout) ? c.payout[0] : c.payout;
    return {
      id: c.id,
      cycleNumber: c.cycle_number,
      dueDate: c.due_date,
      status: c.status,
      expectedAmount: Number(c.expected_amount),
      collectedAmount: Number(c.collected_amount),
      outstandingAmount: Number(c.expected_amount) - Number(c.collected_amount),
      paidCount: c.paid_count,
      memberCount: c.member_count,
      recipient: { memberId: c.recipient_member_id, userId: c.recipient?.user_id, name: c.recipient?.profile?.full_name },
      payout: payout ? { id: payout.id, status: payout.status, amount: Number(payout.amount), paidAt: payout.paid_at } : null,
    };
  });
}

export async function getCycle(user, cycleId) {
  const cycle = await osusuRepo.findCycle(cycleId);
  if (!cycle) throw AppError.notFound('Cycle not found');
  const { isAdmin, staff } = await access(user, cycle.group_id);
  const contributions = await osusuRepo.listCycleContributions(cycleId);
  const payout = Array.isArray(cycle.payout) ? cycle.payout[0] : cycle.payout;
  return {
    id: cycle.id,
    groupId: cycle.group_id,
    cycleNumber: cycle.cycle_number,
    dueDate: cycle.due_date,
    status: cycle.status,
    expectedAmount: Number(cycle.expected_amount),
    collectedAmount: Number(cycle.collected_amount),
    outstandingAmount: Number(cycle.expected_amount) - Number(cycle.collected_amount),
    paidCount: cycle.paid_count,
    unpaidCount: cycle.member_count - cycle.paid_count,
    recipient: { memberId: cycle.recipient_member_id, name: cycle.recipient?.profile?.full_name, userId: cycle.recipient?.user_id },
    payout: payout
      ? { id: payout.id, status: payout.status, amount: Number(payout.amount), reference: isAdmin || staff ? payout.payout_reference : undefined, paidAt: payout.paid_at, failureReason: isAdmin || staff ? payout.failure_reason : undefined }
      : null,
    // Group transparency: everyone sees who has paid this cycle.
    contributions: contributions.map((c) => ({
      id: c.id,
      userId: c.user_id,
      name: c.profile?.full_name,
      amount: Number(c.amount),
      status: c.status,
      isLate: c.is_late,
      paidAt: c.paid_at,
      isMine: c.user_id === user.id,
    })),
    canApprovePayout: isAdmin && cycle.status === 'funded' && payout?.status === 'scheduled',
  };
}

function formatContribution(c) {
  return {
    id: c.id,
    groupId: c.group_id,
    groupName: c.group?.name,
    cycleId: c.cycle_id,
    cycleNumber: c.cycle_number,
    userId: c.user_id,
    memberName: c.profile?.full_name,
    amount: Number(c.amount),
    dueDate: c.due_date,
    status: c.status,
    isLate: c.is_late,
    paidAt: c.paid_at,
    transactionId: c.transaction_id,
  };
}

export async function listGroupContributions(user, groupId, filters) {
  const { isAdmin, staff } = await access(user, groupId);
  const result = await osusuRepo.listContributions({ ...filters, groupId, userId: isAdmin || staff ? filters.userId : user.id });
  return { items: result.rows.map(formatContribution), meta: pageMeta(filters, result.total) };
}

export async function myContributions(user, filters) {
  const result = await osusuRepo.listContributions({ ...filters, userId: user.id });
  return { items: result.rows.map(formatContribution), meta: pageMeta(filters, result.total) };
}

export async function payContribution(user, contributionId) {
  const c = await osusuRepo.findContribution(contributionId);
  if (!c || c.user_id !== user.id) throw AppError.notFound('Contribution not found');
  if (c.status === 'paid') throw AppError.conflict('This contribution has already been paid', 'ALREADY_PAID');
  if (c.group?.status !== 'active') throw AppError.conflict('This group is not active', 'GROUP_NOT_ACTIVE');
  return paymentService.initialize({
    user,
    purpose: 'osusu_contribution',
    targetId: c.id,
    amount: Number(c.amount), // server-side amount; never from the client
    metadata: { group_id: c.group_id, cycle_number: c.cycle_number },
  });
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------
export async function listPayouts(user, groupId) {
  const { isAdmin, staff } = await access(user, groupId);
  const rows = await osusuRepo.listPayouts(groupId);
  return rows.map((p) => ({
    id: p.id,
    cycleId: p.cycle_id,
    cycleNumber: p.cycle_number,
    recipientUserId: p.recipient_user_id,
    recipientName: p.recipient?.full_name,
    amount: Number(p.amount),
    status: p.status,
    reference: isAdmin || staff ? p.payout_reference : undefined,
    executionMode: isAdmin || staff ? p.execution_mode : undefined,
    approvedAt: p.approved_at,
    paidAt: p.paid_at,
    failureReason: isAdmin || staff ? p.failure_reason : undefined,
    isMine: p.recipient_user_id === user.id,
  }));
}

export async function approvePayout(user, cycleId, req) {
  const cycle = await osusuRepo.findCycle(cycleId);
  if (!cycle) throw AppError.notFound('Cycle not found');
  await access(user, cycle.group_id, { adminOnly: true });
  const mode = await settingsService.payoutMode();
  const result = await osusuRepo.approvePayout(cycleId, user.id, mode);
  await auditService.record({ actorId: user.id, action: 'osusu.payout.approve.request', resourceType: 'osusu_cycle', resourceId: cycleId, metadata: { mode }, req });
  notificationService.kickDispatcher();
  if (mode === 'paystack_transfer') await payoutService.execute('osusu_payout', result.payout_id);
  return result;
}

// ---------------------------------------------------------------------------
// Organiser insight
// ---------------------------------------------------------------------------
export async function activity(user, groupId) {
  await access(user, groupId, { adminOnly: true });
  const rows = await osusuRepo.groupTransactions(groupId, 100);
  return rows.map((t) => ({
    id: t.id,
    reference: t.reference,
    type: t.type,
    amount: Number(t.amount),
    status: t.status,
    description: t.description,
    memberName: t.user?.full_name,
    createdAt: t.created_at,
  }));
}

export async function risk(user, groupId) {
  const { staff } = await access(user, groupId, { adminOnly: !isStaff(user) });
  void staff;
  const [members, flags] = await Promise.all([osusuRepo.riskMembers(groupId), osusuRepo.openRiskFlags(groupId)]);
  return {
    members: members.map((m) => ({
      memberId: m.id,
      userId: m.user_id,
      name: m.profile?.full_name,
      riskStatus: m.risk_status,
      hasReceivedPayout: m.has_received_payout,
      payoutReceivedCycle: m.payout_received_cycle,
    })),
    flags: flags.map((f) => ({ id: f.id, userId: f.subject_user_id, reason: f.reason_code, severity: f.severity, status: f.status, createdAt: f.created_at })),
  };
}

export { access as groupAccess, formatGroup };
