import { db, one, run, runPaged, rpc } from '../integrations/supabase/db.js';
import { toRange } from '../utils/pagination.js';

const COLUMNS = 'id, type, category, title, body, data, read_at, created_at';

export async function enqueue({ userId, type, category, title, body, data = {}, dedupeKey = null }) {
  return rpc('enqueue_notification', {
    p_user_id: userId, p_type: type, p_category: category, p_title: title, p_body: body,
    p_data: data, p_dedupe_key: dedupeKey,
  });
}

export async function list(userId, { unreadOnly, page, pageSize }) {
  const { from, to } = toRange({ page, pageSize });
  let q = db.from('notifications').select(COLUMNS, { count: 'exact' }).eq('user_id', userId)
    .order('created_at', { ascending: false }).range(from, to);
  if (unreadOnly) q = q.is('read_at', null);
  return runPaged(q);
}

export async function unreadCount(userId) {
  const { count, error } = await db.from('notifications').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

export async function markRead(userId, id) {
  return one(
    db.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', userId).is('read_at', null).select('id').maybeSingle(),
  );
}

export async function markAllRead(userId) {
  return run(db.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null));
}

// Outbox --------------------------------------------------------------------------
export async function listOutbox(limit = 50) {
  return run(
    db.from('notifications')
      .select('id, user_id, type, category, title, body, data, email_status, sms_status, email_attempts, sms_attempts, created_at')
      .or('email_status.eq.pending,sms_status.eq.pending')
      .order('created_at')
      .limit(limit),
  );
}

export async function findOutboxItem(id) {
  return one(
    db.from('notifications')
      .select('id, user_id, type, category, title, body, data, email_status, sms_status, email_attempts, sms_attempts, created_at')
      .eq('id', id).maybeSingle(),
  );
}

/** Optimistic claim so two workers never send the same message. */
export async function claimChannel(id, channel, currentAttempts) {
  const col = `${channel}_attempts`;
  const statusCol = `${channel}_status`;
  const { data, error } = await db.from('notifications')
    .update({ [col]: currentAttempts + 1 })
    .eq('id', id).eq(statusCol, 'pending').eq(col, currentAttempts)
    .select('id').maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function setChannelStatus(id, channel, status, lastError = null) {
  return run(db.from('notifications').update({ [`${channel}_status`]: status, last_error: lastError }).eq('id', id));
}

export async function countSmsSentToday(userId, sinceIso) {
  const { count, error } = await db.from('notifications').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('sms_status', 'sent').neq('category', 'security').gte('created_at', sinceIso);
  if (error) throw error;
  return count ?? 0;
}
