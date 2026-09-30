import { db, one, run } from '../integrations/supabase/db.js';

// Transaction PIN ---------------------------------------------------------------------------------
export async function findCredential(userId) {
  return one(db.from('transaction_credentials').select('user_id, pin_hash, failed_attempts, locked_until, created_at, changed_at')
    .eq('user_id', userId).maybeSingle());
}

export async function upsertCredential(userId, pinHash) {
  const now = new Date().toISOString();
  return one(db.from('transaction_credentials')
    .upsert({ user_id: userId, pin_hash: pinHash, failed_attempts: 0, locked_until: null, changed_at: now }, { onConflict: 'user_id' })
    .select('user_id, created_at, changed_at').maybeSingle());
}

export async function updateCredential(userId, patch) {
  return one(db.from('transaction_credentials').update(patch).eq('user_id', userId).select('user_id, failed_attempts, locked_until').maybeSingle());
}

// Authorisation challenges ------------------------------------------------------------------------
export async function insertChallenge(row) {
  return one(db.from('transaction_auth_challenges').insert(row).select('*').maybeSingle());
}

export async function findChallenge(id) {
  return one(db.from('transaction_auth_challenges').select('*').eq('id', id).maybeSingle());
}

export async function updateChallenge(id, patch) {
  return one(db.from('transaction_auth_challenges').update(patch).eq('id', id).select('*').maybeSingle());
}

/** Single use: only the first caller consumes the challenge. */
export async function consumeChallenge(id) {
  return one(db.from('transaction_auth_challenges').update({ consumed_at: new Date().toISOString() })
    .eq('id', id).is('consumed_at', null).not('verified_at', 'is', null).select('id').maybeSingle());
}

export async function countRecentChallenges(userId, sinceIso) {
  const { count, error } = await db.from('transaction_auth_challenges').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', sinceIso);
  if (error) throw error;
  return count ?? 0;
}

// Device keys (biometric) -------------------------------------------------------------------------
const KEY_COLUMNS = 'id, user_id, public_key, algorithm, label, platform, allow_login, allow_transactions, created_at, last_used_at, revoked_at';

export async function insertDeviceKey(row) {
  return one(db.from('biometric_device_keys').insert(row).select(KEY_COLUMNS).maybeSingle());
}

export async function findDeviceKey(id) {
  return one(db.from('biometric_device_keys').select(KEY_COLUMNS).eq('id', id).maybeSingle());
}

export async function listDeviceKeys(userId) {
  return run(db.from('biometric_device_keys').select(KEY_COLUMNS).eq('user_id', userId).is('revoked_at', null).order('created_at', { ascending: false }));
}

export async function touchDeviceKey(id) {
  return run(db.from('biometric_device_keys').update({ last_used_at: new Date().toISOString() }).eq('id', id).select('id'));
}

export async function revokeDeviceKey(id, userId, reason) {
  return one(db.from('biometric_device_keys').update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq('id', id).eq('user_id', userId).is('revoked_at', null).select(KEY_COLUMNS).maybeSingle());
}

export async function revokeAllDeviceKeys(userId, reason) {
  return run(db.from('biometric_device_keys').update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq('user_id', userId).is('revoked_at', null).select('id'));
}

export async function insertLoginChallenge(row) {
  return one(db.from('device_login_challenges').insert(row).select('*').maybeSingle());
}

export async function findLoginChallenge(id) {
  return one(db.from('device_login_challenges').select('*').eq('id', id).maybeSingle());
}

export async function consumeLoginChallenge(id) {
  return one(db.from('device_login_challenges').update({ consumed_at: new Date().toISOString() })
    .eq('id', id).is('consumed_at', null).select('id').maybeSingle());
}

// Append-only security events ---------------------------------------------------------------------
export async function insertEvent(row) {
  return run(db.from('transaction_security_events').insert(row));
}

export async function listEvents(userId, limit = 30) {
  return run(db.from('transaction_security_events').select('id, type, device_key_id, created_at, metadata')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit));
}
