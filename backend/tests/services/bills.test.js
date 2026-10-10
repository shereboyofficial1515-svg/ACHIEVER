import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Bill engine end to end with a fake VTpass (behaving like the sandbox's
// documented test numbers) and an in-memory database layer.
vi.stubEnv('BILL_PROVIDER', 'vtpass');
vi.stubEnv('VTPASS_API_KEY', 'k');
vi.stubEnv('VTPASS_PUBLIC_KEY', 'PK_k');
vi.stubEnv('VTPASS_SECRET_KEY', 'SK_k');

const state = { configured: true, bills: new Map(), events: [], responses: [], services: new Map(), products: new Map(), recon: [], requery: {}, calls: [] };

vi.mock('../../src/services/vtpass/client.js', () => ({
  PROVIDER: 'vtpass',
  isConfigured: () => state.configured,
  isSandbox: () => true,
  environment: () => 'sandbox',
  assertEnvironment: () => {},
  call: vi.fn(async (method, path, body) => {
    state.calls.push({ method, path, body });
    const ok = (json) => ({ httpStatus: 200, json, networkError: false });
    if (path === '/service-categories') {
      return ok({ response_description: '000', content: ['airtime', 'data', 'electricity-bill', 'tv-subscription', 'education'].map((identifier) => ({ identifier, name: identifier })) });
    }
    if (path.startsWith('/services?identifier=')) {
      const id = decodeURIComponent(path.split('=')[1]);
      const map = {
        airtime: [{ serviceID: 'mtn', name: 'MTN Airtime VTU', minimium_amount: '50', maximum_amount: '50000' }],
        data: [{ serviceID: 'mtn-data', name: 'MTN Data' }],
        'electricity-bill': [{ serviceID: 'ikeja-electric', name: 'Ikeja Electric Payment - IKEDC', minimium_amount: '500' }],
        'tv-subscription': [{ serviceID: 'dstv', name: 'DSTV Subscription' }],
        education: [{ serviceID: 'waec', name: 'WAEC Result Checker PIN' }],
      };
      return ok({ response_description: '000', content: map[id] || [] });
    }
    if (path.startsWith('/service-variations')) {
      const id = decodeURIComponent(path.split('=')[1]);
      const v = {
        // VTpass really repeats some codes; the duplicate must be ignored, not break the list.
        'mtn-data': [{ variation_code: 'mtn-1gb', name: 'MTN N1000 1.5GB - 30 days', variation_amount: '1000.00', fixedPrice: 'Yes' }, { variation_code: 'mtn-1gb', name: 'duplicate', variation_amount: '1.00', fixedPrice: 'Yes' }],
        dstv: [{ variation_code: 'dstv-padi', name: 'DStv Padi N2,950', variation_amount: '2950.00', fixedPrice: 'Yes' }],
        waec: [{ variation_code: 'waecdirect', name: 'WASSCE', variation_amount: '900', fixedPrice: 'Yes' }],
      }[id] || [];
      return ok({ response_description: '000', content: { ServiceName: id, variations: v } });
    }
    if (path === '/merchant-verify') {
      if (body.billersCode === '1111111111111') return ok({ code: '000', content: { Customer_Name: 'TESTMETER ONE', Address: '12 Hidden Street', Min_Purchase_Amount: 500, Can_Vend: 'yes' } });
      if (body.billersCode === '1212121212') return ok({ code: '000', content: { Customer_Name: 'Test DStv Customer', Status: 'ACTIVE', Renewal_Amount: 4000, Current_Bouquet: 'DStv Padi' } });
      return ok({ code: '000', content: { error: 'This meter is not correct', WrongBillersCode: true } });
    }
    if (path === '/pay') {
      const who = body.billersCode || body.phone;
      if (who === '08011111111' || who === '1111111111111' || who === '1212121212' || body.serviceID === 'waec') {
        return ok({ code: '000', requestId: body.request_id, content: { transactions: { status: 'delivered', transactionId: `VT-${body.request_id}` } },
          purchased_code: body.serviceID === 'waec' ? 'Serial No:WRN1, pin: 0987' : 'Token : 5555-6666', cards: body.serviceID === 'waec' ? [{ Serial: 'WRN1', Pin: '0987' }] : undefined, units: '20 kWh' });
      }
      if (who === '02010000000') return ok({ code: '099', content: { transactions: { status: 'pending' } } });
      if (who === '04000000000') return { httpStatus: 0, json: null, networkError: true };
      return ok({ code: '016', response_description: 'TRANSACTION FAILED', content: { transactions: { status: 'failed' } } });
    }
    if (path === '/requery') return ok(state.requery[body.request_id] || { code: '099', content: { transactions: { status: 'pending' } } });
    return ok({});
  }),
}));

function bill(id) { return state.bills.get(id); }
// Fee engine (the database's fee_quote): fixed fees per service for these tests.
const FEES = { bill_airtime: 5000 };
const quoteFor = (service, amount) => {
  const fee = FEES[service] ?? 0;
  return { service, amount, fee, total_debit: amount + fee, recipient_amount: amount, fee_type: 'FIXED', fee_bearing_mode: 'FEE_ADDED', rule: 'test', fee_version: 1 };
};
vi.mock('../../src/repositories/feeRepository.js', () => ({
  quote: vi.fn(async (service, amount) => quoteFor(service, amount)),
  listAll: vi.fn(async () => []),
}));
vi.mock('../../src/repositories/billRepository.js', () => ({
  insert: vi.fn(async (row) => {
    if ([...state.bills.values()].some((b) => b.provider_request_id === row.provider_request_id)) throw new Error('duplicate key');
    const b = { id: crypto.randomUUID(), attempts: 0, created_at: new Date().toISOString(), payment_reference: null, provider_reference: null,
      provider_transaction_id: null, secure_payload: null, token: null, last_error: null, ...row, fee: FEES[`bill_${row.category}`] ?? 0, total_amount: row.amount + (FEES[`bill_${row.category}`] ?? 0) };
    state.bills.set(b.id, b);
    state.events.push({ bill_id: b.id, to_status: b.status });
    return { ...b };
  }),
  find: vi.fn(async (id) => (bill(id) ? { ...bill(id) } : null)),
  findByRequestId: vi.fn(async (rid) => [...state.bills.values()].find((b) => b.provider_request_id === rid) || null),
  findByIdempotencyKey: vi.fn(async (u, k) => [...state.bills.values()].find((b) => b.user_id === u && b.idempotency_key === k) || null),
  update: vi.fn(async (id, patch, { fromStatus } = {}) => {
    const b = bill(id);
    if (!b || (fromStatus && b.status !== fromStatus)) return null;
    if (patch.status && patch.status !== b.status) state.events.push({ bill_id: id, to_status: patch.status });
    Object.assign(b, patch);
    return { ...b };
  }),
  events: vi.fn(async (id) => state.events.filter((e) => e.bill_id === id).map((e, i) => ({ id: i, to_status: e.to_status, created_at: new Date().toISOString() }))),
  logProviderResponse: vi.fn(async (row) => { state.responses.push(row); }),
  providerResponses: vi.fn(async () => []),
  recordResult: vi.fn(async (p) => {
    const b = bill(p.p_bill_id);
    if (['delivered', 'refund_pending', 'refunded', 'reversed'].includes(b.status)) return { outcome: 'already_final' };
    const to = { delivered: 'delivered', failed: 'refund_pending', processing: 'processing' }[p.p_outcome];
    if (to !== b.status) state.events.push({ bill_id: b.id, to_status: to });
    Object.assign(b, { status: to, secure_payload: p.p_secure_payload ?? b.secure_payload, provider_reference: b.provider_reference ?? p.p_provider_reference,
      last_error: p.p_error, attempts: b.attempts + 1, units: p.p_units });
    return { outcome: p.p_outcome, refund_transaction_id: p.p_outcome === 'failed' ? 'refund-1' : undefined };
  }),
  recordReversal: vi.fn(async (p) => {
    const b = bill(p.p_bill_id);
    if (b.status !== 'delivered') return { outcome: 'already_final' };
    b.status = 'reversed';
    state.events.push({ bill_id: b.id, to_status: 'reversed' });
    return { outcome: 'reversed', refund_transaction_id: 'refund-2' };
  }),
  insertReconciliation: vi.fn(async (row) => { state.recon.push(row); }),
  listDueForRequery: vi.fn(async () => []),
  listPaidNotDispatched: vi.fn(async () => []),
  listStuckProcessing: vi.fn(async () => []),
  cancelStaleAwaiting: vi.fn(async () => []),
  cancelExpiredQuotes: vi.fn(async () => []),
  list: vi.fn(async () => ({ rows: [], total: 0 })),
  findService: vi.fn(async (id) => state.services.get(id) || null),
  updateService: vi.fn(async (id, patch) => Object.assign(state.services.get(id), patch)),
  serviceStats: vi.fn(async () => []),
  listServices: vi.fn(async (category) => [...state.services.values()].filter((s) => !category || s.category === category)),
  upsertServices: vi.fn(async (rows) => { for (const r of rows) state.services.set(r.service_id, { enabled: true, ...state.services.get(r.service_id), ...r }); return rows; }),
  markServicesUnavailable: vi.fn(async (category, keep) => { for (const s of state.services.values()) if (s.category === category && !keep.includes(s.service_id)) s.available = false; return []; }),
  listProducts: vi.fn(async (id) => state.products.get(id) || []),
  replaceProducts: vi.fn(async (id, rows) => {
    if (new Set(rows.map((r) => r.variation_code)).size !== rows.length) throw new Error('ON CONFLICT DO UPDATE command cannot affect row a second time');
    state.products.set(id, rows);
  }),
}));

const txState = { challenges: new Map(), credentials: new Map(), keys: new Map(), events: [] };
vi.mock('../../src/repositories/transactionSecurityRepository.js', () => ({
  findCredential: vi.fn(async (u) => txState.credentials.get(u) || null),
  upsertCredential: vi.fn(async (u, h) => { txState.credentials.set(u, { user_id: u, pin_hash: h, failed_attempts: 0, locked_until: null }); return {}; }),
  updateCredential: vi.fn(async (u, patch) => Object.assign(txState.credentials.get(u), patch)),
  insertChallenge: vi.fn(async (row) => { const c = { attempts: 0, verified_at: null, consumed_at: null, created_at: new Date().toISOString(), ...row }; txState.challenges.set(c.id, c); return { ...c }; }),
  findChallenge: vi.fn(async (id) => (txState.challenges.get(id) ? { ...txState.challenges.get(id) } : null)),
  updateChallenge: vi.fn(async (id, patch) => Object.assign(txState.challenges.get(id), patch)),
  consumeChallenge: vi.fn(async (id) => { const c = txState.challenges.get(id); if (!c || c.consumed_at || !c.verified_at) return null; c.consumed_at = new Date().toISOString(); return { id }; }),
  countRecentChallenges: vi.fn(async () => 0),
  findDeviceKey: vi.fn(async (id) => txState.keys.get(id) || null),
  touchDeviceKey: vi.fn(async () => []),
  insertEvent: vi.fn(async (row) => { txState.events.push(row); }),
}));

const settings = { 'bills.enabled': true, 'bills.maintenance_mode': false, 'bills.categories_enabled': {}, 'bills.fee_kobo': { airtime: 5000 }, 'bills.max_amount_kobo': 10_000_000 };
vi.mock('../../src/services/settingsService.js', () => ({
  get: vi.fn(async (k, d) => settings[k] ?? d), getBool: vi.fn(async (k, d) => settings[k] ?? d), getInt: vi.fn(async (k, d) => settings[k] ?? d),
  maintenanceMode: vi.fn(async () => false),
}));
vi.mock('../../src/services/kycService.js', () => ({ requireLevel: vi.fn(async () => 0) }));
vi.mock('../../src/services/paymentService.js', () => ({ initialize: vi.fn(async () => ({ reference: 'PSK-1', authorizationUrl: 'https://checkout.paystack.com/x', reused: false })) }));
vi.mock('../../src/services/refundService.js', () => ({ processRefund: vi.fn(async () => null) }));
vi.mock('../../src/services/notificationService.js', () => ({ kickDispatcher: vi.fn(), notify: vi.fn(async () => null) }));
vi.mock('../../src/services/auditService.js', () => ({ record: vi.fn(async () => null) }));
const emailed = [];
vi.mock('../../src/services/emailService.js', () => ({ sendSecurityCode: vi.fn(async (_to, _n, code) => { emailed.push(code); return { ok: true }; }) }));
vi.mock('../../src/services/providerHealthService.js', () => ({
  STATUS: { OPERATIONAL: 'operational', UNAVAILABLE: 'unavailable' },
  status: vi.fn(() => state.health || 'operational'), record: vi.fn(), markWebhook: vi.fn(async () => {}), snapshot: vi.fn(async () => ({})),
}));

const billService = await import('../../src/services/billService.js');
const transactionAuth = await import('../../src/services/transactionAuthService.js');
const catalog = await import('../../src/services/vtpass/catalog.js');
const paymentService = await import('../../src/services/paymentService.js');
const billRepo = await import('../../src/repositories/billRepository.js');
const { call } = await import('../../src/services/vtpass/client.js');

const user = { id: 'u-1', email: 'ada@example.com', fullName: 'Ada', sessionId: 's-1', emailVerified: true };
const other = { id: 'u-2', email: 'bola@example.com', fullName: 'Bola', sessionId: 's-2', emailVerified: true };

beforeEach(async () => {
  state.bills.clear(); state.events.length = 0; state.responses.length = 0; state.recon.length = 0; state.calls.length = 0; state.requery = {};
  state.configured = true; state.health = 'operational';
  txState.challenges.clear(); txState.events.length = 0; emailed.length = 0;
  catalog.__resetCache();
  txState.credentials.set(user.id, { user_id: user.id, pin_hash: await transactionAuth.hashPin('482915'), failed_attempts: 0, locked_until: null });
  vi.clearAllMocks();
});

async function approveAndPay(u, review) {
  const ch = await billService.startAuthorization(u, review.billId, { method: 'email_otp', pin: '482915' }, {});
  const out = await billService.confirm(u, review.billId, { challengeId: ch.challengeId, code: emailed.at(-1) }, {});
  // Paystack confirmed the payment (normally via the verified webhook).
  Object.assign(bill(review.billId), { status: 'paid', payment_reference: 'PSK-1' });
  return out;
}

describe('catalogue', () => {
  it('lists only categories VTpass offers; betting and recharge PINs are "currently unavailable", not faked', async () => {
    const o = await billService.overview();
    const byKey = Object.fromEntries(o.categories.map((c) => [c.key, c]));
    expect(byKey.airtime.available).toBe(true);
    expect(byKey.betting).toMatchObject({ available: false, reason: 'NOT_OFFERED' });
    expect(byKey.recharge_pin).toMatchObject({ available: false, reason: 'NOT_OFFERED' });
    await expect(billService.listServices('betting')).rejects.toMatchObject({ code: 'BILL_SERVICE_UNAVAILABLE', message: 'Betting is currently unavailable.' });
  });

  it('returns normalised plans (kobo, validity) rather than raw VTpass data', async () => {
    const plans = await billService.listProducts('data', 'mtn-data');
    expect(plans).toEqual([{ code: 'mtn-1gb', name: 'MTN N1000 1.5GB - 30 days', amount: 100000, fixedPrice: true, validity: '30 days' }]);
  });

  it('shows a clear message when VTpass is not configured or unavailable, and blocks new purchases', async () => {
    state.configured = false;
    await expect(billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2348011111111', amount: 100000 }))
      .rejects.toMatchObject({ code: 'BILL_NOT_CONFIGURED', message: 'Bill payment is temporarily unavailable. Please try again shortly.' });
    state.configured = true;
    state.health = 'unavailable';
    await expect(billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2348011111111', amount: 100000 })).rejects.toMatchObject({ code: 'BILL_PROVIDER_UNAVAILABLE' });
  });
});

describe('review (quote)', () => {
  it('airtime: server computes fee and total; nothing is bought or paid yet', async () => {
    const r = await billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2348011111111', amount: 100000 });
    expect(r).toMatchObject({ amount: 100000, fee: 5000, total: 105000, status: 'AWAITING_AUTHORIZATION', recipient: '08011111111' });
    expect(bill(r.billId).provider_request_id).toMatch(/^\d{12}[a-f0-9]{16}$/);
    expect(state.calls.some((c) => c.path === '/pay')).toBe(false);
    expect(paymentService.initialize).not.toHaveBeenCalled();
  });

  it('data: the price comes from VTpass, never from the client', async () => {
    const r = await billService.quote(user, { category: 'data', serviceId: 'mtn-data', phone: '+2348011111111', variationCode: 'mtn-1gb', amount: 1 });
    expect(r.amount).toBe(100000);
    await expect(billService.quote(user, { category: 'data', serviceId: 'mtn-data', phone: '+2348011111111', variationCode: 'fake-plan' })).rejects.toMatchObject({ code: 'INVALID_PLAN' });
  });

  it('electricity: the meter is verified first; the name is masked and the address never stored', async () => {
    await expect(billService.quote(user, { category: 'electricity', serviceId: 'ikeja-electric', phone: '+2348011111111', meterType: 'prepaid', customerId: '9999999999', amount: 200000 }))
      .rejects.toMatchObject({ code: 'CUSTOMER_NOT_VERIFIED' });
    const r = await billService.quote(user, { category: 'electricity', serviceId: 'ikeja-electric', phone: '+2348011111111', meterType: 'prepaid', customerId: '1111111111111', amount: 200000 });
    expect(r.customerName).toBe('Testmeter O.');
    expect(r.recipient).toBe('••••••1111');
    expect(JSON.stringify(bill(r.billId))).not.toContain('Hidden Street');
  });

  it('cable TV: renewal uses the amount VTpass returned for the smartcard', async () => {
    const r = await billService.quote(user, { category: 'tv', serviceId: 'dstv', phone: '+2348011111111', customerId: '1212121212', subscriptionType: 'renew' });
    expect(r).toMatchObject({ amount: 400000, subscriptionType: 'renew' });
    const c = await billService.quote(user, { category: 'tv', serviceId: 'dstv', phone: '+2348011111111', customerId: '1212121212', subscriptionType: 'change', variationCode: 'dstv-padi' });
    expect(c.amount).toBe(295000);
  });

  it('a repeated request with the same idempotency key returns the same review', async () => {
    const a = await billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2348011111111', amount: 100000 }, 'idem-key-123');
    const b = await billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2348011111111', amount: 100000 }, 'idem-key-123');
    expect(b.billId).toBe(a.billId);
    expect(state.bills.size).toBe(1);
  });
});

describe('authorisation (PIN + emailed code)', () => {
  it('cannot be paid without an approval, with a wrong code, or twice with the same approval', async () => {
    const r = await billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2348011111111', amount: 100000 });
    await expect(billService.confirm(user, r.billId, {}, {})).rejects.toMatchObject({ code: 'TX_AUTH_REQUIRED' });
    await expect(billService.startAuthorization(user, r.billId, { method: 'email_otp', pin: '111222' }, {})).rejects.toMatchObject({ code: 'TRANSACTION_PIN_INVALID' });
    const ch = await billService.startAuthorization(user, r.billId, { method: 'email_otp', pin: '482915' }, {});
    await expect(billService.confirm(user, r.billId, { challengeId: ch.challengeId, code: '000000' }, {})).rejects.toMatchObject({ code: 'TX_AUTH_INVALID' });
    const out = await billService.confirm(user, r.billId, { challengeId: ch.challengeId, code: emailed.at(-1) }, {});
    expect(out.authorizationUrl).toMatch(/paystack/);
    expect(paymentService.initialize).toHaveBeenCalledWith(expect.objectContaining({ amount: 105000, purpose: 'bill_payment' }));
    await expect(billService.confirm(user, r.billId, { challengeId: ch.challengeId, code: emailed.at(-1) }, {})).rejects.toMatchObject({ code: 'BILL_NOT_AWAITING_APPROVAL' });
  });

  it('an expired emailed code is refused', async () => {
    const r = await billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2348011111111', amount: 100000 });
    const ch = await billService.startAuthorization(user, r.billId, { method: 'email_otp', pin: '482915' }, {});
    txState.challenges.get(ch.challengeId).expires_at = new Date(Date.now() - 1000).toISOString();
    await expect(billService.confirm(user, r.billId, { challengeId: ch.challengeId, code: emailed.at(-1) }, {})).rejects.toMatchObject({ code: 'TX_AUTH_EXPIRED' });
  });

  it("another user's approval or bill cannot be used (IDOR)", async () => {
    const r = await billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2348011111111', amount: 100000 });
    await expect(billService.startAuthorization(other, r.billId, { method: 'email_otp', pin: '482915' }, {})).rejects.toMatchObject({ status: 404 });
    await expect(billService.get(other, r.billId)).rejects.toMatchObject({ status: 404 });
    await expect(billService.revealSecrets(other, r.billId, {})).rejects.toMatchObject({ status: 404 });
  });

  it('an approval is bound to the reviewed amount: a changed bill invalidates it', async () => {
    const r = await billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2348011111111', amount: 100000 });
    const ch = await billService.startAuthorization(user, r.billId, { method: 'email_otp', pin: '482915' }, {});
    bill(r.billId).amount = 900000;          // tampering after review
    bill(r.billId).total_amount = 905000;
    await expect(billService.confirm(user, r.billId, { challengeId: ch.challengeId, code: emailed.at(-1) }, {})).rejects.toMatchObject({ code: 'TX_AUTH_INVALID' });
  });
});

describe('receipt data (from the stored bill only)', () => {
  it('electricity: company, masked meter, meter type, units and references; the token is never in the receipt', async () => {
    const r = await billService.quote(user, { category: 'electricity', serviceId: 'ikeja-electric', phone: '+2348011111111', meterType: 'prepaid', customerId: '1111111111111', amount: 200000 });
    await approveAndPay(user, r);
    await billService.fulfil(r.billId);
    const rc = await billService.receipt(user, r.billId);
    expect(rc).toMatchObject({
      status: 'SUCCESS', categoryKey: 'electricity', recipientLabel: 'Meter number', meterType: 'Prepaid', units: '20 kWh',
      amount: 200000, fee: 0, total: 200000, hasSecrets: true, paidWith: 'Paystack (card / transfer / USSD)', paymentReference: 'PSK-1',
    });
    expect(rc.recipient).toMatch(/1111$/);
    expect(rc.recipient).not.toContain('1111111111111');
    expect(rc.providerReference).toBeTruthy();
    expect(JSON.stringify(rc)).not.toContain('5555');
    expect(rc.supportEmail).toBeNull();   // the example.com default is never printed on a receipt
  });

  it('data: network, number, plan and validity; a failed purchase is reported as FAILED, never SUCCESS', async () => {
    await billService.listProducts('data', 'mtn-data');
    const ok = await billService.quote(user, { category: 'data', serviceId: 'mtn-data', phone: '+2348011111111', variationCode: 'mtn-1gb' });
    await approveAndPay(user, ok);
    await billService.fulfil(ok.billId);
    expect(await billService.receipt(user, ok.billId)).toMatchObject({
      status: 'SUCCESS', recipient: '08011111111', recipientLabel: 'Phone number', product: 'MTN N1000 1.5GB - 30 days', validity: '30 days', units: null, meterType: null,
    });

    const bad = await billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2348099999999', amount: 100000 });
    await approveAndPay(user, bad);
    await billService.fulfil(bad.billId);
    expect(await billService.receipt(user, bad.billId)).toMatchObject({ status: 'FAILED', providerReference: null, hasSecrets: false });
  });

  it('no receipt before approval, and none for another member', async () => {
    const r = await billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2348011111111', amount: 100000 });
    await expect(billService.receipt(user, r.billId)).rejects.toMatchObject({ status: 404 });
    await expect(billService.receipt(other, r.billId)).rejects.toBeTruthy();
  });
});

describe('fulfilment', () => {
  it('success: delivered only when VTpass confirms; token sealed, not stored in plain text', async () => {
    const r = await billService.quote(user, { category: 'electricity', serviceId: 'ikeja-electric', phone: '+2348011111111', meterType: 'prepaid', customerId: '1111111111111', amount: 200000 });
    await approveAndPay(user, r);
    await billService.fulfil(r.billId);
    const b = bill(r.billId);
    expect(b.status).toBe('delivered');
    expect(b.secure_payload).toMatch(/^v1\./);
    expect(b.secure_payload).not.toContain('5555');
    expect(JSON.stringify(state.responses)).not.toContain('5555-6666');
    const s = await billService.revealSecrets(user, r.billId, {});
    expect(s.token).toBe('5555-6666');
  });

  it('exam PINs are returned to the owner only on request', async () => {
    const r = await billService.quote(user, { category: 'education', serviceId: 'waec', phone: '+2348011111111', variationCode: 'waecdirect', quantity: 1 });
    await approveAndPay(user, r);
    await billService.fulfil(r.billId);
    expect((await billService.revealSecrets(user, r.billId, {})).pins).toEqual([{ serial: 'WRN1', pin: '0987' }]);
    expect((await billService.get(user, r.billId)).hasSecrets).toBe(true);
    expect(JSON.stringify(await billService.get(user, r.billId))).not.toContain('0987');
  });

  it('failure: FAILED and a refund is started', async () => {
    const r = await billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2348099999999', amount: 100000 });
    await approveAndPay(user, r);
    await billService.fulfil(r.billId);
    expect(bill(r.billId).status).toBe('refund_pending');
    expect((await billService.get(user, r.billId)).status).toBe('FAILED');
  });

  it('pending: PROCESSING; a later requery confirms; the purchase is never sent twice', async () => {
    const r = await billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2342010000000', amount: 100000 });
    await approveAndPay(user, r);
    await billService.fulfil(r.billId);
    expect(bill(r.billId).status).toBe('processing');
    expect((await billService.get(user, r.billId)).status).toBe('PROCESSING');
    await billService.fulfil(r.billId);                           // still pending on requery
    state.requery[bill(r.billId).provider_request_id] = { code: '000', content: { transactions: { status: 'delivered', transactionId: 'T9' } } };
    await billService.fulfil(r.billId);
    expect(bill(r.billId).status).toBe('delivered');
    expect(state.calls.filter((c) => c.path === '/pay')).toHaveLength(1);
    expect(state.calls.filter((c) => c.path === '/requery')).toHaveLength(2);
  });

  it('network error: UNKNOWN, requeried — never assumed failed or successful', async () => {
    const r = await billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2344000000000', amount: 100000 });
    await approveAndPay(user, r);
    await billService.fulfil(r.billId);
    expect(bill(r.billId).status).toBe('processing');
    expect((await billService.get(user, r.billId)).status).toBe('UNKNOWN');
  });

  it('duplicate dispatch: only one worker can claim a paid bill', async () => {
    const r = await billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2348011111111', amount: 100000 });
    await approveAndPay(user, r);
    await Promise.all([billService.fulfil(r.billId), billService.fulfil(r.billId), billService.fulfil(r.billId)]);
    expect(state.calls.filter((c) => c.path === '/pay')).toHaveLength(1);
  });
});

describe('VTpass webhook', () => {
  it('is not trusted: a "delivered" callback still requeries VTpass, which decides', async () => {
    const r = await billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2342010000000', amount: 100000 });
    await approveAndPay(user, r);
    await billService.fulfil(r.billId);
    const requestId = bill(r.billId).provider_request_id;
    await billService.handleWebhook({ type: 'transaction-update', data: { code: '000', requestId, content: { transactions: { status: 'delivered' } } } });
    expect(bill(r.billId).status).toBe('processing');   // VTpass requery still says pending
    expect(state.calls.at(-1).path).toBe('/requery');
  });

  it('a reversal after delivery is confirmed by requery, then refunded', async () => {
    const r = await billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2348011111111', amount: 100000 });
    await approveAndPay(user, r);
    await billService.fulfil(r.billId);
    const requestId = bill(r.billId).provider_request_id;
    state.requery[requestId] = { code: '040', content: { transactions: { status: 'reversed' } } };
    await billService.handleWebhook({ type: 'transaction-update', data: { code: '040', requestId } });
    expect(bill(r.billId).status).toBe('reversed');
    expect(billRepo.recordReversal).toHaveBeenCalled();
  });

  it('ignores unknown request IDs and other event types', async () => {
    expect(await billService.handleWebhook({ type: 'transaction-update', data: { requestId: '202601010000nope' } })).toEqual({ handled: false });
    expect(await billService.handleWebhook({ type: 'variations-update' })).toEqual({ handled: false });
    expect(call).not.toHaveBeenCalledWith('POST', '/pay', expect.anything(), expect.anything());
  });
});

describe('provider model, status and maintenance', () => {
  it('providers come normalised with a providerCode and an ACHIEVER logo URL (never a VTpass URL)', async () => {
    await billService.overview();
    state.services.get('ikeja-electric').image_url = 'https://sandbox.vtpass.com/resources/products/200X200/Ikeja.jpg';
    const list = await billService.listServices('electricity');
    expect(list[0]).toMatchObject({ providerCode: 'ikedc', providerName: 'Ikeja Electric', shortName: 'IKEDC', category: 'electricity', enabled: true, supported: true });
    expect(list[0].logoUrl).toBe('/api/bills-assets/logos/ikeja-electric');
    const grouped = await billService.listServices();
    expect(grouped.find((g) => g.category === 'airtime').providers.map((x) => x.providerCode)).toEqual(['mtn']);
    expect(grouped.find((g) => g.category === 'betting')).toMatchObject({ available: false, reason: 'NOT_OFFERED', providers: [] });
  });

  it('status reports the backend environment only (sandbox = test mode), never credentials', async () => {
    const s = await billService.status();
    expect(s).toEqual({ environment: 'sandbox', testMode: true, configured: true, status: 'operational' });
    expect(JSON.stringify(s)).not.toMatch(/key|secret|PK_|SK_/i);
  });

  it('a provider in maintenance cannot be bought and the member sees the message', async () => {
    await billService.overview();
    await billService.setServiceControl({ id: 'admin-1' }, 'mtn', { maintenance: true, maintenanceMessage: 'MTN is being upgraded', reason: 'Provider outage notice' }, {});
    await expect(billService.quote(user, { category: 'airtime', serviceId: 'mtn', phone: '+2348011111111', amount: 100000 }))
      .rejects.toMatchObject({ code: 'BILL_PROVIDER_MAINTENANCE', message: 'MTN is being upgraded' });
    await billService.setServiceControl({ id: 'admin-1' }, 'mtn', { maintenance: false, reason: 'Provider back online' }, {});
  });
});
