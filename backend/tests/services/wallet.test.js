import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Wallet service with an in-memory repository. Money rules that live in SQL
// (locking, balanced ledger, limits under lock) are covered by
// supabase/tests/database/wallet.test.sql; here we test the API-side flow:
// review -> approval -> execution, masking, risk-based approval and limits.
const state = { accounts: new Map(), transfers: new Map(), topups: new Map(), executed: [], challenges: new Map(), credentials: new Map(), events: [], settings: {}, payments: [], mandates: new Map(), sent: new Set() };
const ME = 'u-me';
const OTHER = 'u-other';

const accountFor = (userId) => [...state.accounts.values()].find((a) => a.user_id === userId);

// Fee engine (the database's fee_quote): fixed fees per service for these tests.
const FEES = {};
const quoteFor = (service, amount) => {
  const fee = FEES[service] ?? 0;
  return { service, amount, fee, total_debit: amount + fee, recipient_amount: amount, fee_type: 'FIXED', fee_bearing_mode: 'FEE_ADDED', rule: 'test', fee_version: 1 };
};
vi.mock('../../src/repositories/feeRepository.js', () => ({
  quote: vi.fn(async (service, amount) => quoteFor(service, amount)),
  listAll: vi.fn(async () => []),
}));
vi.mock('../../src/repositories/walletRepository.js', () => ({
  ensureWallet: vi.fn(async (u) => accountFor(u).id),
  findAccount: vi.fn(async (id) => state.accounts.get(id) || null),
  findAccountByUser: vi.fn(async (u) => accountFor(u) || null),
  findAccountByCode: vi.fn(async (input) => {
    const code = input === 'ACHW-BCDE6789' ? 'ACHBCDE6789ABCDEFGH' : input;   // legacy alias
    const a = [...state.accounts.values()].find((x) => x.wallet_code === code);
    return a ? { ...a, owner: { full_name: a.name, account_status: 'active' } } : null;
  }),
  sumOutgoingToday: vi.fn(async () => state.sentToday ?? 0),
  countTransfersSince: vi.fn(async () => 0),
  hasSentTo: vi.fn(async (_u, w) => state.sent.has(w)),
  insertTransfer: vi.fn(async (row) => { const q = quoteFor('wallet_transfer', row.amount); const t = { id: crypto.randomUUID(), authorized_at: null, expires_at: new Date(Date.now() + 900_000).toISOString(), ...row, fee: q.fee, total_debit: q.total_debit, recipient_amount: q.recipient_amount, fee_snapshot: q }; state.transfers.set(t.id, t); return { ...t }; }),
  findTransfer: vi.fn(async (id) => (state.transfers.get(id) ? { ...state.transfers.get(id) } : null)),
  findTransferByKey: vi.fn(async () => null),
  markTransferAuthorized: vi.fn(async (id, { method }) => {
    const t = state.transfers.get(id);
    if (!t || t.authorized_at || t.status !== 'AWAITING_AUTHORIZATION') return null;
    t.authorized_at = 'now'; t.auth_method = method; return { ...t };
  }),
  executeTransfer: vi.fn(async (id) => { state.executed.push(id); state.transfers.get(id).status = 'SUCCESS'; return { outcome: 'success' }; }),
  failTransfer: vi.fn(async () => []),
  cancelTransfer: vi.fn(async () => null),
  insertTopup: vi.fn(async (row) => { const q = quoteFor('wallet_topup', row.amount); const t = { id: crypto.randomUUID(), ...row, amount: q.total_debit, fee: q.fee, credit_amount: q.recipient_amount }; state.topups.set(t.id, t); return { ...t }; }),
  updateTopup: vi.fn(async (id, patch) => Object.assign(state.topups.get(id), patch)),
  findTopup: vi.fn(async (id) => state.topups.get(id) || null),
  findTopupByKey: vi.fn(async () => null),
  insertMandate: vi.fn(async (row) => { const m = { id: crypto.randomUUID(), total_paid: 0, created_at: 'now', ...row }; state.mandates.set(m.id, m); return { ...m }; }),
  findMandate: vi.fn(async (id) => (state.mandates.get(id) ? { ...state.mandates.get(id) } : null)),
  updateMandate: vi.fn(async (id, _u, patch, from) => { const m = state.mandates.get(id); if (!from.includes(m.status)) return null; return { ...Object.assign(m, patch) }; }),
  payOsusuContribution: vi.fn(async (u, c) => { state.payments.push({ u, c }); return { outcome: 'applied', wallet_transaction_id: 'wtx-1' }; }),
  payCollectorSavings: vi.fn(async () => ({ outcome: 'applied' })),
}));
vi.mock('../../src/repositories/transactionSecurityRepository.js', () => ({
  findCredential: vi.fn(async (u) => state.credentials.get(u) || null),
  upsertCredential: vi.fn(async (u, h) => { state.credentials.set(u, { user_id: u, pin_hash: h, failed_attempts: 0, locked_until: null, lock_count: 0, reset_required: false }); return {}; }),
  updateCredential: vi.fn(async (u, patch) => Object.assign(state.credentials.get(u), patch)),
  insertChallenge: vi.fn(async (row) => { const c = { attempts: 0, verified_at: null, consumed_at: null, ...row }; state.challenges.set(c.id, c); return { ...c }; }),
  findChallenge: vi.fn(async (id) => (state.challenges.get(id) ? { ...state.challenges.get(id) } : null)),
  updateChallenge: vi.fn(async (id, patch) => Object.assign(state.challenges.get(id), patch)),
  consumeChallenge: vi.fn(async (id) => { const c = state.challenges.get(id); if (!c || c.consumed_at || !c.verified_at) return null; c.consumed_at = 'now'; return { id }; }),
  countRecentChallenges: vi.fn(async () => 0),
  findDeviceKey: vi.fn(async () => null),
  touchDeviceKey: vi.fn(async () => []),
  insertEvent: vi.fn(async (row) => { state.events.push(row); }),
}));
vi.mock('../../src/repositories/osusuRepository.js', () => ({
  findContribution: vi.fn(async (id) => (id === 'c-1' ? { id, user_id: ME, amount: 1_000_000, status: 'pending', group: { name: 'Market Circle' } } : null)),
  findGroup: vi.fn(async (id) => (id === 'g-1' ? { id, name: 'Market Circle', status: 'active', contribution_amount: 1_000_000 } : null)),
  findMembership: vi.fn(async (g, u) => (g === 'g-1' && u === ME ? { status: 'active' } : null)),
}));
vi.mock('../../src/repositories/collectorRepository.js', () => ({ findPlan: vi.fn(async () => null) }));
const initialize = vi.fn(async () => ({ reference: 'ACH-PAY-1', authorizationUrl: 'https://checkout.paystack.com/x' }));
vi.mock('../../src/services/paymentService.js', () => ({ initialize: (...a) => initialize(...a), statusForUser: vi.fn(async () => ({})) }));
vi.mock('../../src/services/settingsService.js', () => ({
  getInt: vi.fn(async (k, d) => state.settings[k] ?? d),
  getBool: vi.fn(async (k, d) => state.settings[k] ?? d),
  get: vi.fn(async (k, d) => state.settings[k] ?? d),
}));
vi.mock('../../src/services/notificationService.js', () => ({ notify: vi.fn(async () => null), kickDispatcher: vi.fn() }));
vi.mock('../../src/services/auditService.js', () => ({ record: vi.fn(async () => null) }));
vi.mock('../../src/services/riskService.js', () => ({ assertNotRestricted: vi.fn(async () => {}) }));
const emailed = [];
vi.mock('../../src/services/emailService.js', () => ({ sendSecurityCode: vi.fn(async (_t, _n, code) => { emailed.push(code); return { ok: true }; }) }));

