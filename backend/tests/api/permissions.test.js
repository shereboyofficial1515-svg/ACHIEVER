import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Authenticated principals by bearer token (roles/permissions as the DB would resolve them).
const USERS = {
  member: { id: 'u-member', email: 'm@x.ng', roles: ['OSUSU_MEMBER'], permissions: [], emailVerified: true, status: 'active' },
  support: { id: 'u-support', email: 's@x.ng', roles: ['SUPPORT_ADMIN'], permissions: ['overview.read', 'users.read', 'support.tickets'], emailVerified: true, status: 'active' },
  finance: { id: 'u-fin', email: 'f@x.ng', roles: ['FINANCE_ADMIN'], permissions: ['overview.read', 'finance.ledger.read', 'finance.payouts.execute'], emailVerified: true, status: 'active' },
};

vi.mock('../../src/services/authService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveUser: vi.fn(async (token) => {
    const u = USERS[token];
    if (!u) throw Object.assign(new Error('x'), { status: 401, code: 'UNAUTHENTICATED', expose: true });
    return { ...u };
  }),
}));
vi.mock('../../src/services/sessionService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  hasRecentStepUp: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../src/repositories/auditRepository.js', () => ({ insert: vi.fn().mockResolvedValue(null), list: vi.fn() }));
vi.mock('../../src/repositories/userRepository.js', async (importOriginal) => ({
  ...(await importOriginal()),
  search: vi.fn().mockResolvedValue({ rows: [{ id: 'x', full_name: 'Ada Obi', email: 'ada.obi@example.com', phone: '+2348031234567', user_roles: [] }], total: 1 }),
}));

const { createApp } = await import('../../src/app.js');
let app;
beforeAll(() => {
  app = createApp();
});

const get = (path, who) => request(app).get(path).set('Authorization', `Bearer ${who}`);

describe('least-privilege admin API', () => {
  it('members cannot reach the admin console at all', async () => {
    const res = await get('/api/admin/overview', 'member');
    expect(res.status).toBe(403);
  });

  it('support staff cannot read the ledger, security events or audit log', async () => {
    for (const path of ['/api/admin/transactions', '/api/admin/security/events', '/api/admin/audit-logs', '/api/admin/data-access-logs']) {
      const res = await get(path, 'support');
      expect(res.status, path).toBe(403);
      expect(res.body.error.code).toBe('PERMISSION_DENIED');
    }
  });

  it('staff without users.read_sensitive see masked contact details', async () => {
    const res = await get('/api/admin/users', 'support');
    expect(res.status).toBe(200);
    expect(res.body.data[0].email).not.toBe('ada.obi@example.com');
    expect(res.body.data[0].phone).not.toBe('+2348031234567');
  });

  it('finance staff cannot open identity documents', async () => {
    const res = await get('/api/admin/verification/00000000-0000-0000-0000-000000000001/document?reason=checking', 'finance');
    expect(res.status).toBe(403);
  });

  it('sensitive actions require a fresh step-up even with the right permission', async () => {
    const agent = request.agent(app);
    const token = (await agent.get('/api/auth/csrf')).body.data.csrfToken;
    const res = await agent.post('/api/admin/payouts/osusu_payout/00000000-0000-0000-0000-000000000001/confirm')
      .set('Authorization', 'Bearer finance').set('X-CSRF-Token', token).send({ externalReference: 'BANK-REF-1' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STEP_UP_REQUIRED');
  });
});
