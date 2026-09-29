import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory idempotency_keys table behind a tiny PostgREST-like builder.
let rows = [];
let nextId = 1;
function builder() {
  const q = { filters: [], op: 'select', payload: null };
  const match = (r) => q.filters.every(([k, v]) => r[k] === v);
  const api = {
    insert(p) { q.op = 'insert'; q.payload = p; return api; },
    update(p) { q.op = 'update'; q.payload = p; return api; },
    delete() { q.op = 'delete'; return api; },
    select() { return api; },
    eq(k, v) { q.filters.push([k, v]); return api; },
    lt() { return api; },
    async maybeSingle() { return api.then((r) => r); },
    then(resolve) {
      let result;
      if (q.op === 'insert') {
        if (rows.some((r) => r.user_id === q.payload.user_id && r.idem_key === q.payload.idem_key)) result = { data: null, error: { code: '23505' } };
        else {
          const row = { id: nextId++, status: 'processing', created_at: new Date().toISOString(), ...q.payload };
          rows.push(row);
          result = { data: { id: row.id }, error: null };
        }
      } else if (q.op === 'update') {
        rows.filter(match).forEach((r) => Object.assign(r, q.payload));
        result = { data: null, error: null };
      } else if (q.op === 'delete') {
        rows = rows.filter((r) => !match(r));
        result = { data: null, error: null };
      } else {
        result = { data: rows.find(match) ?? null, error: null };
      }
      return Promise.resolve(result).then(resolve);
    },
  };
  return api;
}
vi.mock('../../src/integrations/supabase/db.js', () => ({ db: { from: () => builder() } }));

const { idempotent } = await import('../../src/middleware/idempotency.js');
const { errorHandler } = await import('../../src/middleware/errorHandler.js');

let charges = 0;
let slow = null;
function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { id: req.get('x-user') || 'u1' }; next(); });
  a.post('/pay', idempotent, async (req, res) => {
    if (slow) await slow;
    charges += 1;
    res.status(201).json({ success: true, data: { reference: `REF-${charges}`, amount: req.body.amount } });
  });
  a.post('/fail', idempotent, (_req, res) => res.status(500).json({ success: false }));
  a.use(errorHandler);
  return a;
}

beforeEach(() => {
  rows = [];
  charges = 0;
  slow = null;
});

describe('idempotency keys for money actions', () => {
  it('a repeated request with the same key does not charge twice and returns the first result', async () => {
    const a = app();
    const first = await request(a).post('/pay').set('Idempotency-Key', 'key-12345678').send({ amount: 5000 });
    const second = await request(a).post('/pay').set('Idempotency-Key', 'key-12345678').send({ amount: 5000 });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(charges).toBe(1);
  });

  it('a double tap while the first is still running gets REQUEST_IN_PROGRESS', async () => {
    const a = app();
    let release;
    slow = new Promise((r) => { release = r; });
    const first = request(a).post('/pay').set('Idempotency-Key', 'key-abcdefgh').send({ amount: 5000 }).then((r) => r);
    await new Promise((r) => setTimeout(r, 30));
    const second = await request(a).post('/pay').set('Idempotency-Key', 'key-abcdefgh').send({ amount: 5000 });
    release();
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('REQUEST_IN_PROGRESS');
    expect((await first).status).toBe(201);
    expect(charges).toBe(1);
  });

  it('reusing a key for a different request is refused', async () => {
    const a = app();
    await request(a).post('/pay').set('Idempotency-Key', 'key-reused-1').send({ amount: 5000 });
    const other = await request(a).post('/pay').set('Idempotency-Key', 'key-reused-1').send({ amount: 9000 });
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(charges).toBe(1);
  });

  it('keys are per user, new keys run normally, and server errors are not stored', async () => {
    const a = app();
    await request(a).post('/pay').set('Idempotency-Key', 'shared-key-1').set('x-user', 'u1').send({ amount: 1 });
    await request(a).post('/pay').set('Idempotency-Key', 'shared-key-1').set('x-user', 'u2').send({ amount: 1 });
    await request(a).post('/pay').set('Idempotency-Key', 'another-key-2').send({ amount: 1 });
    expect(charges).toBe(3);
    await request(a).post('/fail').set('Idempotency-Key', 'failing-key-1').send({});
    await new Promise((r) => setTimeout(r, 10));
    expect(rows.some((r) => r.idem_key === 'failing-key-1')).toBe(false);
  });

  it('rejects malformed keys and works unchanged without a key', async () => {
    const a = app();
    const bad = await request(a).post('/pay').set('Idempotency-Key', 'bad key!').send({ amount: 1 });
    expect(bad.status).toBe(400);
    const none = await request(a).post('/pay').send({ amount: 1 });
    expect(none.status).toBe(201);
  });
});
