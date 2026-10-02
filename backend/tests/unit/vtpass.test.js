import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanToken, localPhone, maskIdentifier, maskName, redactProviderPayload, vtpassRequestId } from '../../src/utils/vtpass.js';
import { mapProviderResult } from '../../src/services/vtpass/mapper.js';

describe('VTpass request IDs', () => {
  it('start with the Africa/Lagos date and time (YYYYMMDDHHmm)', () => {
    // 2026-09-30 23:30 UTC is 2026-10-01 00:30 in Lagos (UTC+1).
    const id = vtpassRequestId('abc123', new Date('2026-09-30T23:30:00Z'));
    expect(id).toBe('202610010030abc123');
  });

  it('are unique and alphanumeric after the timestamp', () => {
    const ids = new Set(Array.from({ length: 200 }, () => vtpassRequestId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^\d{12}[a-f0-9]{16}$/);
  });

  it('refuse non-alphanumeric suffixes', () => {
    expect(() => vtpassRequestId('abc-1')).toThrow();
  });
});

describe('VTpass response mapping', () => {
  it('delivered: only code 000 with status "delivered" is success; the token is cleaned', () => {
    const r = mapProviderResult({ json: { code: '000', content: { transactions: { status: 'delivered', transactionId: '1583' } }, purchased_code: 'Token : 1234-5678', units: '79.9 kWh' } });
    expect(r).toMatchObject({ outcome: 'delivered', providerTransactionId: '1583', token: '1234-5678', units: '79.9 kWh' });
  });

  it('an HTTP 200 with status "initiated"/"pending" is PROCESSING, never success', () => {
    expect(mapProviderResult({ httpStatus: 200, json: { code: '000', content: { transactions: { status: 'initiated' } } } }).outcome).toBe('processing');
    expect(mapProviderResult({ json: { code: '099', content: { transactions: { status: 'pending' } } } }).outcome).toBe('processing');
  });

  it('network errors, timeouts and unexpected replies are UNKNOWN (requery), never failed or success', () => {
    const net = mapProviderResult({ networkError: true });
    expect(net).toMatchObject({ outcome: 'processing', unknown: true, retryable: true });
    const odd = mapProviderResult({ json: { code: '777', response_description: '???' } });
    expect(odd).toMatchObject({ outcome: 'processing', unknown: true });
  });

  it('a duplicate/already-used request ID is requeried, not treated as a new failure', () => {
    expect(mapProviderResult({ json: { code: '014', response_description: 'REQUEST ID ALREADY EXIST' } }).outcome).toBe('processing');
    expect(mapProviderResult({ json: { code: '019' } }).outcome).toBe('processing');
  });

  it('explicit failures are FAILED (the customer is refunded)', () => {
    expect(mapProviderResult({ json: { code: '016', content: { transactions: { status: 'failed' } } } }).outcome).toBe('failed');
    expect(mapProviderResult({ json: { code: '018', response_description: 'LOW WALLET BALANCE' } }).outcome).toBe('failed');
  });

  it('reversals (code 040 / status reversed) are REVERSED', () => {
    expect(mapProviderResult({ json: { code: '040', content: { transactions: { status: 'reversed' } } } }).outcome).toBe('reversed');
  });

  it('keeps the provider cost and commission VTpass reports (no hard-coded rate)', () => {
    const r = mapProviderResult({ json: { code: '000', content: { transactions: { status: 'delivered', amount: 320, total_amount: 310.4, commission: 9.6 } } } });
    expect(r).toMatchObject({ outcome: 'delivered', providerCost: 31040, commission: 960, unitAmount: 32000 });
    expect(mapProviderResult({ json: { code: '000', content: { transactions: { status: 'delivered' } } } })).toMatchObject({ providerCost: null, commission: null });
  });

  it('exam PINs come back as a list of serial/PIN pairs', () => {
    const r = mapProviderResult({ json: { code: '000', content: { transactions: { status: 'delivered' } }, purchased_code: 'Serial No:WRN1, pin: 0987', cards: [{ Serial: 'WRN1', Pin: '0987' }] } });
    expect(r.pins).toEqual([{ serial: 'WRN1', pin: '0987' }]);
    expect(r.token).toBeNull();
  });
});

describe('privacy helpers', () => {
  it('redacts tokens, PINs, addresses and keys from stored provider responses', () => {
    const out = redactProviderPayload({ code: '000', purchased_code: 'Token : 1', token: 'x', cards: [{ Pin: '1' }], content: { Address: '12 Allen', Customer_Name: 'A' }, 'secret-key': 'SK_x' });
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/Token : 1|"x"|12 Allen|SK_x/);
    expect(out.code).toBe('000');
    expect(out.content.Customer_Name).toBe('A');
  });

  it('masks names and customer numbers', () => {
    expect(maskName('john adewale okafor')).toBe('John O.');
    expect(maskIdentifier('1234567890123')).toBe('••••••0123');
    expect(localPhone('+2348031234567')).toBe('08031234567');
    expect(cleanToken('Token : 1234')).toBe('1234');
  });
});

