import { db, one, run, runPaged } from '../integrations/supabase/db.js';
import { likePattern, toRange } from '../utils/pagination.js';

const TICKET_COLUMNS =
  'id, reference, user_id, category, subject, description, status, priority, related_transaction_id, related_group_id, ' +
  'related_collector_saver_id, created_at, updated_at, resolved_at, case_number, respondent_user_id, collector_id, amount, ' +
  'resolution, resolution_outcome';

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

export async function listTickets({ userId, partyId, status, priority, category, search, assigneeId, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  const assignJoin = assigneeId ? 'assignments:ticket_assignments!inner(assignee_id, active)' : 'assignments:ticket_assignments(assignee_id, active)';
  let q = db.from('support_tickets')
    .select(`${TICKET_COLUMNS}, user:profiles!support_tickets_user_id_fkey(full_name, email), ${assignJoin}`, { count: 'exact' })
    .order('updated_at', { ascending: false }).range(from, to);
  if (userId) q = q.eq('user_id', userId);
  if (partyId) q = q.or(`user_id.eq.${partyId},respondent_user_id.eq.${partyId}`);
  if (status) q = q.eq('status', status);
  if (priority) q = q.eq('priority', priority);
  if (category) q = q.eq('category', category);
  if (assigneeId) q = q.eq('assignments.assignee_id', assigneeId).eq('assignments.active', true);
  if (search) q = q.or(`reference.ilike.${likePattern(search)},case_number.ilike.${likePattern(search)},subject.ilike.${likePattern(search)}`);
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

// Dispute cases: linked transactions, case timeline, evidence (all append-only) ---------------
export async function linkTransaction(row) {
  const { error } = await db.from('case_transactions').insert(row);
  if (error && error.code !== '23505') throw error;
}

export async function caseTransactions(caseId) {
  return run(db.from('case_transactions')
    .select('transaction_id, note, linked_at, transaction:transactions(id, reference, type, direction, amount, status, created_at)')
    .eq('case_id', caseId).order('linked_at'));
}

export async function casesForTransaction(transactionId) {
  const linked = await run(db.from('case_transactions').select('case_id').eq('transaction_id', transactionId));
  const ids = linked.map((l) => l.case_id);
  let q = db.from('support_tickets').select('id, case_number, category, status, created_at');
  q = ids.length ? q.or(`related_transaction_id.eq.${transactionId},id.in.(${ids.join(',')})`) : q.eq('related_transaction_id', transactionId);
  return run(q);
}

export async function addCaseEvent(row) {
  return run(db.from('case_events').insert(row));
}

export async function caseEvents(caseId) {
  return run(db.from('case_events').select('id, event_type, details, created_at, actor:profiles(full_name)').eq('case_id', caseId).order('created_at'));
}

export async function insertEvidence(row) {
  return one(db.from('dispute_evidence').insert(row).select('*').maybeSingle());
}

export async function listEvidence(caseId) {
  return run(db.from('dispute_evidence')
    .select('id, evidence_type, source, description, storage_path, mime_type, size_bytes, sha256, linked_record_type, linked_record_id, supersedes_id, uploaded_by, created_at, uploader:profiles(full_name)')
    .eq('case_id', caseId).order('created_at'));
}

export async function findEvidence(id) {
  return one(db.from('dispute_evidence').select('*').eq('id', id).maybeSingle());
}

export async function countCasesAgainst(userId, sinceIso) {
  const { count, error } = await db.from('support_tickets').select('id', { count: 'exact', head: true })
    .or(`respondent_user_id.eq.${userId},collector_id.eq.${userId}`).gte('created_at', sinceIso);
  if (error) throw error;
  return count ?? 0;
}
