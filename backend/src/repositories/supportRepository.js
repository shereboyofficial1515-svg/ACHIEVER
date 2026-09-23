import { db, one, run, runPaged } from '../integrations/supabase/db.js';
import { likePattern, toRange } from '../utils/pagination.js';

const TICKET_COLUMNS =
  'id, reference, user_id, category, subject, description, status, priority, related_transaction_id, related_group_id, ' +
  'related_collector_saver_id, created_at, updated_at, resolved_at';

export async function insertTicket(row) {
  return one(db.from('support_tickets').insert(row).select(TICKET_COLUMNS).maybeSingle());
}

export async function findTicket(id) {
  return one(
    db.from('support_tickets')
      .select(`${TICKET_COLUMNS}, user:profiles!support_tickets_user_id_fkey(id, full_name, email), assignments:ticket_assignments(assignee_id, active, assigned_at, assignee:profiles!ticket_assignments_assignee_id_fkey(full_name))`)
      .eq('id', id).maybeSingle(),
  );
}

export async function updateTicket(id, patch) {
  return one(db.from('support_tickets').update(patch).eq('id', id).select(TICKET_COLUMNS).maybeSingle());
}

export async function listTickets({ userId, status, priority, category, search, assigneeId, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  const assignJoin = assigneeId ? 'assignments:ticket_assignments!inner(assignee_id, active)' : 'assignments:ticket_assignments(assignee_id, active)';
  let q = db.from('support_tickets')
    .select(`${TICKET_COLUMNS}, user:profiles!support_tickets_user_id_fkey(full_name, email), ${assignJoin}`, { count: 'exact' })
    .order('updated_at', { ascending: false }).range(from, to);
  if (userId) q = q.eq('user_id', userId);
  if (status) q = q.eq('status', status);
  if (priority) q = q.eq('priority', priority);
  if (category) q = q.eq('category', category);
  if (assigneeId) q = q.eq('assignments.assignee_id', assigneeId).eq('assignments.active', true);
  if (search) q = q.or(`reference.ilike.${likePattern(search)},subject.ilike.${likePattern(search)}`);
  return runPaged(q);
}

export async function listMessages(ticketId, { includeInternal }) {
  let q = db.from('ticket_messages').select('id, author_id, body, internal, created_at, author:profiles(full_name)')
    .eq('ticket_id', ticketId).order('created_at');
  if (!includeInternal) q = q.eq('internal', false);
  return run(q);
}

export async function insertMessage(row) {
  return one(db.from('ticket_messages').insert(row).select('id, author_id, body, internal, created_at').maybeSingle());
}

export async function assign(ticketId, assigneeId, assignedBy) {
  await run(db.from('ticket_assignments').update({ active: false }).eq('ticket_id', ticketId).eq('active', true));
  return run(db.from('ticket_assignments').insert({ ticket_id: ticketId, assignee_id: assigneeId, assigned_by: assignedBy }));
}

export async function recentComplaintsAgainstCollector(collectorId, sinceIso) {
  const plans = await run(db.from('collector_savers').select('id').eq('collector_id', collectorId));
  if (!plans.length) return 0;
  const { count, error } = await db.from('support_tickets').select('id', { count: 'exact', head: true })
    .in('related_collector_saver_id', plans.map((p) => p.id)).gte('created_at', sinceIso);
  if (error) throw error;
  return count ?? 0;
}
