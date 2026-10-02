import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Wallet → bank transfers with an in-memory repository and a fake Paystack.
// Locking, balances, limits and the ledger are SQL (wallet_fees_bank.test.sql);
// this covers the API flow and the provider handling.
vi.stubEnv('PAYSTACK_TRANSFERS_ENABLED', 'true');

const ME = 'u-me';
const state = { transfers: new Map(), challenges: new Map(), credentials: new Map(), events: [], calls: [], debits: [], settings: {}, wallet: null, paid: new Set() };
const FEE = 10000;   // ₦100 fixed, added

vi.mock('../../src/repositories/feeRepository.js', () => ({
  quote: vi.fn(async (service, amount) => ({ service, amount, fee: FEE, total_debit: amount + FEE, recipient_amount: amount, fee_type: 'FIXED', fee_bearing_mode: 'FEE_ADDED', rule: '₦100.00', fee_version: 3 })),
  listAll: vi.fn(async () => []),
}));
vi.mock('../../src/repositories/walletRepository.js', () => ({
  ensureWallet: vi.fn(async () => 'w-me'),
  findAccountByUser: vi.fn(async () => state.wallet),
  insertBankTransfer: vi.fn(async (row) => {
    // Like the database trigger: the server's fee engine prices the row, whatever was sent.
    const t = { id: crypto.randomUUID(), ...row, fee: FEE, total_debit: row.amount + FEE, recipient_amount: row.amount, fee_snapshot: { fee: FEE, fee_version: 3, fee_bearing_mode: 'FEE_ADDED' },
      status: 'INITIATED', execution_mode: 'paystack_transfer', authorized_at: null, recipient_code: null, expires_at: new Date(Date.now() + 900_000).toISOString(), created_at: 'now' };
    state.transfers.set(t.id, t);
    return { ...t };
  }),
  findBankTransfer: vi.fn(async (id) => (state.transfers.get(id) ? { ...state.transfers.get(id) } : null)),
  findBankTransferByKey: vi.fn(async () => null),
  findBankTransferByReference: vi.fn(async (ref) => [...state.transfers.values()].find((t) => t.reference === ref) || null),
  updateBankTransfer: vi.fn(async (id, patch, { fromStatus } = {}) => { const t = state.transfers.get(id); if (fromStatus && t.status !== fromStatus) return null; return { ...Object.assign(t, patch) }; }),
  markBankTransferAuthorized: vi.fn(async (id, { method }) => { const t = state.transfers.get(id); if (t.status !== 'INITIATED' || t.authorized_at) return null; return { ...Object.assign(t, { authorized_at: 'now', auth_method: method }) }; }),
  hasPaidAccount: vi.fn(async (_u, bank, acct) => state.paid.has(`${bank}:${acct}`)),
  recipientCodeFor: vi.fn(async () => null),
  debitBankTransfer: vi.fn(async (id) => {
    const t = state.transfers.get(id);
    if (t.status !== 'INITIATED') return { outcome: 'already_debited' };
    if (state.wallet.balance < t.total_debit) throw Object.assign(new Error('Insufficient balance.'), { status: 409, code: 'INSUFFICIENT_FUNDS' });
    state.wallet.balance -= t.total_debit; state.debits.push(id); t.status = 'PENDING'; return { outcome: 'debited' };
  }),
  bankTransferProcessing: vi.fn(async (id, code, status) => { const t = state.transfers.get(id); if (t.status === 'PENDING') Object.assign(t, { status: 'PROCESSING', transfer_code: code, provider_status: status }); }),
  completeBankTransfer: vi.fn(async (id, o) => { const t = state.transfers.get(id); if (['PENDING', 'PROCESSING'].includes(t.status)) Object.assign(t, { status: 'SUCCESS', provider_cost: o.providerCost }); return { outcome: 'success' }; }),
  failBankTransfer: vi.fn(async (id, status, reason) => {
    const t = state.transfers.get(id);
    if (['FAILED', 'REVERSED', 'REFUNDED', 'CANCELLED'].includes(t.status)) return { outcome: 'already_final' };
    if (t.status !== 'INITIATED') state.wallet.balance += t.total_debit;   // full refund, fee included
    Object.assign(t, { status: t.status === 'INITIATED' ? 'CANCELLED' : status, failure_reason: reason }); return { outcome: status.toLowerCase() };
  }),
  listOpenBankTransfers: vi.fn(async () => [...state.transfers.values()].filter((t) => ['PENDING', 'PROCESSING'].includes(t.status))),
}));
const paystackFake = {
  resolveAccount: vi.fn(async ({ accountNumber }) => (accountNumber === '0000000000' ? Promise.reject(Object.assign(new Error('Could not resolve'), { providerStatus: 422 })) : { account_name: 'ADAEZE OKAFOR', account_number: accountNumber })),
  createTransferRecipient: vi.fn(async () => ({ recipient_code: 'RCP_123' })),
  initiateTransfer: vi.fn(async (b) => { state.calls.push(b); return { status: state.nextStatus || 'pending', transfer_code: 'TRF_1' }; }),
  verifyTransfer: vi.fn(async () => ({ status: state.verifyStatus || 'success', fee_charged: 2500 })),
};
vi.mock('../../src/integrations/paystack/paystackClient.js', () => ({ paystack: paystackFake }));
vi.mock('../../src/services/paymentService.js', () => ({ listBanks: vi.fn(async () => [{ code: '058', name: 'GTBank' }, { code: '044', name: 'Access Bank' }]) }));
vi.mock('../../src/repositories/transactionSecurityRepository.js', () => ({
  findCredential: vi.fn(async (u) => state.credentials.get(u) || null),
  upsertCredential: vi.fn(async (u, h) => { state.credentials.set(u, { user_id: u, pin_hash: h, failed_attempts: 0, lock_count: 0 }); return {}; }),
  updateCredential: vi.fn(async (u, patch) => Object.assign(state.credentials.get(u), patch)),
  insertChallenge: vi.fn(async (row) => { const c = { attempts: 0, verified_at: null, consumed_at: null, ...row }; state.challenges.set(c.id, c); return { ...c }; }),
  findChallenge: vi.fn(async (id) => (state.challenges.get(id) ? { ...state.challenges.get(id) } : null)),
  updateChallenge: vi.fn(async (id, patch) => Object.assign(state.challenges.get(id), patch)),
  consumeChallenge: vi.fn(async (id) => { const c = state.challenges.get(id); if (!c || c.consumed_at || !c.verified_at) return null; c.consumed_at = 'now'; return { id }; }),
  countRecentChallenges: vi.fn(async () => 0),
  findDeviceKey: vi.fn(async () => null),
  insertEvent: vi.fn(async (row) => { state.events.push(row); }),
}));
vi.mock('../../src/repositories/riskRepository.js', () => ({ insert: vi.fn(async () => ({})) }));
vi.mock('../../src/services/settingsService.js', () => ({
  getInt: vi.fn(async (k, d) => state.settings[k] ?? d), getBool: vi.fn(async (k, d) => state.settings[k] ?? d), get: vi.fn(async (k, d) => d),
}));
vi.mock('../../src/services/notificationService.js', () => ({ notify: vi.fn(async () => null), kickDispatcher: vi.fn() }));
vi.mock('../../src/services/auditService.js', () => ({ record: vi.fn(async () => null) }));
vi.mock('../../src/services/riskService.js', () => ({ assertNotRestricted: vi.fn(async () => {}) }));
const emailed = [];
vi.mock('../../src/services/emailService.js', () => ({ sendSecurityCode: vi.fn(async (_t, _n, code) => { emailed.push(code); return { ok: true }; }) }));

