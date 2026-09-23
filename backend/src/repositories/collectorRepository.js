import { db, one, run, runPaged, rpc } from '../integrations/supabase/db.js';
import { likePattern, toRange } from '../utils/pagination.js';

const PLAN_COLUMNS =
  'id, collector_account_id, collector_id, saver_id, plan_name, frequency, expected_amount, start_date, end_date, ' +
  'commission_type, commission_value, balance, total_contributed, total_returned, status, matured_at, closed_at, created_at';

// Accounts -------------------------------------------------------------------
export async function findAccountByCollector(collectorId) {
  return one(db.from('collector_accounts').select('*').eq('collector_id', collectorId).maybeSingle());
}

export async function findAccount(id) {
  return one(db.from('collector_accounts').select('*, collector:profiles(id, full_name, avatar_path)').eq('id', id).maybeSingle());
}

export async function insertAccount(row) {
  return one(db.from('collector_accounts').insert(row).select('*').maybeSingle());
}

export async function updateAccount(id, patch) {
  return one(db.from('collector_accounts').update(patch).eq('id', id).select('*').maybeSingle());
}

export async function listAccountsForAdmin({ status, search, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db
    .from('collector_accounts')
    .select('*, collector:profiles(full_name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (status) q = q.eq('status', status);
  if (search) q = q.ilike('business_name', likePattern(search));
  return runPaged(q);
}

// Plans (collector_savers) ----------------------------------------------------
export async function insertPlan(row) {
  return one(db.from('collector_savers').insert(row).select(PLAN_COLUMNS).maybeSingle());
}

export async function findPlan(id) {
  return one(
    db.from('collector_savers')
      .select(`${PLAN_COLUMNS}, saver:profiles!collector_savers_saver_id_fkey(id, full_name, avatar_path), collector:profiles!collector_savers_collector_id_fkey(id, full_name, avatar_path), account:collector_accounts(id, business_name)`)
      .eq('id', id)
      .maybeSingle(),
  );
}

export async function updatePlan(id, patch) {
  return one(db.from('collector_savers').update(patch).eq('id', id).select(PLAN_COLUMNS).maybeSingle());
}

export async function listPlans({ collectorId, saverId, status, search, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  const saverJoin = search ? 'saver:profiles!collector_savers_saver_id_fkey!inner(id, full_name, avatar_path)' : 'saver:profiles!collector_savers_saver_id_fkey(id, full_name, avatar_path)';
  let q = db
    .from('collector_savers')
    .select(`${PLAN_COLUMNS}, ${saverJoin}, collector:profiles!collector_savers_collector_id_fkey(id, full_name), account:collector_accounts(business_name)`, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (collectorId) q = q.eq('collector_id', collectorId);
  if (saverId) q = q.eq('saver_id', saverId);
  if (status) q = q.eq('status', status);
  if (search) q = q.ilike('saver.full_name', likePattern(search));
  return runPaged(q);
}

export async function collectorStats(collectorId) {
  const plans = await run(
    db.from('collector_savers').select('id, balance, end_date, status').eq('collector_id', collectorId)
      .in('status', ['active', 'matured', 'return_requested', 'return_processing']),
  );
  const commissions = await run(
    db.from('collector_commissions').select('amount, status').eq('collector_id', collectorId),
  );
  const pendingReturns = await run(
    db.from('collector_returns').select('id', { count: 'exact' }).eq('collector_id', collectorId).in('status', ['requested', 'approved', 'processing']),
  );
  return { plans, commissions, pendingReturns: pendingReturns.length };
}

// Contributions ----------------------------------------------------------------
export async function listPlanContributions(planId, { page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  return runPaged(
    db.from('collector_contributions').select('id, amount, status, paid_at, transaction_id', { count: 'exact' })
      .eq('collector_saver_id', planId).order('paid_at', { ascending: false }).range(from, to),
  );
}

// Returns --------------------------------------------------------------------------
export async function listReturns({ collectorId, saverId, planId, status, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db
    .from('collector_returns')
    .select('*, plan:collector_savers(plan_name, end_date), saver:profiles!collector_returns_saver_id_fkey(full_name)', { count: 'exact' })
    .order('requested_at', { ascending: false })
    .range(from, to);
  if (collectorId) q = q.eq('collector_id', collectorId);
  if (saverId) q = q.eq('saver_id', saverId);
  if (planId) q = q.eq('collector_saver_id', planId);
  if (status) q = q.eq('status', status);
  return runPaged(q);
}

export async function findOpenReturn(planId) {
  return one(
    db.from('collector_returns').select('*').eq('collector_saver_id', planId)
      .in('status', ['requested', 'approved', 'processing']).maybeSingle(),
  );
}

export async function findReturn(id) {
  return one(db.from('collector_returns').select('*').eq('id', id).maybeSingle());
}

export async function requestReturn(planId, actorId, reason) {
  return rpc('request_collector_return', { p_plan_id: planId, p_actor: actorId, p_reason: reason ?? null });
}

export async function approveReturn(returnId, actorId, mode, asPlatformAdmin) {
  return rpc('approve_collector_return', {
    p_return_id: returnId, p_actor: actorId, p_mode: mode, p_as_platform_admin: asPlatformAdmin,
  });
}

export async function rejectReturn(returnId, actorId, reason, asPlatformAdmin) {
  return rpc('reject_collector_return', {
    p_return_id: returnId, p_actor: actorId, p_reason: reason, p_as_platform_admin: asPlatformAdmin,
  });
}

export async function listCommissions(collectorId) {
  return run(
    db.from('collector_commissions').select('id, amount, status, settled_at, created_at, plan:collector_savers(plan_name)')
      .eq('collector_id', collectorId).order('created_at', { ascending: false }),
  );
}
