import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repositories/auditRepository.js', () => ({ insert: vi.fn().mockResolvedValue(null), list: vi.fn() }));
vi.mock('../../src/integrations/livekit/livekitClient.js', () => ({
  receiveWebhook: vi.fn().mockRejectedValue(new Error('bad sig')), createRoomToken: vi.fn(), closeRoom: vi.fn(),
}));

const { createApp } = await import('../../src/app.js');
let app;
beforeAll(() => {
  app = createApp();
});

async function csrf(agent) {
  const res = await agent.get('/api/auth/csrf');
  return res.body.data.csrfToken;
}

describe('HTTP hardening', () => {
  it('serves health with security headers and no x-powered-by', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('returns a consistent JSON error envelope for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'ROUTE_NOT_FOUND' } });
  });

  it('rejects state-changing requests without a CSRF token', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects a CSRF token that does not match the cookie', async () => {
    const agent = request.agent(app);
    await csrf(agent);
    const res = await agent.post('/api/auth/login').set('X-CSRF-Token', 'forged-token-value').send({ email: 'a@b.com', password: 'x' });
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('validates input and reports field errors', async () => {
    const agent = request.agent(app);
    const token = await csrf(agent);
    const res = await agent.post('/api/auth/register').set('X-CSRF-Token', token).send({ email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields).toHaveProperty('email');
    expect(res.body.error.details.fields).toHaveProperty('password');
  });

  it('rejects malformed JSON without leaking parser internals', async () => {
    const agent = request.agent(app);
    const token = await csrf(agent);
    const res = await agent.post('/api/auth/login').set('X-CSRF-Token', token).set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js/);
  });

  it.each([
    ['get', '/api/users/me/dashboard'],
    ['get', '/api/osusu/groups'],
    ['get', '/api/payments/transactions'],
    ['get', '/api/admin/overview'],
    ['get', '/api/messages/conversations'],
    ['get', '/api/events/stream'],
  ])('requires authentication for %s %s', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects Paystack webhooks with an invalid signature', async () => {
    const res = await request(app)
      .post('/api/paystack/webhook')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', 'nope')
      .send(JSON.stringify({ event: 'charge.success', data: { reference: 'x' } }));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('rejects LiveKit webhooks that fail verification', async () => {
    const res = await request(app).post('/api/calls/livekit/webhook').set('Content-Type', 'application/webhook+json').send('{}');
    expect(res.status).toBe(401);
  });

  it('does not reflect CORS headers for unknown origins', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows CORS with credentials for the configured client origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
