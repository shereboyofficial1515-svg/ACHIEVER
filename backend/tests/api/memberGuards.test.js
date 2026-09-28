import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const settings = new Map();
vi.mock('../../src/repositories/settingsRepository.js', () => ({
  get: async (key) => (settings.has(key) ? { key, value: settings.get(key) } : null),
  getFull: async () => null, set: async () => null, getAll: async () => [],
}));
vi.mock('../../src/repositories/auditRepository.js', () => ({ insert: vi.fn().mockResolvedValue(null), list: vi.fn() }));
vi.mock('../../src/services/oauthService.js', async (importOriginal) => ({ ...(await importOriginal()), enabledProviders: async () => [] }));
vi.mock('../../src/services/authService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveUser: vi.fn(async (token) => ({
    id: 'u1', email: 'u@x.ng', roles: ['OSUSU_MEMBER'], permissions: [], emailVerified: true,
    status: token === 'restricted' ? 'restricted' : token === 'verify' ? 'verification_required' : 'active',
  })),
}));

const { createApp } = await import('../../src/app.js');
const settingsService = await import('../../src/services/settingsService.js');
let app;
beforeAll(() => {
  app = createApp();
});
beforeEach(() => {
  settings.clear();
  settingsService.clearCache();
});

describe('maintenance mode', () => {
  it('blocks the member app but keeps the status endpoint and admin API reachable', async () => {
    settings.set('platform.maintenance_mode', true);
    let res = await request(app).get('/api/osusu/groups').set('Authorization', 'Bearer member');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ message: 'ACHIEVER is temporarily undergoing maintenance. Please try again soon.', error: { code: 'MAINTENANCE_MODE' } });
    res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.data.maintenance).toBe(true);
    // Admins are never locked out by maintenance mode (they get the normal admin sign-in check).
    res = await request(app).get('/api/admin/dashboard');
    expect(res.body.error.code).toBe('ADMIN_AUTH_REQUIRED');
    res = await request(app).get('/api/admin/auth/csrf');
    expect(res.status).toBe(200);
  });

  it('does nothing when switched off', async () => {
    const res = await request(app).get('/api/status');
    expect(res.body.data.maintenance).toBe(false);
    expect(res.body.data.verification.phoneVerification).toBe('email_fallback');
  });
});

describe('restricted accounts', () => {
  async function post(token, path, body = {}) {
    const agent = request.agent(app);
    const csrf = (await agent.get('/api/auth/csrf')).body.data.csrfToken;
    return agent.post(path).set('Authorization', `Bearer ${token}`).set('X-CSRF-Token', csrf).send(body);
  }

  it('cannot start payments or change payout details', async () => {
    let res = await post('restricted', '/api/payments/initialize', { purpose: 'osusu_contribution', targetId: '00000000-0000-0000-0000-000000000001' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_RESTRICTED');
    res = await post('verify', '/api/osusu/groups', { name: 'x' });
    expect(res.body.error.code).toBe('VERIFICATION_REQUIRED');
  });
});
