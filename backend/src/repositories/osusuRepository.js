import { db, one, run, runPaged, rpc } from '../integrations/supabase/db.js';
import { likePattern, toRange } from '../utils/pagination.js';

const GROUP_COLUMNS =
  'id, name, description, image_path, admin_id, contribution_amount, currency, frequency, max_members, start_date, ' +
  'grace_period_days, payout_order_method, requires_approval, meeting_schedule, join_code, status, current_cycle, ' +
  'total_cycles, started_at, completed_at, cancelled_at, created_at';

// Groups ---------------------------------------------------------------------
export async function insertGroup(row) {
  return one(db.from('osusu_groups').insert(row).select(GROUP_COLUMNS).maybeSingle());
}

export async function findGroup(id) {
  return one(db.from('osusu_groups').select(`${GROUP_COLUMNS}, admin:profiles!osusu_groups_admin_id_fkey(id, full_name, avatar_path)`).eq('id', id).maybeSingle());
}

export async function findGroupByCode(code) {
  return one(db.from('osusu_groups').select(GROUP_COLUMNS).eq('join_code', code).maybeSingle());
}

export async function updateGroup(id, patch) {
  return one(db.from('osusu_groups').update(patch).eq('id', id).select(GROUP_COLUMNS).maybeSingle());
}

