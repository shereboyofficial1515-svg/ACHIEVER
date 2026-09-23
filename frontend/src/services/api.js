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
    this.requestId = body?.error?.requestId;
  }
}

function unavailable(status = 0) {
  return new ApiError(status, {
    message: status ? 'ACHIEVER is temporarily unavailable. Please try again shortly.' : 'Network error. Check your connection and try again.',
    error: { code: status ? 'SERVICE_UNAVAILABLE' : 'NETWORK_ERROR' },
  });
}

let csrfToken = null;
let csrfPromise = null;
let refreshPromise = null;
let onSessionEnded = () => {};

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

async function request(method, path, { body, params, raw = false, retry = true, signal } = {}) {
  const headers = {};
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (method !== 'GET') headers['X-CSRF-Token'] = await ensureCsrf();
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
    throw new ApiError(0, { message: 'Network error. Check your connection and try again.', error: { code: 'NETWORK_ERROR' } });
  }

  if (raw && res.ok) return res;
  const payload = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    // Non-JSON errors come from proxies/load balancers, not the API itself.
    const error = payload ? new ApiError(res.status, payload) : unavailable(res.status);
    if (retry && error.code === 'CSRF_INVALID') {
      await ensureCsrf(true);
      return request(method, path, { body, params, raw, retry: false, signal });
    }
    if (retry && res.status === 401 && ['TOKEN_EXPIRED', 'UNAUTHENTICATED'].includes(error.code) && !path.startsWith('/auth/')) {
      if (await refreshSession()) return request(method, path, { body, params, raw, retry: false, signal });
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