const bank = await import('../../src/services/bankTransferService.js');
const tx = await import('../../src/services/transactionAuthService.js');
const schemas = await import('../../src/validators/walletValidators.js');
const user = { id: ME, email: 'me@example.com', fullName: 'Me', sessionId: 's-1' };
const PIN = '482915';
const input = { bankCode: '058', accountNumber: '0123456789', amount: 2_000_000 };   // ₦20,000

async function approvedTransfer(body = input) {
  state.paid.add(`${body.bankCode}:${body.accountNumber}`);   // a known account: PIN alone is enough at this amount
  const review = await bank.start(user, body);
  const ch = await bank.authorize(user, review.id, { method: 'pin', pin: PIN }, {});
  return { review, done: await bank.confirm(user, review.id, { challengeId: ch.challengeId }, {}) };
}

beforeEach(async () => {
  state.transfers.clear(); state.challenges.clear(); state.credentials.clear(); state.paid.clear();
  state.events.length = 0; state.calls.length = 0; state.debits.length = 0; emailed.length = 0;
  state.settings = {}; state.nextStatus = undefined; state.verifyStatus = undefined;
  state.wallet = { id: 'w-me', user_id: ME, status: 'active', balance: 5_000_000, held: 0 };
  Object.values(paystackFake).forEach((f) => f.mockClear());
  await tx.setPin(user, PIN, {});
});

describe('bank account verification', () => {
  it('the recipient name comes from the bank, never from the app', async () => {
    expect(await bank.resolveAccount(user, { bankCode: '058', accountNumber: '0123456789' })).toEqual({
      bankCode: '058', bankName: 'GTBank', accountNumber: '0123456789', accountName: 'ADAEZE OKAFOR', verified: true,
    });
    expect(schemas.bankTransfer.safeParse({ ...input, accountName: 'SOMEONE ELSE' }).success).toBe(false);
    expect(schemas.bankTransfer.safeParse({ ...input, fee: 0 }).success).toBe(false);
    expect(schemas.bankTransfer.safeParse({ ...input, amount: -500 }).success).toBe(false);
    expect(schemas.bankTransfer.safeParse({ ...input, amount: 100.5 }).success).toBe(false);
  });
  it('unknown accounts and banks are refused', async () => {
    await expect(bank.resolveAccount(user, { bankCode: '058', accountNumber: '0000000000' })).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
    await expect(bank.resolveAccount(user, { bankCode: '999', accountNumber: '0123456789' })).rejects.toMatchObject({ code: 'INVALID_BANK' });
  });
});

