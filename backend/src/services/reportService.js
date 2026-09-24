import { db, run } from '../integrations/supabase/db.js';
import * as osusuService from './osusuService.js';
import * as collectorService from './collectorService.js';
import * as auditService from './auditService.js';
import { AppError } from '../utils/AppError.js';
import { can } from './permissionService.js';
import { toCsv } from '../utils/csv.js';

const naira = (k) => (Number(k) / 100).toFixed(2);
const MAX_ROWS = 10000;

function range(q, from, to, column = 'created_at') {
  let query = q;
  if (from) query = query.gte(column, from);
  if (to) query = query.lte(column, to);
  return query;
}

// ---------------------------------------------------------------------------
// Osusu group reports (organiser or staff)
// ---------------------------------------------------------------------------
const OSUSU_REPORTS = {
  contributions: {
    title: 'Group contribution report',
    async rows(groupId, { from, to }) {
      return run(range(
        db.from('osusu_contributions').select('cycle_number, amount, due_date, status, is_late, paid_at, profile:profiles(full_name)')
          .eq('group_id', groupId).order('cycle_number').limit(MAX_ROWS), from, to, 'due_date'));
    },
    columns: [
      { label: 'Cycle', key: 'cycle_number' },
      { label: 'Member', value: (r) => r.profile?.full_name },
      { label: 'Amount (NGN)', value: (r) => naira(r.amount) },
      { label: 'Due date', key: 'due_date' },
      { label: 'Status', key: 'status' },
      { label: 'Paid late', value: (r) => (r.is_late ? 'Yes' : 'No') },
      { label: 'Paid at', key: 'paid_at' },
    ],
  },
  members: {
    title: 'Member payment report',
    async rows(groupId) {
      const members = await run(db.from('osusu_members').select('id, payout_position, has_received_payout, risk_status, status, profile:profiles(full_name)').eq('group_id', groupId).eq('status', 'active'));
      const contribs = await run(db.from('osusu_contributions').select('member_id, amount, status').eq('group_id', groupId).limit(MAX_ROWS));
      return members.map((m) => {
        const mine = contribs.filter((c) => c.member_id === m.id);
        return {
          ...m,
          paid: mine.filter((c) => c.status === 'paid').reduce((s, c) => s + Number(c.amount), 0),
          outstanding: mine.filter((c) => c.status !== 'paid').reduce((s, c) => s + Number(c.amount), 0),
          overdue: mine.filter((c) => c.status === 'overdue').length,
        };
      });
    },
    columns: [
      { label: 'Position', key: 'payout_position' },
      { label: 'Member', value: (r) => r.profile?.full_name },
      { label: 'Total paid (NGN)', value: (r) => naira(r.paid) },
      { label: 'Outstanding (NGN)', value: (r) => naira(r.outstanding) },
      { label: 'Overdue count', key: 'overdue' },
      { label: 'Received payout', value: (r) => (r.has_received_payout ? 'Yes' : 'No') },
      { label: 'Standing', key: 'risk_status' },
    ],
  },
  defaults: {
    title: 'Default report',
    async rows(groupId) {
      return run(db.from('osusu_contributions')
        .select('cycle_number, amount, due_date, status, member:osusu_members(has_received_payout, payout_received_cycle, risk_status), profile:profiles(full_name)')
        .eq('group_id', groupId).eq('status', 'overdue').order('due_date').limit(MAX_ROWS));
    },
    columns: [
      { label: 'Member', value: (r) => r.profile?.full_name },
      { label: 'Cycle', key: 'cycle_number' },
      { label: 'Amount (NGN)', value: (r) => naira(r.amount) },
      { label: 'Due date', key: 'due_date' },
      { label: 'Already received payout', value: (r) => (r.member?.has_received_payout ? `Yes (cycle ${r.member.payout_received_cycle})` : 'No') },
      { label: 'Standing', value: (r) => r.member?.risk_status },
    ],
  },
  payouts: {
    title: 'Payout report',
    async rows(groupId) {
      return run(db.from('osusu_payouts').select('cycle_number, amount, status, payout_reference, approved_at, paid_at, recipient:profiles!osusu_payouts_recipient_user_id_fkey(full_name)')
        .eq('group_id', groupId).order('cycle_number'));
    },
    columns: [
      { label: 'Cycle', key: 'cycle_number' },
      { label: 'Recipient', value: (r) => r.recipient?.full_name },
      { label: 'Amount (NGN)', value: (r) => naira(r.amount) },
      { label: 'Status', key: 'status' },
      { label: 'Reference', key: 'payout_reference' },
      { label: 'Approved at', key: 'approved_at' },
      { label: 'Paid at', key: 'paid_at' },
    ],
  },
  cycles: {
    title: 'Cycle report',
    async rows(groupId) {
      return run(db.from('osusu_cycles').select('cycle_number, due_date, status, expected_amount, collected_amount, paid_count, member_count').eq('group_id', groupId).order('cycle_number'));
    },
    columns: [
      { label: 'Cycle', key: 'cycle_number' },
      { label: 'Due date', key: 'due_date' },
      { label: 'Status', key: 'status' },
      { label: 'Expected (NGN)', value: (r) => naira(r.expected_amount) },
      { label: 'Collected (NGN)', value: (r) => naira(r.collected_amount) },
      { label: 'Outstanding (NGN)', value: (r) => naira(Number(r.expected_amount) - Number(r.collected_amount)) },
      { label: 'Paid members', value: (r) => `${r.paid_count}/${r.member_count}` },
    ],
  },
};

