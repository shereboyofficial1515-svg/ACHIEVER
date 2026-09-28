import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The admin API trusts ONLY the admin session cookie (password + authenticator
 * app). Member sign-ins — even for an account that holds staff roles — never
 * reach it, and each admin route checks a specific permission.
 */
const ADMINS = {
  'adm-support': { id: 'a-support', roles: ['SUPPORT_ADMIN'], permissions: ['overview.read', 'users.read', 'support.tickets', 'sms.read'] },
  'adm-finance': { id: 'a-fin', roles: ['FINANCE_ADMIN'], permissions: ['overview.read', 'users.read', 'finance.ledger.read', 'finance.payouts.execute', 'finance.reversal.request', 'finance.reversal.approve', 'settings.read', 'reports.export'] },
  'adm-readonly': { id: 'a-ro', roles: ['READ_ONLY_ADMIN'], permissions: ['overview.read', 'users.read', 'settings.read'] },
  'adm-super': { id: 'a-super', roles: ['SUPER_ADMIN'], permissions: ['overview.read', 'users.read', 'users.manage_status', 'roles.manage', 'settings.read', 'settings.manage', 'sms.read', 'sms.configure', 'admins.read', 'admins.manage'] },
};
const MEMBERS = {
  // An ordinary sign-in of an account that also holds SUPER_ADMIN in the database.
  'member-with-staff-role': { id: 'u-1', email: 'x@x.ng', roles: ['OSUSU_MEMBER', 'SUPER_ADMIN'], permissions: ['users.read', 'settings.manage'], emailVerified: true, status: 'active' },
};

const stepUp = vi.fn().mockResolvedValue(false);
vi.mock('../../src/services/adminAuthService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  authenticate: vi.fn(async (token) => {
    const a = ADMINS[token];
    if (!a) {
      const { AppError } = await import('../../src/utils/AppError.js');
      throw AppError.unauthorized('Please sign in to the admin platform', 'ADMIN_AUTH_REQUIRED');
    }
    return { session: { id: `s-${a.id}` }, user: { ...a, email: `${a.id}@x.ng`, status: 'active', sessionId: null, isAdmin: true } };
  }),
  hasRecentStepUp: (...args) => stepUp(...args),
}));
vi.mock('../../src/services/authService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveUser: vi.fn(async (token) => {
    const u = MEMBERS[token];
    if (!u) throw Object.assign(new Error('x'), { status: 401, code: 'UNAUTHENTICATED', expose: true });
    return { ...u };
  }),
}));
vi.mock('../../src/repositories/auditRepository.js', () => ({ insert: vi.fn().mockResolvedValue(null), list: vi.fn() }));
vi.mock('../../src/repositories/userRepository.js', async (importOriginal) => ({
  ...(await importOriginal()),
  search: vi.fn().mockResolvedValue({ rows: [{ id: 'x', full_name: 'Ada Obi', email: 'ada.obi@example.com', phone: '+2348031234567', user_roles: [] }], total: 1 }),
  findById: vi.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-000000000009', full_name: 'Target', user_roles: [], account_status: 'active' }),
}));

const { createApp } = await import('../../src/app.js');
let app;
beforeAll(() => {
  app = createApp();
});
beforeEach(() => stepUp.mockResolvedValue(false));

const asAdmin = (who) => ({ Cookie: `ach_adm=${who}` });
const adminGet = (path, who) => request(app).get(path).set(asAdmin(who));
async function adminAgent(who) {
  const agent = request.agent(app);
  const token = (await agent.get('/api/admin/auth/csrf')).body.data.csrfToken;
  return { agent, token, send: (method, path, body) => agent[method](path).set('Cookie', `ach_adm=${who}`).set('X-CSRF-Token', token).send(body) };
}

