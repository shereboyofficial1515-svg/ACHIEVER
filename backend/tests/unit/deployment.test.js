import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/integrations/supabase/client.js', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ limit: async () => ({ error: null }) }) }) },
  createAuthClient: vi.fn(),
}));

const { siteOf, env } = await import('../../src/config/env.js');
const { fetchWithTimeout, withTimeout } = await import('../../src/utils/timeout.js');
const { createApp } = await import('../../src/app.js');

describe('site detection for cookie SameSite', () => {
  it('treats separate Vercel and Render hosts as different sites', () => {
    expect(siteOf('https://achiever.vercel.app')).not.toBe(siteOf('https://achiever-api.onrender.com'));
    expect(siteOf('https://a.vercel.app')).not.toBe(siteOf('https://b.vercel.app'));
  });

  it('treats sub-domains of one custom domain as the same site', () => {
    expect(siteOf('https://app.achiever.ng')).toBe(siteOf('https://api.achiever.ng'));
    expect(siteOf('https://app.achiever.com.ng')).toBe(siteOf('https://api.achiever.com.ng'));
    expect(siteOf('https://app.achiever.com.ng')).not.toBe(siteOf('https://other.com.ng'));
  });

  it('includes the scheme and handles local hosts', () => {
    expect(siteOf('http://localhost:5173')).toBe(siteOf('http://localhost:4100'));
    expect(siteOf('http://achiever.ng')).not.toBe(siteOf('https://achiever.ng'));
  });

  it('defaults to same-site (Lax) cookies when the API is reached through the web app host', () => {
    expect(env.crossSite).toBe(false);
    expect(env.cookieSameSite).toBe('lax');
    expect(env.apiPublicUrl).toBe(env.CLIENT_URL.replace(/\/$/, ''));
  });
});

describe('external call time limits', () => {
  it('aborts a fetch that takes too long', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    try {
      await expect(fetchWithTimeout(20)('https://example.invalid')).rejects.toMatchObject({ name: 'TimeoutError' });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('rejects a slow promise with a TIMEOUT code and passes fast ones through', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'slow')).rejects.toMatchObject({ code: 'TIMEOUT' });
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
  });
});

describe('production HTTP behaviour', () => {
  const app = createApp();

  it('exposes the request id and file name headers to a cross-origin web app', async () => {
    const res = await request(app).get('/api/health').set('Origin', env.CLIENT_URL);
    expect(res.headers['access-control-allow-origin']).toBe(env.CLIENT_URL);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-expose-headers']).toContain('X-Request-Id');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('does not allow unknown origins', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers invalid JSON with a safe 400 and keeps running', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad json');
    expect([400, 403]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\.js/);
    const again = await request(app).get('/api/health');
    expect(again.status).toBe(200);
  });

  it('never returns a stack trace for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'ROUTE_NOT_FOUND' } });
  });
});
