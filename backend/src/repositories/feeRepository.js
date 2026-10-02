import { db, one, rpc, run } from '../integrations/supabase/db.js';

const COLUMNS = 'id, code, service, version, fee_type, fixed_amount, percentage, tiers, minimum_fee, maximum_fee, minimum_transaction_amount, ' +
  'maximum_transaction_amount, fee_bearing_mode, enabled, currency, status, effective_from, effective_until, reason, created_by, approved_by, ' +
  'approved_at, decision_reason, created_at, updated_at, creator:profiles!fee_configurations_created_by_fkey(full_name), ' +
  'approver:profiles!fee_configurations_approved_by_fkey(full_name)';

/** The single fee calculator lives in the database (fee_quote); this is a thin wrapper. */
export const quote = (service, amount) => rpc('fee_quote', { p_service: service, p_amount: amount });

export async function listAll() {
  return run(db.from('fee_configurations').select(COLUMNS).order('service').order('version', { ascending: false }));
}

export async function history(service) {
  return run(db.from('fee_configurations').select(COLUMNS).eq('service', service).order('version', { ascending: false }));
}

export async function find(id) {
  return one(db.from('fee_configurations').select(COLUMNS).eq('id', id).maybeSingle());
}

export const propose = (actorId, payload) => rpc('propose_fee_configuration', { p_actor: actorId, p: payload });
export const decide = (id, actorId, approve, reason) => rpc('decide_fee_configuration', { p_id: id, p_actor: actorId, p_approve: approve, p_reason: reason });
export const cancel = (id, actorId) => rpc('cancel_fee_configuration', { p_id: id, p_actor: actorId });
export const revenue = (from, to) => rpc('fee_revenue_report', { p_from: from ?? null, p_to: to ?? null });
