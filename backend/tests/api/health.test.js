import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const select = vi.fn();
// Plain function indirection so a simulated network failure is not recorded
// as a thrown spy result (Vitest reports those as test errors).
let limitImpl = (...args) => select(...args);
vi.mock('../../src/integrations/supabase/client.js', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ limit: (...args) => limitImpl(...args) }) }) },
  createAuthClient: vi.fn(),
}));

const { createApp } = await import('../../src/app.js');
const { verifySignature } = await import('../../src/services/paymentService.js');
const app = createApp();

beforeEach(() => {
  select.mockReset();
  limitImpl = (...args) => select(...args);
});

describe('health endpoints', () => {
  it('identifies the service so a port clash with another API is obvious', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: 'ACHIEVER API is running', data: { service: 'achiever-api' } });
  });

  it('reports missing database privileges by name, without secrets', async () => {
    select.mockResolvedValue({ error: { code: '42501', message: 'permission denied for table roles' } });
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.data.checks.database).toMatchObject({ ok: false, code: 'DATABASE_PRIVILEGES' });
    expect(JSON.stringify(res.body)).not.toContain('sk_test_dummy'); // the configured secret itself
  });

  it('is ready when the database answers', async () => {
    select.mockResolvedValue({ error: null });
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.data.ready).toBe(true);
  });

  it('reports an unreachable database instead of throwing', async () => {
    limitImpl = () => Promise.reject(new TypeError('fetch failed'));
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.data.checks.database.code).toBe('DATABASE_UNREACHABLE');
  });
});

describe('webhook signature guard', () => {
  it('rejects non-buffer bodies instead of crashing', () => {
    expect(verifySignature({}, 'abc')).toBe(false);
    expect(verifySignature(Buffer.alloc(0), 'abc')).toBe(false);
    expect(verifySignature(Buffer.from('{}'), undefined)).toBe(false);
  });
});
