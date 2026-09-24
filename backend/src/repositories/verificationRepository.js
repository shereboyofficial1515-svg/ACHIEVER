import { db, one, run, runPaged } from '../integrations/supabase/db.js';
import { toRange } from '../utils/pagination.js';

// Never select id_number_hash into API responses.
const SAFE_COLUMNS =
  'id, user_id, id_type, id_last4, provider, status, name_match, document_path, failure_reason, review_note, created_at, verified_at, ' +
  'document_number_masked, issuing_country, issue_date, expiry_date, liveness_status, liveness_checked_at';

export async function latestForUser(userId) {
  return one(
    db.from('verification_records').select(SAFE_COLUMNS).eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  );
}

export async function identityUsedByOther(idType, hash, userId) {
  const rows = await run(
    db.from('verification_records').select('user_id').eq('id_type', idType).eq('id_number_hash', hash)
      .in('status', ['verified', 'pending', 'manual_review']).neq('user_id', userId).limit(1),
  );
  return rows.length > 0;
}

export async function insert(row) {
  return one(db.from('verification_records').insert(row).select(SAFE_COLUMNS).maybeSingle());
}

export async function update(id, patch) {
  return one(db.from('verification_records').update(patch).eq('id', id).select(SAFE_COLUMNS).maybeSingle());
}

export async function find(id) {
  return one(db.from('verification_records').select(`${SAFE_COLUMNS}, user:profiles!verification_records_user_id_fkey(id, full_name, first_name, last_name, email, date_of_birth)`).eq('id', id).maybeSingle());
}

export async function list({ status, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('verification_records')
    .select(`${SAFE_COLUMNS}, user:profiles!verification_records_user_id_fkey(id, full_name, email)`, { count: 'exact' })
    .order('created_at', { ascending: true }).range(from, to);
  if (status) q = q.eq('status', status);
  return runPaged(q);
}

export async function undertakingsForUser(userId) {
  return run(db.from('admin_undertakings').select('undertaking_version, role_context, accepted_at').eq('user_id', userId));
}

export async function insertUndertaking(row) {
  return run(db.from('admin_undertakings').upsert(row, { onConflict: 'user_id,undertaking_version,role_context', ignoreDuplicates: true }));
}
