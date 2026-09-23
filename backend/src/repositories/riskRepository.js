import { db, one, run, runPaged } from '../integrations/supabase/db.js';
import { toRange } from '../utils/pagination.js';

export async function insert(row) {
  const { error } = await db.from('risk_flags').insert(row);
  // Unique partial index de-duplicates open flags of the same kind.
  if (error && error.code !== '23505') throw error;
}

export async function list({ status, context, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('risk_flags')
    .select('*, subject:profiles!risk_flags_subject_user_id_fkey(full_name, email), group:osusu_groups(name)', { count: 'exact' })
    .order('created_at', { ascending: false }).range(from, to);
  if (status) q = q.eq('status', status);
  if (context) q = q.eq('context', context);
  return runPaged(q);
}

export async function update(id, patch) {
  return one(db.from('risk_flags').update(patch).eq('id', id).select('*').maybeSingle());
}

export async function find(id) {
  return one(db.from('risk_flags').select('*').eq('id', id).maybeSingle());
}

export async function openForUser(userId) {
  return run(db.from('risk_flags').select('id, reason_code, status, created_at').eq('subject_user_id', userId).in('status', ['review_required', 'risk_review']));
}
