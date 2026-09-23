import { db, one, run } from '../integrations/supabase/db.js';

export async function latest(userId, purpose) {
  return one(
    db.from('otp_codes').select('*').eq('user_id', userId).eq('purpose', purpose)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  );
}

export async function invalidateOpen(userId, purpose) {
  return run(
    db.from('otp_codes').update({ consumed_at: new Date().toISOString() })
      .eq('user_id', userId).eq('purpose', purpose).is('consumed_at', null),
  );
}

export async function create(row) {
  return run(db.from('otp_codes').insert(row));
}

export async function incrementAttempts(id, attempts) {
  return run(db.from('otp_codes').update({ attempts }).eq('id', id));
}

export async function consume(id) {
  return run(db.from('otp_codes').update({ consumed_at: new Date().toISOString() }).eq('id', id).is('consumed_at', null));
}