const wallet = await import('../../src/services/walletService.js');
const tx = await import('../../src/services/transactionAuthService.js');
const schemas = await import('../../src/validators/walletValidators.js');

const user = { id: ME, email: 'me@example.com', fullName: 'Me', sessionId: 's-1' };
const PIN = '482915';

beforeEach(async () => {
  for (const k of ['accounts', 'transfers', 'topups', 'challenges', 'credentials', 'mandates']) state[k].clear();
  state.sent.clear(); state.executed.length = 0; state.events.length = 0; state.payments.length = 0; emailed.length = 0;
  state.settings = {}; state.sentToday = 0; initialize.mockClear();
  state.accounts.set('w-me', { id: 'w-me', user_id: ME, kind: 'user', wallet_code: 'ACHAAAA2345ABCDEFGH', status: 'active', balance: 10_000_000, held: 0, currency: 'NGN', name: 'Me Myself' });
  state.accounts.set('w-other', { id: 'w-other', user_id: OTHER, kind: 'user', wallet_code: 'ACHBCDE6789ABCDEFGH', status: 'active', balance: 0, held: 0, currency: 'NGN', name: 'Adaeze Okafor' });
  await tx.setPin(user, PIN, {});
});

describe('wallet identity and masking', () => {
  it('normalises wallet account numbers (and old IDs) and rejects look-alike characters', () => {
    expect(wallet.normaliseWalletCode('ach bcde-6789 abcd efgh')).toBe('ACHBCDE6789ABCDEFGH');
    expect(wallet.normaliseWalletCode('ACHW-BCDE6789')).toBe('ACHW-BCDE6789');        // legacy ID still accepted
    expect(wallet.normaliseWalletCode('ACHBCDE6789ABCDEFG0')).toBeNull();             // 0 is not in the alphabet
    expect(wallet.normaliseWalletCode('ACH12345')).toBeNull();                         // too short
  });

  it('internal recipient: full display name (never masked), avatar and wallet number only', async () => {
    const r = await wallet.resolveRecipient(user, 'ACHBCDE6789ABCDEFGH');
    expect(r).toMatchObject({ walletId: 'ACHBCDE6789ABCDEFGH', displayName: 'Adaeze Okafor', name: 'Adaeze Okafor', verified: true, avatarUrl: null });
    expect(JSON.stringify(r)).not.toMatch(/\*/);
    expect(Object.keys(r).sort()).toEqual(['avatarUrl', 'displayName', 'legacyId', 'name', 'verified', 'walletId']);
    // An old ACHW- ID finds the same wallet and shows its new account number.
    expect(await wallet.resolveRecipient(user, 'ACHW-BCDE6789')).toMatchObject({ walletId: 'ACHBCDE6789ABCDEFGH', legacyId: true });
  });

  it('refuses sending to yourself or to an unknown wallet', async () => {
    await expect(wallet.resolveRecipient(user, 'ACHAAAA2345ABCDEFGH')).rejects.toMatchObject({ code: 'SELF_TRANSFER' });
    await expect(wallet.resolveRecipient(user, 'ACHZZZZ2345ABCDEFGH')).rejects.toMatchObject({ code: 'WALLET_NOT_FOUND' });
  });

  it('never calls the wallet a bank account', async () => {
    const s = await wallet.summary(user);
    expect(s.walletId).toBe('ACHAAAA2345ABCDEFGH');
    expect(s.notice).toMatch(/not a bank account/i);
    expect(s.available).toBe(10_000_000);
  });
});

