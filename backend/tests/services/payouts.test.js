import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repositories/disbursementRepository.js', () => ({
  find: vi.fn(), findByReference: vi.fn(), complete: vi.fn(), fail: vi.fn(), markProcessing: vi.fn(), retry: vi.fn(),
  listByStatus: vi.fn(), meta: (kind) => ({ ready: kind === 'commission' ? 'accrued' : 'approved' }),
}));
vi.mock('../../src/repositories/userRepository.js', () => ({ getPayoutAccount: vi.fn(), findById: vi.fn() }));
vi.mock('../../src/repositories/riskRepository.js', () => ({ insert: vi.fn() }));
vi.mock('../../src/services/notificationService.js', () => ({ notify: vi.fn(), kickDispatcher: vi.fn() }));
vi.mock('../../src/services/auditService.js', () => ({ record: vi.fn() }));
vi.mock('../../src/integrations/paystack/paystackClient.js', () => ({ paystack: { initiateTransfer: vi.fn() } }));

const repo = await import('../../src/repositories/disbursementRepository.js');
const riskRepo = await import('../../src/repositories/riskRepository.js');
const payoutService = await import('../../src/services/payoutService.js');

beforeEach(() => vi.clearAllMocks());

describe('payout routing', () => {
  it('maps transfer references to disbursement kinds', () => {
    expect(payoutService.kindFromReference('ACH-PO-260923-ABC')).toBe('osusu_payout');
    expect(payoutService.kindFromReference('ACH-RT-260923-ABC')).toBe('saver_return');
    expect(payoutService.kindFromReference('ACH-CM-260923-ABC')).toBe('commission');
    expect(payoutService.kindFromReference('ACH-PAY-260923-ABC')).toBeNull();
  });

  it('completes a payout only on transfer.success', async () => {
    repo.findByReference.mockResolvedValue({ id: 'po1', status: 'processing', userId: 'u1' });
    await payoutService.handleTransferEvent('transfer.success', { reference: 'ACH-PO-1', transfer_code: 'TRF_1' });
    expect(repo.complete).toHaveBeenCalledWith('osusu_payout', 'po1', 'TRF_1', null);
  });

  it('marks failed transfers as failed (not paid)', async () => {
    repo.findByReference.mockResolvedValue({ id: 'rt1', status: 'processing', userId: 'u1' });
    await payoutService.handleTransferEvent('transfer.failed', { reference: 'ACH-RT-1' });
    expect(repo.fail).toHaveBeenCalledWith('saver_return', 'rt1', 'Transfer failed', null);
    expect(repo.complete).not.toHaveBeenCalled();
  });

  it('raises a review case if a completed transfer is later reversed (ledger stays final)', async () => {
    repo.findByReference.mockResolvedValue({ id: 'po1', status: 'paid', userId: 'u1' });
    await payoutService.handleTransferEvent('transfer.reversed', { reference: 'ACH-PO-1' });
    expect(repo.fail).not.toHaveBeenCalled();
    expect(riskRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'review_required', severity: 'high' }));
  });

  it('does not execute transfers for manual-mode payouts', async () => {
    repo.find.mockResolvedValue({ id: 'po1', status: 'approved', executionMode: 'manual' });
    expect(await payoutService.execute('osusu_payout', 'po1')).toEqual({ executed: false });
  });

  it('rejects unknown payout kinds from the admin API', async () => {
    await expect(payoutService.confirmManual({ id: 'a' }, 'bogus', 'x', {}, {})).rejects.toMatchObject({ status: 400 });
  });
});
