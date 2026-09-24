import { db, one, run, rpc } from '../integrations/supabase/db.js';

/**
 * Uniform view over the three payout-instruction tables so the payout
 * executor and the admin queue treat them identically.
 */
const TABLES = {
  osusu_payout: { table: 'osusu_payouts', refCol: 'payout_reference', userCol: 'recipient_user_id', ready: 'approved' },
  saver_return: { table: 'collector_returns', refCol: 'return_reference', userCol: 'saver_id', ready: 'approved', amountCol: 'net_amount' },
  commission: { table: 'collector_commissions', refCol: 'commission_reference', userCol: 'collector_id', ready: 'accrued' },
};

export function meta(kind) {
  const m = TABLES[kind];
  if (!m) throw new Error(`unknown disbursement kind ${kind}`);
  return m;
}

function normalise(kind, row) {
  if (!row) return null;
  const m = meta(kind);
  return {
    kind,
    id: row.id,
    status: row.status,
    reference: row[m.refCol],
    amount: Number(row[m.amountCol || 'amount']),
    userId: row[m.userCol],
    executionMode: row.execution_mode,
    transferCode: row.transfer_code,
    failureReason: row.failure_reason,
    holdReason: row.hold_reason ?? null,
    riskEvaluation: row.risk_evaluation ?? null,
    destination: row.destination_last4 ? { bankName: row.destination_bank_name, accountName: row.destination_account_name, last4: row.destination_last4 } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    raw: row,
  };
}

export async function find(kind, id) {
  const m = meta(kind);
  return normalise(kind, await one(db.from(m.table).select('*').eq('id', id).maybeSingle()));
}

export async function findByReference(kind, reference) {
  const m = meta(kind);
  return normalise(kind, await one(db.from(m.table).select('*').eq(m.refCol, reference).maybeSingle()));
}

export async function listByStatus(kind, statuses, limit = 100) {
  const m = meta(kind);
  const rows = await run(db.from(m.table).select('*').in('status', statuses).order('updated_at').limit(limit));
  return rows.map((r) => normalise(kind, r));
}

export async function markProcessing(kind, id, transferCode) {
  return rpc('mark_disbursement_processing', { p_kind: kind, p_id: id, p_transfer_code: transferCode });
}

export async function complete(kind, id, providerReference, actorId) {
  return rpc('complete_disbursement', { p_kind: kind, p_id: id, p_provider_reference: providerReference, p_actor: actorId });
}

export async function fail(kind, id, reason, actorId) {
  return rpc('fail_disbursement', { p_kind: kind, p_id: id, p_reason: reason, p_actor: actorId });
}

export async function retry(kind, id, actorId) {
  return rpc('retry_disbursement', { p_kind: kind, p_id: id, p_actor: actorId });
}

/** Store the withdrawal-security evaluation (hold reasons) on the instruction. */
export async function setEvaluation(kind, id, patch) {
  const m = meta(kind);
  return run(db.from(m.table).update(patch).eq('id', id));
}
