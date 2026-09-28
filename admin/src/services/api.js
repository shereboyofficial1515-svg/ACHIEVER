/**
 * Admin API client. Authentication is the HTTP-only admin session cookie set by
 * /api/admin/auth; nothing secret is stored in JavaScript, localStorage or the
 * URL. Every call goes to /api/admin/* only. Mutating requests carry the admin
 * CSRF token (held in memory).
 */
const BASE = (import.meta.env.VITE_ADMIN_API_URL || '').replace(/\/$/, '');

export const NETWORK_MESSAGE = 'Unable to connect to ACHIEVER. Please check your internet connection.';
const SERVER_MESSAGE = 'ACHIEVER is temporarily unable to process this request. Please try again.';

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

let csrfToken = null;
let csrfPromise = null;
let onSignedOut = () => {};
let onStepUpRequired = null;

export function setSignedOutHandler(fn) {
  onSignedOut = fn;
}
/** Handler that asks for an authenticator code; resolves true once confirmed. */
export function setStepUpHandler(fn) {
  onStepUpRequired = fn;
}

async function ensureCsrf(force = false) {
  if (csrfToken && !force) return csrfToken;
  if (!csrfPromise) {
    csrfPromise = fetch(`${BASE}/api/admin/auth/csrf`, { credentials: 'include' })
      .catch(() => null)
      .then(async (r) => {
        const b = r?.ok ? await r.json().catch(() => null) : null;
        if (!b?.data?.csrfToken) throw new ApiError(r?.status || 0, { message: r ? SERVER_MESSAGE : NETWORK_MESSAGE, error: { code: r ? 'SERVICE_UNAVAILABLE' : 'NETWORK_ERROR' } });
        csrfToken = b.data.csrfToken;
        return csrfToken;
      })
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
}

function query(params) {
  if (!params) return '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

// Pages call '/admin/...' (the admin API namespace); anything else is refused here.
function url(path, params) {
  if (!path.startsWith('/admin/')) throw new Error(`Admin app can only call /api/admin (got ${path})`);
  return `${BASE}/api${path}${query(params)}`;
}

async function request(method, path, { body, params, raw = false, retry = true } = {}) {
  const target = url(path, params); // throws before any network call for non-admin paths
  const headers = {};
  if (method !== 'GET') headers['X-CSRF-Token'] = await ensureCsrf();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(target, { method, credentials: 'include', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, { message: NETWORK_MESSAGE, error: { code: 'NETWORK_ERROR' } });
  }
  if (raw && res.ok) return res;
  const payload = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const error = new ApiError(res.status, payload || { message: res.status >= 500 ? SERVER_MESSAGE : 'The request could not be completed.', error: { code: res.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'REQUEST_FAILED' } });
    if (res.status >= 500) error.message = SERVER_MESSAGE;
    if (retry && error.code === 'CSRF_INVALID') {
      await ensureCsrf(true);
      return request(method, path, { body, params, raw, retry: false });
    }
    if (retry && error.code === 'STEP_UP_REQUIRED' && onStepUpRequired) {
      if (await onStepUpRequired()) return request(method, path, { body, params, raw, retry: false });
    }
    if (res.status === 401 && ['ADMIN_AUTH_REQUIRED', 'ADMIN_SESSION_EXPIRED'].includes(error.code)) onSignedOut(error);
    throw error;
  }
  return raw ? res : { data: payload?.data, meta: payload?.meta, message: payload?.message };
}

export const api = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  del: (path) => request('DELETE', path),
  /** Download a CSV returned by the API (the export is logged server-side). */
  download: async (path, params, fallbackName = 'report.csv') => {
    const res = await request('GET', path, { params, raw: true });
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || fallbackName;
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  },
  resetCsrf: () => {
    csrfToken = null;
  },
};