// ---------------------------------------------------------------------------
// Collector reports (collector's own book)
// ---------------------------------------------------------------------------
const COLLECTOR_REPORTS = {
  contributions: {
    title: 'Saver contribution report',
    async rows(collectorId, { from, to }) {
      const plans = await run(db.from('collector_savers').select('id').eq('collector_id', collectorId));
      if (!plans.length) return [];
      return run(range(db.from('collector_contributions')
        .select('amount, paid_at, plan:collector_savers(plan_name), saver:profiles(full_name)')
        .in('collector_saver_id', plans.map((p) => p.id)).order('paid_at', { ascending: false }).limit(MAX_ROWS), from, to, 'paid_at'));
    },
    columns: [
      { label: 'Saver', value: (r) => r.saver?.full_name },
      { label: 'Plan', value: (r) => r.plan?.plan_name },
      { label: 'Amount (NGN)', value: (r) => naira(r.amount) },
      { label: 'Paid at', key: 'paid_at' },
    ],
  },
  balances: {
    title: 'Collector balance report',
    async rows(collectorId) {
      return run(db.from('collector_savers').select('plan_name, balance, total_contributed, total_returned, status, start_date, end_date, saver:profiles!collector_savers_saver_id_fkey(full_name)')
        .eq('collector_id', collectorId).order('end_date'));
    },
    columns: [
      { label: 'Saver', value: (r) => r.saver?.full_name },
      { label: 'Plan', key: 'plan_name' },
      { label: 'Balance (NGN)', value: (r) => naira(r.balance) },
      { label: 'Total saved (NGN)', value: (r) => naira(r.total_contributed) },
      { label: 'Returned (NGN)', value: (r) => naira(r.total_returned) },
      { label: 'Status', key: 'status' },
      { label: 'Start', key: 'start_date' },
      { label: 'End', key: 'end_date' },
    ],
  },
  commissions: {
    title: 'Commission report',
    async rows(collectorId) {
      return run(db.from('collector_commissions').select('amount, status, settled_at, created_at, plan:collector_savers(plan_name)').eq('collector_id', collectorId).order('created_at', { ascending: false }));
    },
    columns: [
      { label: 'Plan', value: (r) => r.plan?.plan_name },
      { label: 'Commission (NGN)', value: (r) => naira(r.amount) },
      { label: 'Status', key: 'status' },
      { label: 'Accrued', key: 'created_at' },
      { label: 'Settled', key: 'settled_at' },
    ],
  },
  maturity: {
    title: 'Maturity report',
    async rows(collectorId) {
      return run(db.from('collector_savers').select('plan_name, balance, end_date, status, saver:profiles!collector_savers_saver_id_fkey(full_name)')
        .eq('collector_id', collectorId).in('status', ['active', 'matured', 'return_requested', 'return_processing']).order('end_date'));
    },
    columns: [
      { label: 'Saver', value: (r) => r.saver?.full_name },
      { label: 'Plan', key: 'plan_name' },
      { label: 'Balance (NGN)', value: (r) => naira(r.balance) },
      { label: 'Maturity date', key: 'end_date' },
      { label: 'Status', key: 'status' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Platform reports (staff)
// ---------------------------------------------------------------------------
const PLATFORM_REPORTS = {
  transactions: {
    title: 'Transaction report',
    rows: (_, { from, to }) => run(range(db.from('transactions').select('reference, type, direction, amount, status, provider, provider_reference, created_at, completed_at, user:profiles!transactions_user_id_fkey(full_name, email)').order('created_at', { ascending: false }).limit(MAX_ROWS), from, to)),
    columns: [
      { label: 'Reference', key: 'reference' }, { label: 'Type', key: 'type' }, { label: 'Direction', key: 'direction' },
      { label: 'Amount (NGN)', value: (r) => naira(r.amount) }, { label: 'Status', key: 'status' }, { label: 'Provider', key: 'provider' },
      { label: 'Provider ref', key: 'provider_reference' }, { label: 'User', value: (r) => r.user?.full_name },
      { label: 'Email', value: (r) => r.user?.email }, { label: 'Created', key: 'created_at' }, { label: 'Completed', key: 'completed_at' },
    ],
  },
  bills: {
    title: 'Bill-payment report',
    rows: (_, { from, to }) => run(range(db.from('bill_payments').select('reference, category, service_id, customer_identifier, amount, status, provider, provider_reference, created_at, completed_at').order('created_at', { ascending: false }).limit(MAX_ROWS), from, to)),
    columns: [
      { label: 'Reference', key: 'reference' }, { label: 'Category', key: 'category' }, { label: 'Service', key: 'service_id' },
      { label: 'Customer', key: 'customer_identifier' }, { label: 'Amount (NGN)', value: (r) => naira(r.amount) },
      { label: 'Status', key: 'status' }, { label: 'Provider', key: 'provider' }, { label: 'Provider ref', key: 'provider_reference' },
      { label: 'Created', key: 'created_at' }, { label: 'Completed', key: 'completed_at' },
    ],
  },
  'user-growth': {
    title: 'User growth report',
    async rows(_, { from, to }) {
      const users = await run(range(db.from('profiles').select('created_at, primary_account_type').order('created_at').limit(50000), from, to));
      const byDay = new Map();
      for (const u of users) {
        const day = u.created_at.slice(0, 10);
        const row = byDay.get(day) || { day, osusu: 0, collector: 0, personal: 0, total: 0 };
        row[u.primary_account_type] += 1;
        row.total += 1;
        byDay.set(day, row);
      }
      let cumulative = 0;
      return [...byDay.values()].map((r) => ({ ...r, cumulative: (cumulative += r.total) }));
    },
    columns: [
      { label: 'Date', key: 'day' }, { label: 'Osusu', key: 'osusu' }, { label: 'Collector', key: 'collector' },
      { label: 'Personal', key: 'personal' }, { label: 'New users', key: 'total' }, { label: 'Cumulative', key: 'cumulative' },
    ],
  },
  'failed-payments': {
    title: 'Failed payments report',
    rows: (_, { from, to }) => run(range(db.from('payment_attempts').select('reference, purpose, amount, status, channel, gateway_response, created_at, user:profiles(full_name, email)').in('status', ['failed', 'amount_mismatch', 'duplicate']).order('created_at', { ascending: false }).limit(MAX_ROWS), from, to)),
    columns: [
      { label: 'Reference', key: 'reference' }, { label: 'Purpose', key: 'purpose' }, { label: 'Amount (NGN)', value: (r) => naira(r.amount) },
      { label: 'Status', key: 'status' }, { label: 'Channel', key: 'channel' }, { label: 'Gateway response', key: 'gateway_response' },
      { label: 'User', value: (r) => r.user?.full_name }, { label: 'Created', key: 'created_at' },
    ],
  },
  revenue: {
    title: 'Commission and volume report',
    async rows(_, { from, to }) {
      const txs = await run(range(db.from('transactions').select('type, amount, created_at').eq('status', 'success').limit(100000), from, to));
      const byMonth = new Map();
      for (const t of txs) {
        const month = t.created_at.slice(0, 7);
        const row = byMonth.get(month) || { month, contributions: 0, payouts: 0, commissions: 0, bills: 0 };
        if (['osusu_contribution', 'collector_savings'].includes(t.type)) row.contributions += Number(t.amount);
        if (['osusu_payout', 'saver_return'].includes(t.type)) row.payouts += Number(t.amount);
        if (t.type === 'commission') row.commissions += Number(t.amount);
        if (t.type === 'bill_payment') row.bills += Number(t.amount);
        byMonth.set(month, row);
      }
      return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
    },
    columns: [
      { label: 'Month', key: 'month' },
      { label: 'Contributions (NGN)', value: (r) => naira(r.contributions) },
      { label: 'Payouts & returns (NGN)', value: (r) => naira(r.payouts) },
      { label: 'Collector commissions (NGN)', value: (r) => naira(r.commissions) },
      { label: 'Bill payments (NGN)', value: (r) => naira(r.bills) },
    ],
  },
};

async function build(defs, type, subjectId, filters) {
  const def = defs[type];
  if (!def) throw AppError.badRequest('Unknown report type', 'UNKNOWN_REPORT');
  const rows = await def.rows(subjectId, filters);
  return {
    title: def.title,
    generatedAt: new Date().toISOString(),
    columns: def.columns.map((c) => c.label),
    rows: rows.map((r) => def.columns.map((c) => (typeof c.value === 'function' ? c.value(r) : r[c.key]) ?? null)),
    csv: filters.format === 'csv' ? toCsv(rows, def.columns) : undefined,
  };
}

export async function osusuReport(user, groupId, filters, req) {
  await osusuService.groupAccess(user, groupId, { adminOnly: !can(user, 'reports.platform') });
  const report = await build(OSUSU_REPORTS, filters.type, groupId, filters);
  await auditService.record({ actorId: user.id, action: 'report.osusu', resourceType: 'osusu_group', resourceId: groupId, metadata: { type: filters.type, format: filters.format }, req });
  return report;
}

export async function collectorReport(user, filters, req) {
  // Reports stay available to a restricted/suspended collector: they document existing obligations.
  if (!(await collectorService.getMyAccount(user))) throw AppError.notFound('Create your collector account first', 'NO_COLLECTOR_ACCOUNT');
  const report = await build(COLLECTOR_REPORTS, filters.type, user.id, filters);
  await auditService.record({ actorId: user.id, action: 'report.collector', resourceType: 'collector_account', resourceId: user.id, metadata: { type: filters.type }, req });
  return report;
}

export async function platformReport(user, filters, req) {
  const report = await build(PLATFORM_REPORTS, filters.type, null, filters);
  await auditService.record({ actorId: user.id, action: 'report.platform', resourceType: 'platform', metadata: { type: filters.type, from: filters.from, to: filters.to }, req });
  return report;
}

export const REPORT_TYPES = {
  osusu: Object.keys(OSUSU_REPORTS),
  collector: Object.keys(COLLECTOR_REPORTS),
  platform: Object.keys(PLATFORM_REPORTS),
};
