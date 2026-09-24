import { beforeEach, describe, expect, it, vi } from 'vitest';
import { paystackSignature } from '../../src/utils/crypto.js';

vi.mock('../../src/repositories/paymentRepository.js', () => ({
  findOpenAttempt: vi.fn(),
  insertAttempt: vi.fn(),
  updateAttempt: vi.fn(),
  findAttemptByReference: vi.fn(),
  confirmPayment: vi.fn(),
  markPaymentFailed: vi.fn(),
  recordWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  listStaleAttempts: vi.fn(),
  abandonExpiredAttempts: vi.fn(),
  listRetryableWebhooks: vi.fn(),
  findTransaction: vi.fn(),
}));
vi.mock('../../src/integrations/paystack/paystackClient.js', () => ({
  paystack: { initializeTransaction: vi.fn(), verifyTransaction: vi.fn(), listBanks: vi.fn() },
}));
vi.mock('../../src/services/settingsService.js', () => ({ assertPaymentsOpen: vi.fn() }));
vi.mock('../../src/services/notificationService.js', () => ({ kickDispatcher: vi.fn() }));
vi.mock('../../src/services/refundService.js', () => ({ processRefund: vi.fn().mockResolvedValue(null), handleRefundEvent: vi.fn() }));
vi.mock('../../src/services/auditService.js', () => ({ record: vi.fn() }));
vi.mock('../../src/services/payoutService.js', () => ({ handleTransferEvent: vi.fn() }));
vi.mock('../../src/services/billService.js', () => ({ fulfil: vi.fn().mockResolvedValue(null) }));
vi.mock('../../src/services/kycService.js', () => ({ requireLevel: vi.fn().mockResolvedValue(1) }));
vi.mock('../../src/services/riskService.js', () => ({ assertNotRestricted: vi.fn().mockResolvedValue(undefined) }));

const repo = await import('../../src/repositories/paymentRepository.js');
const { paystack } = await import('../../src/integrations/paystack/paystackClient.js');
const refundService = await import('../../src/services/refundService.js');
const payoutService = await import('../../src/services/payoutService.js');
const paymentService = await import('../../src/services/paymentService.js');
const kycService = await import('../../src/services/kycService.js');
const riskService = await import('../../src/services/riskService.js');
const { AppError } = await import('../../src/utils/AppError.js');