describe('VTpass client', () => {
  afterEach(() => vi.resetModules());

  it('uses api-key + public-key for GET and api-key + secret-key for POST, never both secrets', async () => {
    vi.stubEnv('BILL_PROVIDER', 'vtpass');
    vi.stubEnv('VTPASS_API_KEY', 'test-api-key');
    vi.stubEnv('VTPASS_PUBLIC_KEY', 'PK_test');
    vi.stubEnv('VTPASS_SECRET_KEY', 'SK_test');
    const { call } = await import('../../src/services/vtpass/client.js');
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push({ url, headers: init.headers }); return { status: 200, json: async () => ({ code: '000' }) }; };
    await call('GET', '/service-categories', null, { fetchImpl });
    await call('POST', '/requery', { request_id: '1' }, { fetchImpl, kind: 'requery' });
    expect(seen[0].url).toBe('https://sandbox.vtpass.com/api/service-categories');
    expect(seen[0].headers).toMatchObject({ 'api-key': 'test-api-key', 'public-key': 'PK_test' });
    expect(seen[0].headers['secret-key']).toBeUndefined();
    expect(seen[1].headers).toMatchObject({ 'api-key': 'test-api-key', 'secret-key': 'SK_test' });
    expect(seen[1].headers['public-key']).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('refuses to start when VTPASS_ENV and the base URL disagree', async () => {
    vi.stubEnv('VTPASS_ENV', 'sandbox');
    vi.stubEnv('VTPASS_BASE_URL', 'https://vtpass.com/api');
    const { assertEnvironment } = await import('../../src/services/vtpass/client.js');
    expect(() => assertEnvironment()).toThrow(/sandbox/i);
    vi.unstubAllEnvs();
  });

  it('VTPASS_ENV decides the default base URL; production must not point at the sandbox', async () => {
    vi.stubEnv('VTPASS_ENV', 'production');
    const { env } = await import('../../src/config/env.js');
    const c = await import('../../src/services/vtpass/client.js');
    expect(env.vtpassBaseUrl).toBe('https://vtpass.com/api');
    expect(c.environment()).toBe('production');
    expect(() => c.assertEnvironment()).not.toThrow();
    vi.resetModules();
    vi.stubEnv('VTPASS_BASE_URL', 'https://sandbox.vtpass.com/api');
    const c2 = await import('../../src/services/vtpass/client.js');
    expect(() => c2.assertEnvironment()).toThrow(/production/);
    vi.unstubAllEnvs();
  });

  it('a network failure returns networkError instead of throwing', async () => {
    const { call } = await import('../../src/services/vtpass/client.js');
    const r = await call('POST', '/pay', {}, { fetchImpl: async () => { throw new Error('ECONNRESET'); }, kind: 'purchase' });
    expect(r).toMatchObject({ networkError: true, httpStatus: 0 });
  });
});
