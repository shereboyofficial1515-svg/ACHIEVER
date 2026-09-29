import { db } from '../integrations/supabase/db.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/http.js';
import { sha256 } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';

/**
 * Idempotency for money actions (payments, payouts, approvals).
 *
 * With "Idempotency-Key: <8–100 chars>":
 *  - first request: recorded as "processing", then its response is stored
 *  - repeat with the same key and body: the stored response is returned
 *    (header Idempotent-Replayed: true); nothing runs twice
 *  - repeat while the first is still running: 409 REQUEST_IN_PROGRESS
 *  - same key with a different request: 422 IDEMPOTENCY_KEY_REUSED
 * Server errors (5xx) are not stored, so a genuine retry can proceed.
 * Keys are per user and kept for 48 hours.
 */
const KEY = /^[A-Za-z0-9_-]{8,100}$/;
const TTL_MS = 48 * 3600_000;

export const idempotent = asyncHandler(async (req, res, next) => {
  const key = req.get('idempotency-key');
  if (!key) return next();
  if (!KEY.test(key)) throw AppError.badRequest('Idempotency-Key must be 8–100 letters, numbers, dashes or underscores', 'INVALID_IDEMPOTENCY_KEY');
  const userId = req.user?.id;
  if (!userId) return next();

  const requestHash = sha256(`${req.method} ${req.baseUrl}${req.path} ${JSON.stringify(req.body ?? {})}`);
  const { data: inserted, error } = await db.from('idempotency_keys')
    .insert({ user_id: userId, idem_key: key, request_hash: requestHash, method: req.method, path: `${req.baseUrl}${req.path}`.slice(0, 300) })
    .select('id').maybeSingle();

  if (error && error.code !== '23505') throw AppError.unavailable('Could not start this request safely. Please try again.', 'IDEMPOTENCY_UNAVAILABLE');
  if (error) {
    const { data: prior } = await db.from('idempotency_keys')
      .select('id, request_hash, status, response_status, response_body, created_at')
      .eq('user_id', userId).eq('idem_key', key).maybeSingle();
    if (prior && Date.now() - new Date(prior.created_at).getTime() > TTL_MS) {
      await db.from('idempotency_keys').delete().eq('id', prior.id);
      throw AppError.conflict('This request key has expired. Please start again.', 'IDEMPOTENCY_KEY_EXPIRED');
    }
    if (!prior || prior.request_hash !== requestHash) {
      throw AppError.unprocessable('This request key was already used for a different request', 'IDEMPOTENCY_KEY_REUSED');
    }
    if (prior.status !== 'completed') throw AppError.conflict('This request is already being processed', 'REQUEST_IN_PROGRESS');
    res.set('Idempotent-Replayed', 'true');
    return res.status(prior.response_status).json(prior.response_body);
  }

  // Record the outcome when the handler (or the error handler) responds.
  const json = res.json.bind(res);
  res.json = (body) => {
    const status = res.statusCode;
    const done = status >= 500
      ? db.from('idempotency_keys').delete().eq('id', inserted.id)
      : db.from('idempotency_keys').update({ status: 'completed', response_status: status, response_body: body, completed_at: new Date().toISOString() }).eq('id', inserted.id);
    Promise.resolve(done).then(({ error: e } = {}) => e && logger.warn({ code: e.code }, 'idempotency record not saved')).catch(() => {});
    return json(body);
  };
  return next();
});

/** Job: forget old keys. */
export async function purgeExpiredKeys() {
  const { error, count } = await db.from('idempotency_keys').delete({ count: 'exact' }).lt('created_at', new Date(Date.now() - TTL_MS).toISOString());
  if (error) throw error;
  return count ?? 0;
}