const user = { id: 'user-1', email: 'ada@example.com' };
const attempt = (over = {}) => ({
  id: 'att-1', reference: 'ACH-PAY-260923-ABCDEF0123456789', user_id: 'user-1', purpose: 'osusu_contribution',
  target_id: 'contrib-1', amount: 2_000_000, status: 'initialized', created_at: new Date().toISOString(), ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('payment initialisation', () => {
  it('reuses an open checkout for the same target (double click / refresh)', async () => {
    repo.findOpenAttempt.mockResolvedValue({ reference: 'R1', authorization_url: 'https://checkout.paystack.com/x' });
    const out = await paymentService.initialize({ user, purpose: 'osusu_contribution', targetId: 'contrib-1', amount: 2_000_000 });
    expect(out).toEqual({ reference: 'R1', authorizationUrl: 'https://checkout.paystack.com/x', reused: true });
    expect(paystack.initializeTransaction).not.toHaveBeenCalled();
    expect(repo.insertAttempt).not.toHaveBeenCalled();
  });

  it('records the attempt BEFORE calling Paystack and marks it failed if Paystack errors', async () => {
    repo.findOpenAttempt.mockResolvedValue(null);
    repo.insertAttempt.mockResolvedValue({ id: 'att-9' });
    paystack.initializeTransaction.mockRejectedValue(new Error('down'));
    await expect(paymentService.initialize({ user, purpose: 'osusu_contribution', targetId: 'c', amount: 500 })).rejects.toThrow('down');
    expect(repo.insertAttempt).toHaveBeenCalled();
    expect(repo.updateAttempt).toHaveBeenCalledWith('att-9', expect.objectContaining({ status: 'failed' }));
  });

  it('binds the attempt to the authenticated server-side session', async () => {
    repo.findOpenAttempt.mockResolvedValue(null);
    repo.insertAttempt.mockResolvedValue({ id: 'att-5' });
    paystack.initializeTransaction.mockResolvedValue({ access_code: 'a', authorization_url: 'https://checkout.paystack.com/y' });
    await paymentService.initialize({ user: { ...user, sessionId: 'sess-1' }, purpose: 'osusu_contribution', targetId: 'c', amount: 500 });
    expect(repo.insertAttempt).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'sess-1' }));
  });

  it('blocks savings contributions below the required KYC level (no attempt is created)', async () => {
    kycService.requireLevel.mockRejectedValueOnce(new AppError(403, 'KYC_LEVEL_REQUIRED', 'Verification level 1 required'));
    await expect(paymentService.initialize({ user, purpose: 'collector_savings', targetId: 'p', amount: 500 })).rejects.toMatchObject({ code: 'KYC_LEVEL_REQUIRED' });
    expect(repo.insertAttempt).not.toHaveBeenCalled();
    expect(paystack.initializeTransaction).not.toHaveBeenCalled();
  });

  it('does not require KYC for bill payments', async () => {
    repo.findOpenAttempt.mockResolvedValue({ reference: 'R2', authorization_url: 'u' });
    await paymentService.initialize({ user, purpose: 'bill_payment', targetId: 'b', amount: 500 });
    expect(kycService.requireLevel).not.toHaveBeenCalled();
  });

  it('blocks every payment while the account is restricted pending review', async () => {
    riskService.assertNotRestricted.mockRejectedValueOnce(AppError.forbidden('paused', 'ACCOUNT_RESTRICTED'));
    await expect(paymentService.initialize({ user, purpose: 'bill_payment', targetId: 'b', amount: 500 })).rejects.toMatchObject({ code: 'ACCOUNT_RESTRICTED' });
    expect(repo.insertAttempt).not.toHaveBeenCalled();
  });

  it('rejects non-integer amounts', async () => {
    await expect(paymentService.initialize({ user, purpose: 'osusu_contribution', targetId: 'c', amount: 20.5 })).rejects.toThrow('Invalid amount');
  });
});

describe('payment confirmation', () => {
  it('confirms only after Paystack verification, using the VERIFIED amount', async () => {
    repo.findAttemptByReference.mockResolvedValue(attempt());
    paystack.verifyTransaction.mockResolvedValue({ status: 'success', amount: 2_000_000, currency: 'NGN', channel: 'card', paid_at: '2026-09-23T10:00:00Z' });
    repo.confirmPayment.mockResolvedValue({ outcome: 'applied', purpose: 'osusu_contribution' });
    const out = await paymentService.verifyAndConfirm(attempt().reference, 'callback');
    expect(out.outcome).toBe('applied');
    expect(repo.confirmPayment).toHaveBeenCalledWith(expect.objectContaining({ p_amount: 2_000_000, p_currency: 'NGN', p_source: 'callback' }));
  });

  it('does NOT confirm when Paystack reports the charge as failed', async () => {
    repo.findAttemptByReference.mockResolvedValue(attempt());
    paystack.verifyTransaction.mockResolvedValue({ status: 'failed', gateway_response: 'Declined' });
    const out = await paymentService.verifyAndConfirm(attempt().reference, 'webhook');
    expect(out.outcome).toBe('failed');
    expect(repo.confirmPayment).not.toHaveBeenCalled();
    expect(repo.markPaymentFailed).toHaveBeenCalledWith(attempt().reference, 'failed', 'Declined');
  });

  it('leaves pending payments untouched', async () => {
    repo.findAttemptByReference.mockResolvedValue(attempt());
    paystack.verifyTransaction.mockResolvedValue({ status: 'ongoing' });
    expect((await paymentService.verifyAndConfirm(attempt().reference, 'callback')).outcome).toBe('pending');
    expect(repo.confirmPayment).not.toHaveBeenCalled();
    expect(repo.markPaymentFailed).not.toHaveBeenCalled();
  });

  it('is a no-op for an attempt that was already processed (user refreshes callback page)', async () => {
    repo.findAttemptByReference.mockResolvedValue(attempt({ status: 'success' }));
    const out = await paymentService.verifyAndConfirm(attempt().reference, 'callback');
    expect(out.outcome).toBe('already_processed');
    expect(paystack.verifyTransaction).not.toHaveBeenCalled();
  });

  it('starts a refund when the SQL layer reports a duplicate payment', async () => {
    repo.findAttemptByReference.mockResolvedValue(attempt());
    paystack.verifyTransaction.mockResolvedValue({ status: 'success', amount: 2_000_000, currency: 'NGN' });
    repo.confirmPayment.mockResolvedValue({ outcome: 'duplicate', refund_transaction_id: 'rf-1', purpose: 'osusu_contribution' });
    await paymentService.verifyAndConfirm(attempt().reference, 'webhook');
    expect(refundService.processRefund).toHaveBeenCalledWith('rf-1');
  });

  it("will not reveal another user's payment status", async () => {
    repo.findAttemptByReference.mockResolvedValue(attempt({ user_id: 'someone-else' }));
    await expect(paymentService.statusForUser(user, attempt().reference)).rejects.toMatchObject({ status: 404 });
  });
});

