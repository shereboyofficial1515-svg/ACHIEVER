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

/** Reject with a TIMEOUT error if `promise` has not settled within `ms`. */
export function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${ms}ms`), { code: 'TIMEOUT' })), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}