describe('top-up', () => {
  it('starts a Paystack checkout and credits nothing until the server confirms', async () => {
    const r = await wallet.startTopup(user, { amount: 500_000 }, 'topup-key-001');
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'wallet_topup', amount: 500_000 }));
    expect(r).toMatchObject({ status: 'PENDING', authorizationUrl: expect.stringContaining('paystack') });
    expect(state.accounts.get('w-me').balance).toBe(10_000_000);
  });

  it('enforces the minimum, maximum and wallet balance cap on the server', async () => {
    await expect(wallet.startTopup(user, { amount: 5_000 })).rejects.toMatchObject({ code: 'AMOUNT_TOO_LOW' });
    await expect(wallet.startTopup(user, { amount: 60_000_000 })).rejects.toMatchObject({ code: 'AMOUNT_TOO_HIGH' });
    state.settings['wallet.max_balance_kobo'] = 10_100_000;
    await expect(wallet.startTopup(user, { amount: 200_000 })).rejects.toMatchObject({ code: 'BALANCE_LIMIT' });
  });

  it('a frozen wallet cannot be funded', async () => {
    state.accounts.get('w-me').status = 'frozen';
    await expect(wallet.startTopup(user, { amount: 100_000 })).rejects.toMatchObject({ code: 'WALLET_NOT_ACTIVE' });
  });
});