describe('Paystack webhooks', () => {
  const body = (event, data) => Buffer.from(JSON.stringify({ event, data }));

  it('rejects a bad signature without storing anything', async () => {
    const raw = body('charge.success', { id: 1, reference: 'X' });
    await expect(paymentService.handleWebhook(raw, 'deadbeef', {})).rejects.toMatchObject({ status: 401 });
    expect(repo.recordWebhook).not.toHaveBeenCalled();
  });

  it('processes a valid charge.success by re-verifying with Paystack', async () => {
    const raw = body('charge.success', { id: 77, reference: attempt().reference, status: 'success' });
    repo.recordWebhook.mockResolvedValue({ id: 'wh-1' });
    repo.findAttemptByReference.mockResolvedValue(attempt());
    paystack.verifyTransaction.mockResolvedValue({ status: 'success', amount: 2_000_000, currency: 'NGN' });
    repo.confirmPayment.mockResolvedValue({ outcome: 'applied' });
    const out = await paymentService.handleWebhook(raw, paystackSignature(raw), {});
    expect(out).toEqual({ received: true });
    expect(paystack.verifyTransaction).toHaveBeenCalledWith(attempt().reference);
    expect(repo.updateWebhook).toHaveBeenCalledWith('wh-1', expect.objectContaining({ status: 'processed' }));
  });

  it('ignores the SAME webhook delivered twice (idempotent)', async () => {
    const raw = body('charge.success', { id: 77, reference: attempt().reference, status: 'success' });
    repo.recordWebhook.mockResolvedValue(null); // unique event_key already present
    const out = await paymentService.handleWebhook(raw, paystackSignature(raw), {});
    expect(out).toEqual({ duplicate: true });
    expect(paystack.verifyTransaction).not.toHaveBeenCalled();
    expect(repo.confirmPayment).not.toHaveBeenCalled();
  });

  it('routes transfer events to the payout service', async () => {
    const raw = body('transfer.success', { id: 5, reference: 'ACH-PO-260923-ABC', status: 'success' });
    repo.recordWebhook.mockResolvedValue({ id: 'wh-2' });
    await paymentService.handleWebhook(raw, paystackSignature(raw), {});
    expect(payoutService.handleTransferEvent).toHaveBeenCalledWith('transfer.success', expect.objectContaining({ reference: 'ACH-PO-260923-ABC' }));
  });

  it('records processing failures for retry instead of losing the event', async () => {
    const raw = body('charge.success', { id: 78, reference: attempt().reference, status: 'success' });
    repo.recordWebhook.mockResolvedValue({ id: 'wh-3' });
    repo.findAttemptByReference.mockResolvedValue(attempt());
    paystack.verifyTransaction.mockRejectedValue(new Error('timeout'));
    await paymentService.handleWebhook(raw, paystackSignature(raw), {});
    expect(repo.updateWebhook).toHaveBeenCalledWith('wh-3', expect.objectContaining({ status: 'failed' }));
  });
});
