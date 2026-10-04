import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { calls: [], rpcs: [], withdrawal: null, transfer: { status: 'pending', transfer_code: 'TRF_9' }, recent: [], vt: {} };

vi.mock('../../src/config/env.js', () => ({
  env: { features: { transfers: true }, VTPASS_API_KEY: 'k-api', VTPASS_PUBLIC_KEY: 'k-pub', VTPASS_SECRET_KEY: 'k-secret', vtpassBaseUrl: 'https://vtpass.com/api' },
}));
vi.mock('../../src/services/vtpass/client.js', () => ({
  isConfigured: () => true,
  environment: () => 'production',
  call: vi.fn(async (method, path) => {
    state.calls.push(`${method} ${path}`);
    if (path === '/balance') return { httpStatus: 200, latencyMs: 210, json: state.vt.balance ?? { code: 1, contents: { balance: 12500.5 } } };
    if (path === '/service-categories') return { httpStatus: 200, latencyMs: 90, json: { response_description: '000', content: ['airtime', 'data', 'electricity-bill', 'tv-subscription'].map((identifier) => ({ identifier })) } };
    if (path.startsWith('/services?identifier=airtime')) return { httpStatus: 200, latencyMs: 80, json: { content: ['mtn', 'airtel', 'glo', 'etisalat'].map((serviceID) => ({ serviceID })) } };
    return { httpStatus: 404, json: null };
  }),
}));
const chain = (result) => {
  const q = { select: () => q, not: () => q, order: () => q, limit: () => q, eq: () => q, in: () => q, lt: () => q, upsert: () => q, update: () => q, insert: () => q, single: () => q, maybeSingle: () => q, then: (r) => Promise.resolve(result()).then(r) };
  return q;
};
vi.mock('../../src/integrations/supabase/db.js', () => ({
  db: { from: (t) => chain(() => (t === 'bill_payments' ? state.recent : t === 'business_withdrawals' ? state.withdrawal : [])) },
  run: async (q) => (await q) ?? [],
  one: async (q) => await q,
  rpc: vi.fn(async (fn, params) => {
    state.rpcs.push([fn, params]);
    if (fn === 'business_withdrawal_request') return { id: 'w1', status: params.p_amount >= 5_000_000 ? 'PENDING_APPROVAL' : 'PENDING' };
    return {};
  }),
}));
vi.mock('../../src/integrations/paystack/paystackClient.js', () => ({
  paystack: {
    createTransferRecipient: vi.fn(async () => ({ recipient_code: 'RCP_CO' })),
    initiateTransfer: vi.fn(async (b) => { state.calls.push(`transfer ${b.reference} ${b.amount}`); if (state.transfer instanceof Error) throw state.transfer; return state.transfer; }),
    verifyTransfer: vi.fn(async () => ({ status: 'success' })),
    resolveAccount: vi.fn(async () => ({ account_name: 'ACHIEVER TECHNOLOGIES LTD' })),
  },
}));
vi.mock('../../src/services/paymentService.js', () => ({ listBanks: async () => [{ code: '058', name: 'Guaranty Trust Bank' }] }));
vi.mock('../../src/services/auditService.js', () => ({ record: vi.fn(async () => {}) }));
vi.mock('../../src/utils/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/services/settingsService.js', () => ({ getInt: async (_k, d) => d }));

const health = await import('../../src/services/vtpass/health.js');
const business = await import('../../src/services/businessWalletService.js');

beforeEach(() => {
  state.calls = []; state.rpcs = []; state.recent = []; state.vt = {}; state.transfer = { status: 'pending', transfer_code: 'TRF_9' };
  state.withdrawal = { id: 'w1', reference: 'ACH-BWD-261004-ABC', amount: 100000, status: 'PENDING', account: { id: 'a1', account_name: 'ACHIEVER TECHNOLOGIES LTD', account_number: '0123456789', bank_code: '058', recipient_code: null } };
});

describe('VTpass health check (admin)', () => {
  it('reads balance, categories and service IDs — and never buys anything or returns a secret', async () => {
    const r = await health.runHealthCheck();
    expect(state.calls).toEqual(['GET /balance', 'GET /service-categories', 'GET /services?identifier=airtime']);
    expect(r.balance).toBe(1_250_050);
    expect(r.credentials).toEqual({ VTPASS_API_KEY: 'CONFIGURED', VTPASS_PUBLIC_KEY: 'CONFIGURED', VTPASS_SECRET_KEY: 'CONFIGURED' });
    expect(r.environment).toBe('production');
    expect(r.status).toBe('operational');
    expect(JSON.stringify(r)).not.toMatch(/k-api|k-pub|k-secret/);
  });

  it('reports the real reason purchases fail (028 product not whitelisted) instead of "operational"', async () => {
    state.recent = [{ last_provider_code: '028' }, { last_provider_code: '028' }, { last_provider_code: '000' }];
    const r = await health.runHealthCheck();
    expect(r.status).toBe('degraded');
    expect(r.checks.find((c) => c.name === 'recent_purchases')).toMatchObject({ ok: false, code: '028' });
    expect(r.recentPurchaseCodes).toContainEqual({ code: '028', count: 2, meaning: expect.stringMatching(/Product not whitelisted/) });
  });

  it('explains the account-level codes', () => {
    expect(health.describeCode('018')).toMatch(/Low wallet balance/);
    expect(health.describeCode('023')).toMatch(/API access not enabled/);
    expect(health.describeCode('027')).toMatch(/IP address not whitelisted/);
  });
});

describe('business withdrawals', () => {
  it('a booked withdrawal is sent once with its fixed reference and is only PROCESSING after HTTP 200', async () => {
    await business.dispatch(state.withdrawal);
    expect(state.calls).toEqual(['transfer ACH-BWD-261004-ABC 100000']);
    expect(state.rpcs).toEqual([['business_withdrawal_processing', { p_id: 'w1', p_transfer_code: 'TRF_9', p_provider_status: 'pending' }]]);
  });

  it('a provider rejection returns the money to revenue; a network error keeps it booked for a retry', async () => {
    state.transfer = Object.assign(new Error('Your balance is not enough to fulfil this request'), { providerStatus: 400 });
    await business.dispatch(state.withdrawal);
    expect(state.rpcs.at(-1)[0]).toBe('business_withdrawal_fail');
    state.rpcs = [];
    state.transfer = Object.assign(new Error('timeout'), {});
    await expect(business.dispatch(state.withdrawal)).rejects.toThrow('timeout');
    expect(state.rpcs).toEqual([]);   // nothing changed: still PENDING, same reference next time
  });

  it('large withdrawals wait for a second admin (nothing is sent yet)', async () => {
    await business.requestWithdrawal({ id: 'admin1' }, { amount: 10_000_000, reason: 'Quarterly revenue' }, 'idem', {});
    expect(state.calls.filter((c) => c.startsWith('transfer'))).toEqual([]);
  });

  it('webhook events settle it; a success webhook completes the withdrawal', async () => {
    await business.handleTransferEvent('transfer.success', { reference: 'ACH-BWD-261004-ABC' });
    expect(state.rpcs).toEqual([['business_withdrawal_complete', { p_id: 'w1' }]]);
  });
});