describe('review → approve → debit once → provider', () => {
  it('review shows amount, fee and total; nothing moves', async () => {
    const r = await bank.start(user, input);
    expect(r).toMatchObject({ amount: 2_000_000, fee: 10000, totalDebit: 2_010_000, recipientAmount: 2_000_000, accountName: 'ADAEZE OKAFOR', accountNumber: '******6789', status: 'INITIATED' });
    expect(state.debits).toHaveLength(0);
    expect(paystackFake.initiateTransfer).not.toHaveBeenCalled();
  });

  it('insufficient balance counts the fee (₦20,000 + ₦100 with ₦20,000 available)', async () => {
    state.wallet.balance = 2_000_000;
    await expect(bank.start(user, input)).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });

  it('approved: debited once, sent with the recipient amount and its fixed reference, and only PROCESSING after HTTP 200', async () => {
    state.nextStatus = 'success';   // even if Paystack says success on initiation…
    const { review, done } = await approvedTransfer();
    expect(state.debits).toEqual([review.id]);
    expect(state.wallet.balance).toBe(5_000_000 - 2_010_000);
    expect(state.calls).toEqual([{ amount: 2_000_000, recipientCode: 'RCP_123', reference: review.reference, reason: 'ACHIEVER Wallet transfer' }]);
    expect(done.status).toBe('PROCESSING');   // …the final status comes only from the webhook / verify
    await expect(bank.confirm(user, review.id, { challengeId: 'x'.repeat(8) }, {})).rejects.toMatchObject({ code: 'TRANSFER_NOT_AWAITING_APPROVAL' });
    expect(state.debits).toHaveLength(1);
  });

  it('an approval cannot be reused for a changed amount or account', async () => {
    state.paid.add('058:0123456789');
    const review = await bank.start(user, input);
    const ch = await bank.authorize(user, review.id, { method: 'pin', pin: PIN }, {});
    state.transfers.get(review.id).account_number = '9999999999';
    await expect(bank.confirm(user, review.id, { challengeId: ch.challengeId }, {})).rejects.toMatchObject({ code: 'TX_AUTH_INVALID' });
    expect(state.debits).toHaveLength(0);
  });

  it('first larger transfer to a new account needs the emailed code too', async () => {
    const review = await bank.start(user, { ...input, amount: 3_000_000 });
    expect(review.approval).toMatchObject({ newAccount: true, stepUpRequired: true });
    await expect(bank.authorize(user, review.id, { method: 'pin', pin: PIN }, {})).rejects.toMatchObject({ code: 'TX_STEP_UP_REQUIRED' });
  });
});

describe('access control', () => {
  it('another member cannot see, approve, confirm or cancel my transfer (IDOR)', async () => {
    const review = await bank.start(user, input);
    const other = { id: 'u-other', email: 'o@example.com', sessionId: 's-2' };
    await expect(bank.get(other, review.id)).rejects.toMatchObject({ status: 404 });
    await expect(bank.authorize(other, review.id, { method: 'pin', pin: PIN }, {})).rejects.toMatchObject({ status: 404 });
    await expect(bank.confirm(other, review.id, { challengeId: crypto.randomUUID() }, {})).rejects.toMatchObject({ status: 404 });
    await expect(bank.cancel(other, review.id)).rejects.toMatchObject({ status: 404 });
    expect(state.debits).toHaveLength(0);
  });
});

describe('provider outcomes', () => {
  it('webhook success completes it, with the provider fee recorded', async () => {
    const { review } = await approvedTransfer();
    await bank.handleTransferEvent('transfer.success', { reference: review.reference, transfer_code: 'TRF_1', fee_charged: 2500 });
    expect(state.transfers.get(review.id)).toMatchObject({ status: 'SUCCESS', provider_cost: 2500 });
  });

  it('webhook failure refunds the full debit including the fee', async () => {
    const { review } = await approvedTransfer();
    await bank.handleTransferEvent('transfer.failed', { reference: review.reference, reason: 'Account closed' });
    expect(state.transfers.get(review.id).status).toBe('FAILED');
    expect(state.wallet.balance).toBe(5_000_000);
  });

  it('a provider rejection at initiation refunds; a network error keeps it PENDING for a retry with the same reference', async () => {
    paystackFake.initiateTransfer.mockRejectedValueOnce(Object.assign(new Error('Invalid recipient'), { providerStatus: 400 }));
    const a = await approvedTransfer();
    expect(state.transfers.get(a.review.id).status).toBe('FAILED');
    paystackFake.initiateTransfer.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'PAYSTACK_UNAVAILABLE' }));
    const b = await approvedTransfer();
    expect(state.transfers.get(b.review.id).status).toBe('PENDING');
    await bank.processOpen();
    expect(state.calls.at(-1).reference).toBe(b.review.reference);
    expect(state.transfers.get(b.review.id).status).toBe('PROCESSING');
  });

  it('the requery job settles PROCESSING transfers from the provider status', async () => {
    const { review } = await approvedTransfer();
    state.verifyStatus = 'reversed';
    await bank.processOpen();
    expect(state.transfers.get(review.id).status).toBe('REVERSED');
    expect(state.wallet.balance).toBe(5_000_000);
  });
});