describe('internal transfer: review -> approve -> execute', () => {
  it('small transfer: PIN approval, executed exactly once', async () => {
    state.sent.add('w-other');
    const review = await wallet.startTransfer(user, { walletCode: 'ACHBCDE6789ABCDEFGH', amount: 200_000, note: 'Lunch' });
    expect(review).toMatchObject({ amount: 200_000, total: 200_000, recipient: { displayName: 'Adaeze Okafor' } });
    expect(review.approval.methods).toContain('pin');
    expect(state.executed).toHaveLength(0);   // nothing moves at review

    const ch = await wallet.authorizeTransfer(user, review.transferId, { method: 'pin', pin: PIN }, {});
    const done = await wallet.confirmTransfer(user, review.transferId, { challengeId: ch.challengeId }, {});
    expect(done.status).toBe('SUCCESS');
    expect(state.executed).toEqual([review.transferId]);
    await expect(wallet.confirmTransfer(user, review.transferId, { challengeId: ch.challengeId }, {})).rejects.toMatchObject({ code: 'TRANSFER_NOT_AWAITING_APPROVAL' });
    expect(state.executed).toHaveLength(1);
  });

  it('an approval is bound to the reviewed amount and recipient', async () => {
    state.sent.add('w-other');
    const review = await wallet.startTransfer(user, { walletCode: 'ACHBCDE6789ABCDEFGH', amount: 200_000 });
    const ch = await wallet.authorizeTransfer(user, review.transferId, { method: 'pin', pin: PIN }, {});
    state.transfers.get(review.transferId).amount = 9_000_000;   // tampered after approval
    await expect(wallet.confirmTransfer(user, review.transferId, { challengeId: ch.challengeId }, {})).rejects.toMatchObject({ code: 'TX_AUTH_INVALID' });
    expect(state.executed).toHaveLength(0);
  });

  it('larger amounts need PIN + emailed code (PIN alone is refused)', async () => {
    state.sent.add('w-other');
    const review = await wallet.startTransfer(user, { walletCode: 'ACHBCDE6789ABCDEFGH', amount: 6_000_000 });
    expect(review.approval).toMatchObject({ stepUpRequired: true });
    await expect(wallet.authorizeTransfer(user, review.transferId, { method: 'pin', pin: PIN }, {})).rejects.toMatchObject({ code: 'TX_STEP_UP_REQUIRED' });
    const ch = await wallet.authorizeTransfer(user, review.transferId, { method: 'email_otp', pin: PIN }, {});
    await expect(wallet.confirmTransfer(user, review.transferId, { challengeId: ch.challengeId, code: '000000' }, {})).rejects.toMatchObject({ code: 'TX_AUTH_INVALID' });
    await wallet.confirmTransfer(user, review.transferId, { challengeId: ch.challengeId, code: emailed.at(-1) }, {});
    expect(state.executed).toHaveLength(1);
  });

  it('first transfer of a notable amount to a new wallet is stepped up, with the reason explained', async () => {
    const review = await wallet.startTransfer(user, { walletCode: 'ACHBCDE6789ABCDEFGH', amount: 2_500_000 });
    expect(review.newRecipient).toBe(true);
    expect(review.approval.methods).not.toContain('pin');
    expect(review.approval.reason).toMatch(/first transfer/i);
  });

  it('server-side limits: insufficient balance, single and daily limits', async () => {
    await expect(wallet.startTransfer(user, { walletCode: 'ACHBCDE6789ABCDEFGH', amount: 15_000_000 })).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    state.settings['wallet.transfer_single_max_kobo'] = 100_000;
    await expect(wallet.startTransfer(user, { walletCode: 'ACHBCDE6789ABCDEFGH', amount: 200_000 })).rejects.toMatchObject({ code: 'AMOUNT_TOO_HIGH' });
    state.settings['wallet.transfer_single_max_kobo'] = 20_000_000;
    state.sentToday = 49_900_000;
    await expect(wallet.startTransfer(user, { walletCode: 'ACHBCDE6789ABCDEFGH', amount: 200_000 })).rejects.toMatchObject({ code: 'DAILY_LIMIT_REACHED' });
  });

  it('the client cannot claim an approval it does not have', () => {
    expect(schemas.confirm.safeParse({ challengeId: crypto.randomUUID(), isBiometric: true }).success).toBe(false);
    expect(schemas.approve.safeParse({ method: 'trust_me' }).success).toBe(false);
  });
});