export async function listGroups({ ids, adminId, status, search, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('osusu_groups').select(GROUP_COLUMNS, { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);
  if (ids) q = q.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  if (adminId) q = q.eq('admin_id', adminId);
  if (status) q = q.eq('status', status);
  if (search) q = q.ilike('name', likePattern(search));
  return runPaged(q);
}

export async function listAllGroupsForAdmin({ status, search, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db
    .from('osusu_groups')
    .select(`${GROUP_COLUMNS}, admin:profiles!osusu_groups_admin_id_fkey(full_name, email)`, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (status) q = q.eq('status', status);
  if (search) q = q.ilike('name', likePattern(search));
  return runPaged(q);
}

export async function groupSummary(groupId) {
  return rpc('osusu_group_summary', { p_group_id: groupId });
}

export async function startGroup(groupId, actorId) {
  return rpc('start_osusu_group', { p_group_id: groupId, p_actor: actorId });
}

export async function setPayoutOrder(groupId, actorId, memberIds) {
  return rpc('set_osusu_payout_order', { p_group_id: groupId, p_actor: actorId, p_member_ids: memberIds });
}

// Members --------------------------------------------------------------------
const MEMBER_COLUMNS =
  'id, group_id, user_id, status, is_admin, payout_position, has_received_payout, payout_received_cycle, risk_status, ' +
  'joined_at, approved_at, removed_at, removal_reason';

export async function findMembership(groupId, userId) {
  return one(db.from('osusu_members').select(MEMBER_COLUMNS).eq('group_id', groupId).eq('user_id', userId).maybeSingle());
}

export async function findMember(memberId) {
  return one(db.from('osusu_members').select(MEMBER_COLUMNS).eq('id', memberId).maybeSingle());
}

export async function listMemberships(userId) {
  return run(db.from('osusu_members').select(MEMBER_COLUMNS).eq('user_id', userId).in('status', ['active', 'pending_approval']));
}

export async function listMembers(groupId, { statuses } = {}) {
  let q = db
    .from('osusu_members')
    .select(`${MEMBER_COLUMNS}, profile:profiles(id, full_name, avatar_path, last_seen_at)`)
    .eq('group_id', groupId)
    .order('payout_position', { ascending: true, nullsFirst: false })
    .order('joined_at', { ascending: true });
  if (statuses) q = q.in('status', statuses);
  return run(q);
}

export async function countMembers(groupId, statuses) {
  const { count, error } = await db.from('osusu_members').select('id', { count: 'exact', head: true }).eq('group_id', groupId).in('status', statuses);
  if (error) throw error;
  return count ?? 0;
}

export async function insertMember(row) {
  return one(db.from('osusu_members').insert(row).select(MEMBER_COLUMNS).maybeSingle());
}

export async function updateMember(id, patch) {
  return one(db.from('osusu_members').update(patch).eq('id', id).select(MEMBER_COLUMNS).maybeSingle());
}

// Cycles, contributions, payouts --------------------------------------------
export async function listCycles(groupId) {
  return run(
    db.from('osusu_cycles')
      .select('*, recipient:osusu_members!osusu_cycles_recipient_member_id_fkey(id, user_id, profile:profiles(full_name)), payout:osusu_payouts(id, status, amount, paid_at)')
      .eq('group_id', groupId)
      .order('cycle_number'),
  );
}

export async function findCycle(cycleId) {
  return one(
    db.from('osusu_cycles')
      .select('*, recipient:osusu_members!osusu_cycles_recipient_member_id_fkey(id, user_id, profile:profiles(full_name)), payout:osusu_payouts(*)')
      .eq('id', cycleId)
      .maybeSingle(),
  );
}

export async function listCycleContributions(cycleId) {
  return run(
    db.from('osusu_contributions')
      .select('id, member_id, user_id, amount, due_date, status, is_late, paid_at, profile:profiles(full_name, avatar_path)')
      .eq('cycle_id', cycleId)
      .order('status'),
  );
}

export async function listContributions({ groupId, userId, status, statuses, cycleNumber, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db
    .from('osusu_contributions')
    .select('id, group_id, cycle_id, cycle_number, member_id, user_id, amount, due_date, status, is_late, paid_at, transaction_id, profile:profiles(full_name), group:osusu_groups(name)', { count: 'exact' })
    .order('due_date', { ascending: false })
    .order('cycle_number', { ascending: false })
    .range(from, to);
  if (groupId) q = q.eq('group_id', groupId);
  if (userId) q = q.eq('user_id', userId);
  if (status) q = q.eq('status', status);
  if (statuses) q = q.in('status', statuses);
  if (cycleNumber) q = q.eq('cycle_number', cycleNumber);
  return runPaged(q);
}

export async function findContribution(id) {
  return one(db.from('osusu_contributions').select('*, group:osusu_groups(id, name, status, contribution_amount)').eq('id', id).maybeSingle());
}

export async function listPayouts(groupId) {
  return run(
    db.from('osusu_payouts')
      .select('id, cycle_id, cycle_number, recipient_member_id, recipient_user_id, amount, status, payout_reference, execution_mode, approved_at, paid_at, failure_reason, recipient:profiles!osusu_payouts_recipient_user_id_fkey(full_name)')
      .eq('group_id', groupId)
      .order('cycle_number'),
  );
}

export async function findPayoutByCycle(cycleId) {
  return one(db.from('osusu_payouts').select('*').eq('cycle_id', cycleId).maybeSingle());
}

export async function approvePayout(cycleId, actorId, mode) {
  return rpc('approve_osusu_payout', { p_cycle_id: cycleId, p_actor: actorId, p_mode: mode });
}

export async function groupTransactions(groupId, limit = 50) {
  return run(
    db.from('transactions')
      .select('id, reference, type, direction, amount, status, description, created_at, completed_at, user:profiles(full_name)')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .limit(limit),
  );
}

export async function riskMembers(groupId) {
  return run(
    db.from('osusu_members')
      .select(`${MEMBER_COLUMNS}, profile:profiles(full_name)`)
      .eq('group_id', groupId)
      .neq('risk_status', 'good'),
  );
}

export async function openRiskFlags(groupId) {
  return run(
    db.from('risk_flags').select('id, subject_user_id, reason_code, severity, status, details, created_at')
      .eq('group_id', groupId).in('status', ['review_required', 'risk_review']).order('created_at', { ascending: false }),
  );
}

export async function upcomingPayoutsForUser(userId) {
  return run(
    db.from('osusu_payouts')
      .select('id, group_id, cycle_number, amount, status, cycle:osusu_cycles(due_date, status), group:osusu_groups(name, contribution_amount, total_cycles)')
      .eq('recipient_user_id', userId)
      .in('status', ['scheduled', 'approved', 'processing'])
      .order('cycle_number'),
  );
}
