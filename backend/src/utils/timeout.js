/**
 * Time limits for calls to external providers, so a slow or unreachable
 * service can never hold an API request (or a job) open indefinitely.
 */
export const TIMEOUTS = {
  supabase: 30_000, // storage uploads included
  email: 15_000,
  livekit: 10_000,
};

/** fetch() that aborts after `ms`, while still honouring the caller's own signal. */
export function fetchWithTimeout(ms) {
  return (input, init = {}) => {
    const limit = AbortSignal.timeout(ms);
    const signal = init.signal ? AbortSignal.any([init.signal, limit]) : limit;
    return fetch(input, { ...init, signal });
  };
}

/**
 * Retry a READ (GET/HEAD) once when the connection itself failed, e.g. a pooled
 * keep-alive socket that the other side closed while the API was idle. The first
 * request after a quiet period then no longer fails with a 500. Writes (POST,
 * PATCH, DELETE, RPC) are never retried, so nothing can be applied twice; time-outs
 * and HTTP error answers are returned as they are.
 */
export function retryReadsOnce(fetchImpl, { delayMs = 150 } = {}) {
  return async (input, init = {}) => {
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    try {
      return await fetchImpl(input, init);
    } catch (err) {
      const aborted = err?.name === 'AbortError' || err?.name === 'TimeoutError' || init.signal?.aborted;
      if (aborted || !['GET', 'HEAD'].includes(method)) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
      return fetchImpl(input, init);
    }
  };
}

/** Reject with a TIMEOUT error if `promise` has not settled within `ms`. */
export function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${ms}ms`), { code: 'TIMEOUT' })), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}
