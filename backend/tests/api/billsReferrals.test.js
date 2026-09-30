import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VTPASS_WEBHOOK_TOKEN', 'webhook-secret-token-123456');
vi.mock('../../src/repositories/auditRepository.js', () => ({ insert: vi.fn().mockResolvedValue(null), list: vi.fn() }));
vi.mock('../../src/services/billService.js', async (orig) => ({ ...(await orig()), handleWebhook: vi.fn(async () => ({ handled: true })) }));

const { createApp } = await import('../../src/app.js');
const billService = await import('../../src/services/billService.js');
let app;
beforeAll(() => { app = createApp(); });

async function csrfAgent() {
  const agent = request.agent(app);
  const res = await agent.get('/api/auth/csrf');
  return { agent, token: res.body.data.csrfToken };
}

describe('authorisation on the new endpoints', () => {
  it.each([
    ['get', '/api/bills/overview'], ['get', '/api/bills/history'], ['get', '/api/bills/airtime/networks'],
    ['get', '/api/security/transaction-pin'], ['get', '/api/security/biometric/devices'], ['get', '/api/referrals/me'],
  ])('%s %s requires a signed-in member', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  it.each([
    ['post', '/api/bills/quote'], ['post', '/api/bills/00000000-0000-0000-0000-000000000001/confirm'],
    ['put', '/api/security/transaction-pin'], ['post', '/api/push/devices'],
  ])('%s %s requires a session (and CSRF)', async (method, path) => {
    const { agent, token } = await csrfAgent();
    const res = await agent[method](path).set('X-CSRF-Token', token).send({});
    expect(res.status).toBe(401);
  });

  it('admin referral and bill endpoints require an admin session, not a member one', async () => {
    for (const path of ['/api/admin/referrals', '/api/admin/referral-rewards', '/api/admin/bills', '/api/admin/bills/provider-status']) {
      const res = await request(app).get(path);
      expect([401, 403]).toContain(res.status);
    }
  });
});

describe('VTpass webhook', () => {
  it('a wrong or missing token is 404 and nothing is processed', async () => {
    const res = await request(app).post('/api/webhooks/vtpass/guess').send({ type: 'transaction-update', data: { requestId: '202601010000abc' } });
    expect(res.status).toBe(404);
    expect(billService.handleWebhook).not.toHaveBeenCalled();
  });

  it('the configured token is acknowledged with {"response":"success"} and handed to the requery logic', async () => {
    const res = await request(app).post('/api/webhooks/vtpass/webhook-secret-token-123456')
      .send({ type: 'transaction-update', data: { requestId: '202601010000abc', code: '000' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ response: 'success' });
    await new Promise((r) => setTimeout(r, 10));
    expect(billService.handleWebhook).toHaveBeenCalledWith(expect.objectContaining({ type: 'transaction-update' }));
  });
});

describe('biometric sign-in input', () => {
  it('rejects malformed requests before any lookup', async () => {
    const { agent, token } = await csrfAgent();
    const res = await agent.post('/api/auth/biometric/login').set('X-CSRF-Token', token).send({ keyId: 'x', challengeId: 'y', signature: 'z', isBiometric: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
