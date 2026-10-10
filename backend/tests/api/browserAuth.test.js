import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Production-like site configuration: the web app on www., the bare domain also allowed.
// Trailing slashes and capitals in configuration must not break the comparison.
vi.stubEnv('CLIENT_URL', 'https://www.achieverng.site/');
vi.stubEnv('CORS_EXTRA_ORIGINS', 'https://AchieverNG.site/, https://admin.achieverng.site');
vi.mock('../../src/services/oauthService.js', async (importOriginal) => ({ ...(await importOriginal()), enabledProviders: async () => ({ google: true, facebook: true }) }));

const { createApp } = await import('../../src/app.js');
let app;
beforeAll(() => { app = createApp(); });

describe('browser sign-in configuration', () => {
  it('tells the web app where social sign-in must start: the host the provider returns to', async () => {
    const res = await request(app).get('/api/auth/providers');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ google: true, facebook: true, startOrigin: 'https://www.achieverng.site' });
  });

  it('the provider returns to that same host (no double slash from a trailing slash in CLIENT_URL)', async () => {
    const { callbackUrl } = await import('../../src/services/oauthService.js');
    expect(callbackUrl()).toBe('https://www.achieverng.site/api/auth/oauth/callback');
  });

  it('allows configured origins regardless of trailing slash or case, and still refuses others', async () => {
    for (const origin of ['https://www.achieverng.site', 'https://achieverng.site', 'https://admin.achieverng.site']) {
      const res = await request(app).get('/api/auth/providers').set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    }
    const evil = await request(app).get('/api/auth/providers').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('API responses are not cached', () => {
  it('member API answers say no-store', async () => {
    const res = await request(app).get('/api/auth/providers');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