describe('member sign-ins never reach the admin API', () => {
  it('a member bearer token is ignored, even for an account holding SUPER_ADMIN', async () => {
    const res = await request(app).get('/api/admin/overview').set('Authorization', 'Bearer member-with-staff-role');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ADMIN_AUTH_REQUIRED');
  });

  it('a member session cookie is ignored', async () => {
    const res = await request(app).get('/api/admin/users').set('Cookie', 'ach_at=member-with-staff-role');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ADMIN_AUTH_REQUIRED');
  });

  it('a forged admin cookie is rejected', async () => {
    const res = await request(app).get('/api/admin/dashboard').set('Cookie', 'ach_adm=made-up-token');
    expect(res.status).toBe(401);
  });

  it('members cannot change SMS settings, roles or account status through the admin API', async () => {
    for (const [method, path] of [['put', '/api/admin/sms'], ['post', '/api/admin/users/00000000-0000-0000-0000-000000000009/roles'], ['patch', '/api/admin/users/00000000-0000-0000-0000-000000000009/status']]) {
      const agent = request.agent(app);
      const token = (await agent.get('/api/admin/auth/csrf')).body.data.csrfToken;
      const res = await agent[method](path).set('Authorization', 'Bearer member-with-staff-role').set('X-CSRF-Token', token)
        .send({ verificationEnabled: true, role: 'SUPER_ADMIN', status: 'active', reason: 'trying it' });
      expect(res.status, path).toBe(401);
    }
  });

  it('the member CSRF token does not work for admin requests', async () => {
    const agent = request.agent(app);
    const memberToken = (await agent.get('/api/auth/csrf')).body.data.csrfToken;
    const res = await agent.post('/api/admin/auth/step-up').set('Cookie', 'ach_adm=adm-super').set('X-CSRF-Token', memberToken).send({ code: '123456' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });
});

describe('least-privilege admin roles', () => {
  it('support admins cannot read the ledger, KYC, security events or audit log', async () => {
    for (const path of ['/api/admin/transactions', '/api/admin/kyc', '/api/admin/verification', '/api/admin/security/events', '/api/admin/audit-logs', '/api/admin/data-access-logs', '/api/admin/admins']) {
      const res = await adminGet(path, 'adm-support');
      expect(res.status, path).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    }
  });

  it('staff without users.read_sensitive see masked contact details', async () => {
    const res = await adminGet('/api/admin/users', 'adm-support');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data[0].email).not.toBe('ada.obi@example.com');
    expect(res.body.data[0].phone).not.toBe('+2348031234567');
  });

  it('finance admins cannot open identity documents or change settings', async () => {
    let res = await adminGet('/api/admin/verification/00000000-0000-0000-0000-000000000001/document?reason=checking', 'adm-finance');
    expect(res.status).toBe(403);
    const { send } = await adminAgent('adm-finance');
    res = await send('put', '/api/admin/settings/platform.maintenance_mode', { value: true, reason: 'testing access' });
    expect(res.status).toBe(403);
    res = await send('put', '/api/admin/sms', { verificationEnabled: false, reason: 'testing access' });
    expect(res.status).toBe(403);
  });

  it('an admin without a financial permission cannot execute payouts', async () => {
    const { send } = await adminAgent('adm-support');
    const res = await send('post', '/api/admin/payouts/osusu_payout/00000000-0000-0000-0000-000000000001/confirm', { externalReference: 'BANK-REF-1' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('read-only admins cannot modify anything', async () => {
    const { send } = await adminAgent('adm-readonly');
    for (const [method, path, body] of [
      ['patch', '/api/admin/users/00000000-0000-0000-0000-000000000009/status', { status: 'suspended', reason: 'test only' }],
      ['put', '/api/admin/settings/registration.enabled', { value: false, reason: 'test only' }],
      ['post', '/api/admin/admins', { email: 'a@b.ng', roles: ['AUDITOR'], reason: 'test only' }],
      ['post', '/api/admin/notifications/broadcast', { title: 'Hello', body: 'Test body' }],
    ]) {
      const res = await send(method, path, body);
      expect(res.status, path).toBe(403);
    }
  });

  it('sensitive actions need a fresh authenticator code even with the right permission', async () => {
    const { send } = await adminAgent('adm-finance');
    const res = await send('post', '/api/admin/payouts/osusu_payout/00000000-0000-0000-0000-000000000001/confirm', { externalReference: 'BANK-REF-1' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STEP_UP_REQUIRED');
  });

  it('staff roles cannot be granted from the user screens, only through administrator management', async () => {
    stepUp.mockResolvedValue(true);
    const { send } = await adminAgent('adm-super');
    const res = await send('post', '/api/admin/users/00000000-0000-0000-0000-000000000009/roles', { role: 'FINANCE_ADMIN' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('USE_ADMIN_MANAGEMENT');
  });

  it('every setting change needs a reason', async () => {
    stepUp.mockResolvedValue(true);
    const { send } = await adminAgent('adm-super');
    const res = await send('put', '/api/admin/settings/registration.enabled', { value: false });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields).toHaveProperty('reason');
  });
});
