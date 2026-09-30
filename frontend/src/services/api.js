/**
 * API client. Authentication lives in HTTP-only cookies set by the server, so
 * no token is ever stored in JavaScript or localStorage. Mutating requests
 * carry a CSRF token that is held in memory only.
 */
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || 'Request failed');
    this.status = status;
    this.code = body?.error?.code || 'REQUEST_FAILED';
    this.fields = body?.error?.details?.fields || null;
    this.details = body?.error?.details || null;
    this.requestId = body?.error?.requestId;
  }
}

export const NETWORK_MESSAGE = 'Unable to connect to ACHIEVER. Please check your internet connection.';
const SERVER_MESSAGE = 'ACHIEVER is temporarily unable to process this request. Please try again.';
const UNAVAILABLE_MESSAGE = 'ACHIEVER is temporarily unavailable. Please try again shortly.';

/** Error for responses that did not come from the API itself (proxy, gateway, or no response). */
function unavailable(status = 0) {
  if (!status) return new ApiError(0, { message: NETWORK_MESSAGE, error: { code: 'NETWORK_ERROR' } });
  if (status >= 500 && status !== 500) return new ApiError(status, { message: UNAVAILABLE_MESSAGE, error: { code: 'SERVICE_UNAVAILABLE' } });
  if (status === 500) return new ApiError(status, { message: SERVER_MESSAGE, error: { code: 'INTERNAL_ERROR' } });
  if (status === 429) return new ApiError(status, { message: 'Too many requests. Please wait a moment and try again.', error: { code: 'RATE_LIMITED' } });
  if (status === 404) return new ApiError(status, { message: 'That was not found.', error: { code: 'NOT_FOUND' } });
  return new ApiError(status, { message: 'The request could not be completed. Please try again.', error: { code: 'REQUEST_FAILED' } });
}

/**
 * Server errors (5xx) always show a fixed, friendly message; the request id is
 * kept so support can find the matching server log. 4xx messages come from the
 * API and are written for users (validation, 401/403/404/409/422/429).
 */
function fromResponse(status, payload) {
  if (!payload) return unavailable(status);
  const error = new ApiError(status, payload);
  if (status >= 500) error.message = status === 500 ? SERVER_MESSAGE : UNAVAILABLE_MESSAGE;
  return error;
}

const NO_REFRESH = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/csrf', '/auth/password/forgot', '/auth/password/reset'];

let csrfToken = null;
let csrfPromise = null;
let refreshPromise = null;
let onSessionEnded = () => {};
let onStepUpRequired = null;

/** Register a UI handler that asks for the password again; resolves true when confirmed. */
export function setStepUpHandler(fn) {
  onStepUpRequired = fn;
}

export function setSessionEndedHandler(fn) {
  onSessionEnded = fn;
}

async function ensureCsrf(force = false) {
  if (csrfToken && !force) return csrfToken;
  if (!csrfPromise) {
    csrfPromise = fetch(`${BASE}/api/auth/csrf`, { credentials: 'include' })
      .catch(() => null)
      .then(async (r) => {
        const b = r?.ok ? await r.json().catch(() => null) : null;
        if (!b?.data?.csrfToken) throw unavailable(r?.status);
        csrfToken = b.data.csrfToken;
        return csrfToken;
      })
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
}

async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const token = await ensureCsrf();
      const res = await fetch(`${BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': token },
      });
      return res.ok;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function buildQuery(params) {
  if (!params) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

async function request(method, path, { body, params, raw = false, retry = true, signal, idempotencyKey } = {}) {
  const headers = {};
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (method !== 'GET') headers['X-CSRF-Token'] = await ensureCsrf();
  // Money actions: the same key on a retry makes the server return the first result instead of acting twice.
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${BASE}/api${path}${buildQuery(params)}`, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw unavailable(0);
  }

  if (raw && res.ok) return res;
  const payload = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    // Non-JSON errors come from proxies/load balancers, not the API itself.
    const error = fromResponse(res.status, payload);
    if (retry && error.code === 'STEP_UP_REQUIRED' && onStepUpRequired) {
      if (await onStepUpRequired()) return request(method, path, { body, params, raw, retry: false, signal, idempotencyKey });
    }
    // Maintenance mode (switched on in the admin platform): show the maintenance page.
    if (error.code === 'MAINTENANCE_MODE' && typeof window !== 'undefined' && window.location.pathname !== '/maintenance') {
      window.location.replace('/maintenance');
    }
    if (retry && error.code === 'CSRF_INVALID') {
      await ensureCsrf(true);
      return request(method, path, { body, params, raw, retry: false, signal, idempotencyKey });
    }
    // Access cookies expire with the token (~1h); the refresh cookie lasts much
    // longer. Refresh for every call — including /auth/me on page load — except
    // the credential endpoints themselves.
    if (retry && res.status === 401 && ['TOKEN_EXPIRED', 'UNAUTHENTICATED'].includes(error.code) && !NO_REFRESH.some((p) => path.startsWith(p))) {
      if (await refreshSession()) return request(method, path, { body, params, raw, retry: false, signal, idempotencyKey });
      onSessionEnded();
    } else if (res.status === 401 && ['SESSION_EXPIRED', 'SESSION_REVOKED'].includes(error.code)) {
      onSessionEnded();
    }
    throw error;
  }
  return raw ? res : { data: payload?.data, meta: payload?.meta, message: payload?.message };
}

export const api = {
  get: (path, params, opts) => request('GET', path, { params, ...opts }),
  post: (path, body, opts) => request('POST', path, { body, ...opts }),
  put: (path, body, opts) => request('PUT', path, { body, ...opts }),
  patch: (path, body, opts) => request('PATCH', path, { body, ...opts }),
  del: (path, opts) => request('DELETE', path, opts),
  upload: (path, file, extra = {}) => {
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of Object.entries(extra)) if (v) form.append(k, v);
    return request('POST', path, { body: form });
  },
  /** Download a CSV (or other file) returned by the API. */
  download: async (path, params, fallbackName = 'report.csv') => {
    const res = await request('GET', path, { params, raw: true });
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  eventsUrl: () => `${BASE}/api/events/stream`,
  primeCsrf: () => ensureCsrf(),
};

/** A fresh key for one money action (reuse it for retries of that same action). */
export function newIdempotencyKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Absolute URL for an image the API serves (e.g. provider logos); works on the website and in the Android app. */
export function apiAssetUrl(path) {
  if (!path) return null;
  return path.startsWith('/api/') ? `${BASE}${path}` : null;
}
