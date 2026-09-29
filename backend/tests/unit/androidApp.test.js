import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repositories/auditRepository.js', () => ({ insert: vi.fn().mockResolvedValue(null), list: vi.fn() }));

const { createApp } = await import('../../src/app.js');
const { env } = await import('../../src/config/env.js');
const oauth = await import('../../src/services/oauthService.js');
const app = createApp();

describe('Android app (Capacitor) support', () => {
  it('cookies for the Android app are SameSite=None; Secure, browsers keep Lax', async () => {
    const android = await request(app).get('/api/auth/csrf').set('Origin', env.androidAppOrigin);
    const csrfCookie = android.headers['set-cookie'].find((c) => c.startsWith('ach_csrf='));
    expect(csrfCookie).toMatch(/SameSite=None/);
    expect(csrfCookie).toMatch(/Secure/);
    expect(android.headers['access-control-allow-origin']).toBe(env.androidAppOrigin);
    expect(android.headers['access-control-allow-credentials']).toBe('true');

    const web = await request(app).get('/api/auth/csrf').set('Origin', env.CLIENT_URL);
    expect(web.headers['set-cookie'].find((c) => c.startsWith('ach_csrf='))).toMatch(/SameSite=Lax/);
  });

  it('other origins are still not allowed', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sign-in handoff code is encrypted, tamper-proof and short-lived', () => {
    const url = new URL(oauth.handoffUrl({ kind: 'signin', provider: 'google', next: '/app', user: { id: 'u1' }, session: { access_token: 'AT', refresh_token: 'RT', expires_at: 1 } }));
    expect(url.protocol).toBe(`${env.ANDROID_APP_SCHEME}:`);
    const code = url.searchParams.get('code');
    expect(code).not.toContain('AT'); // tokens are not readable in the link
    expect(oauth.readHandoff(code)).toMatchObject({ k: 'signin', u: 'u1', a: 'AT', r: 'RT' });
    expect(oauth.readHandoff(`${code.slice(0, -2)}xx`)).toBeNull();
    const realNow = Date.now;
    Date.now = () => realNow() + 3 * 60_000;
    try {
      expect(oauth.readHandoff(code)).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it('a cancelled sign-in returns an error to the app, never a session', () => {
    const url = new URL(oauth.handoffUrl(null, 'OAUTH_CANCELLED'));
    expect(url.searchParams.get('error')).toBe('OAUTH_CANCELLED');
    expect(url.searchParams.get('code')).toBeNull();
  });

  it('the handoff endpoint rejects invalid codes', async () => {
    const agent = request.agent(app);
    const token = (await agent.get('/api/auth/csrf')).body.data.csrfToken;
    const res = await agent.post('/api/auth/oauth/handoff').set('X-CSRF-Token', token).send({ code: 'v1.bad.code.here' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('OAUTH_HANDOFF_EXPIRED');
  });
});
