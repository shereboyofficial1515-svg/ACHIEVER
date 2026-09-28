import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, setStepUpHandler } from './api.js';

function respond(status, body, headers = { 'content-type': 'application/json' }) {
  return Promise.resolve({ ok: status < 400, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: () => Promise.resolve(body) });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setStepUpHandler(null);
  api.resetCsrf();
});

describe('admin API client', () => {
  it('only calls the admin namespace', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(api.get('/auth/me')).rejects.toThrow(/only call \/api\/admin/);
    await expect(api.get('/users/me/dashboard')).rejects.toThrow(/only call \/api\/admin/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends the admin CSRF token and cookies, never an Authorization header', async () => {
    const fetchMock = vi.fn((url) => (url.endsWith('/api/admin/auth/csrf')
      ? respond(200, { data: { csrfToken: 'tok' } })
      : respond(200, { data: { ok: true } })));
    vi.stubGlobal('fetch', fetchMock);
    await api.post('/admin/admins', { email: 'a@b.ng' });
    const [url, init] = fetchMock.mock.calls.at(-1);
    expect(url).toBe('/api/admin/admins');
    expect(init.credentials).toBe('include');
    expect(init.headers['X-CSRF-Token']).toBe('tok');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('asks for an authenticator code on STEP_UP_REQUIRED and retries once', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.endsWith('/csrf')) return respond(200, { data: { csrfToken: 'tok' } });
      calls += 1;
      return calls === 1 ? respond(403, { message: 'confirm', error: { code: 'STEP_UP_REQUIRED' } }) : respond(200, { data: { done: true } });
    }));
    const handler = vi.fn().mockResolvedValue(true);
    setStepUpHandler(handler);
    const { data } = await api.patch('/admin/users/1/status', { status: 'restricted' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(data.done).toBe(true);
  });

  it('shows friendly messages for server and network failures', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(500, { message: 'db exploded at line 3', error: { code: 'INTERNAL_ERROR', requestId: 'r1' } })));
    await expect(api.get('/admin/dashboard')).rejects.toMatchObject({ message: 'ACHIEVER is temporarily unable to process this request. Please try again.', requestId: 'r1' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(api.get('/admin/dashboard')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