describe('payments and automatic contributions', () => {
  it('pays an OSUSU contribution from the wallet only after approval', async () => {
    const ch = await wallet.authorizePayment(user, { kind: 'osusu', contributionId: 'c-1', method: 'pin', pin: PIN }, {});
    expect(state.payments).toHaveLength(0);
    await wallet.confirmPayment(user, { kind: 'osusu', contributionId: 'c-1', challengeId: ch.challengeId }, {});
    expect(state.payments).toEqual([{ u: ME, c: 'c-1' }]);
  });

  it('automatic payments need explicit approval with the emailed code (never PIN alone)', async () => {
    const m = await wallet.createMandate(user, { groupId: 'g-1' });
    expect(m).toMatchObject({ status: 'PENDING_AUTHORIZATION', amount: 1_000_000 });
    expect(m.terms).toMatch(/pause or cancel/i);
    await expect(wallet.authorizeMandate(user, m.id, { method: 'pin', pin: PIN }, {})).rejects.toMatchObject({ code: 'TX_STEP_UP_REQUIRED' });
    const ch = await wallet.authorizeMandate(user, m.id, { method: 'email_otp', pin: PIN }, {});
    const on = await wallet.confirmMandate(user, m.id, { challengeId: ch.challengeId, code: emailed.at(-1) }, {});
    expect(on.status).toBe('ACTIVE');
    expect((await wallet.setMandateState(user, m.id, 'pause', null, {})).status).toBe('PAUSED');
    expect((await wallet.setMandateState(user, m.id, 'cancel', 'No longer needed', {})).status).toBe('CANCELLED');
    await expect(wallet.setMandateState(user, m.id, 'resume', null, {})).rejects.toMatchObject({ code: 'MANDATE_STATE' });
  });

  it('only members can set up automatic payments for a group', async () => {
    await expect(wallet.createMandate(user, { groupId: 'g-x' })).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
  });
});

describe('transaction PIN security', () => {
  it('progressive lockout: each lock is longer, then a reset is required', async () => {
    const lockFor = async () => {
      for (let i = 0; i < 4; i += 1) await expect(tx.verifyPin(user, '000001', {})).rejects.toMatchObject({ code: 'TRANSACTION_PIN_INVALID' });
      await expect(tx.verifyPin(user, '000001', {})).rejects.toMatchObject({ code: 'TRANSACTION_PIN_LOCKED' });
      const c = state.credentials.get(ME);
      const minutes = Math.round((new Date(c.locked_until).getTime() - Date.now()) / 60000);
      c.locked_until = null;   // let time pass
      return minutes;
    };
    expect(await lockFor()).toBe(30);
    expect(await lockFor()).toBe(60);
    await lockFor();
    expect(state.credentials.get(ME).reset_required).toBe(true);
    await expect(tx.verifyPin(user, PIN, {})).rejects.toMatchObject({ code: 'TRANSACTION_PIN_RESET_REQUIRED' });
    expect(state.events.map((e) => e.type)).toEqual(expect.arrayContaining(['transaction_pin_warning', 'transaction_pin_locked', 'transaction_pin_review']));
    await tx.setPin(user, '730519', {});   // reset (after password + emailed code in the real flow)
    expect(await tx.verifyPin(user, '730519', {})).toBe(true);
  });

  it('the PIN never appears in security events or challenges', async () => {
    await tx.verifyPin(user, '000001', {}).catch(() => {});
    await wallet.authorizePayment(user, { kind: 'osusu', contributionId: 'c-1', method: 'pin', pin: PIN }, {});
    const dump = JSON.stringify([...state.events, ...state.challenges.values()]);
    expect(dump).not.toContain(PIN);
    expect(dump).not.toContain('000001');
  });
});
