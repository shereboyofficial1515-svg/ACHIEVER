import { db, one, run } from '../integrations/supabase/db.js';

const COLUMNS =
  'id, group_id, organizer_id, title, description, starts_at, duration_minutes, status, call_enabled, call_id, created_at, group:osusu_groups(name)';

export async function insert(row) {
  return one(db.from('meetings').insert(row).select(COLUMNS).maybeSingle());
}

export async function find(id) {
  return one(db.from('meetings').select(COLUMNS).eq('id', id).maybeSingle());
}

export async function update(id, patch) {
  return one(db.from('meetings').update(patch).eq('id', id).select(COLUMNS).maybeSingle());
}

export async function listForGroups(groupIds, { upcomingOnly }) {
  if (!groupIds.length) return [];
  let q = db.from('meetings').select(COLUMNS).in('group_id', groupIds).order('starts_at', { ascending: true }).limit(100);
  if (upcomingOnly) {
    q = q.in('status', ['scheduled', 'in_progress']).gte('starts_at', new Date(Date.now() - 6 * 3600 * 1000).toISOString());
  }
  return run(q);
}

export async function findByCall(callId) {
  return one(db.from('meetings').select('id, status').eq('call_id', callId).maybeSingle());
}
