import { db, runPaged } from '../integrations/supabase/db.js';
import { toRange } from '../utils/pagination.js';

export async function insert(row) {
  const { error } = await db.from('audit_logs').insert(row);
  return error;
}

export async function list({ actorId, action, resourceType, resourceId, from: fromDate, to: toDate, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db
    .from('audit_logs')
    .select('id, actor_id, action, resource_type, resource_id, result, ip_address, metadata, created_at, profiles(full_name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (actorId) q = q.eq('actor_id', actorId);
  if (action) q = q.ilike('action', `${action.replace(/[%_]/g, '')}%`);
  if (resourceType) q = q.eq('resource_type', resourceType);
  if (resourceId) q = q.eq('resource_id', resourceId);
  if (fromDate) q = q.gte('created_at', fromDate);
  if (toDate) q = q.lte('created_at', toDate);
  return runPaged(q);
}
