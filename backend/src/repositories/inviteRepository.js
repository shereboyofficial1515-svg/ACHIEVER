import { db, one, run } from '../integrations/supabase/db.js';

const COLUMNS =
  'id, kind, group_id, collector_account_id, invited_by, email, phone, terms, status, expires_at, accepted_by, accepted_at, created_at';

export async function insert(row) {
  return one(db.from('invites').insert(row).select(COLUMNS).maybeSingle());
}

export async function findByTokenHash(hash) {
  return one(db.from('invites').select(COLUMNS).eq('token_hash', hash).maybeSingle());
}

export async function find(id) {
  return one(db.from('invites').select(COLUMNS).eq('id', id).maybeSingle());
}

/** Conditional update: only pending invites can change state. */
export async function transition(id, patch) {
  return one(db.from('invites').update(patch).eq('id', id).eq('status', 'pending').select(COLUMNS).maybeSingle());
}

/** Undo a claim when the follow-up action fails, so the invitation can be used again. */
export async function reopen(id) {
  return run(db.from('invites').update({ status: 'pending', accepted_by: null, accepted_at: null }).eq('id', id).eq('status', 'accepted'));
}

export async function listForGroup(groupId) {
  return run(db.from('invites').select(COLUMNS).eq('group_id', groupId).order('created_at', { ascending: false }).limit(100));
}

export async function listForCollectorAccount(accountId) {
  return run(db.from('invites').select(COLUMNS).eq('collector_account_id', accountId).order('created_at', { ascending: false }).limit(100));
}

export async function expireOld() {
  return run(db.from('invites').update({ status: 'expired' }).eq('status', 'pending').lt('expires_at', new Date().toISOString()));
}
