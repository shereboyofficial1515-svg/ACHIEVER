import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repositories/securityRepository.js', () => ({
  findDevice: vi.fn(), insertDevice: vi.fn(), updateDevice: vi.fn(), countDevices: vi.fn(), insertSession: vi.fn(),
  findSession: vi.fn(), updateSession: vi.fn(), revokeSessions: vi.fn(), insertSecurityEvent: vi.fn(),
  insertAccountChange: vi.fn(), insertDataAccess: vi.fn(), listRolePermissions: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/repositories/complianceRepository.js', () => ({
  findApproval: vi.fn(), findOpenApproval: vi.fn(), insertApproval: vi.fn(), updateApproval: vi.fn(), consumeApproval: vi.fn(),
  reverseTransaction: vi.fn(), recordAdjustment: vi.fn(), setCollectorStatus: vi.fn(), getRiskProfile: vi.fn(),
  getKyc: vi.fn(), recomputeKyc: vi.fn(), upsertRiskProfile: vi.fn(), getRiskFactors: vi.fn(),
}));
vi.mock('../../src/repositories/userRepository.js', () => ({ findById: vi.fn(), getPayoutAccount: vi.fn(), update: vi.fn() }));
vi.mock('../../src/repositories/paymentRepository.js', () => ({ findTransaction: vi.fn() }));
vi.mock('../../src/repositories/collectorRepository.js', () => ({ findAccount: vi.fn() }));
vi.mock('../../src/repositories/disbursementRepository.js', () => ({
  find: vi.fn(), complete: vi.fn(), setEvaluation: vi.fn(), listByStatus: vi.fn(), retry: vi.fn(),
  meta: (kind) => ({ ready: kind === 'commission' ? 'accrued' : 'approved' }),
}));
vi.mock('../../src/services/notificationService.js', () => ({ notify: vi.fn(), kickDispatcher: vi.fn() }));
vi.mock('../../src/services/auditService.js', () => ({ record: vi.fn() }));
vi.mock('../../src/services/refundService.js', () => ({ processRefund: vi.fn().mockResolvedValue(null) }));
vi.mock('../../src/services/settingsService.js', () => ({
  get: vi.fn(async (key, fallback) => ({
    'risk.withdrawal_review_threshold_kobo': 50_000_000, 'finance.large_payout_threshold_kobo': 100_000_000, 'security.step_up_minutes': 10,
  }[key] ?? fallback)),
  payoutMode: vi.fn().mockResolvedValue('manual'),
}));
vi.mock('../../src/integrations/resend/resendClient.js', () => ({ sendEmail: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('../../src/integrations/paystack/paystackClient.js', () => ({ paystack: { initiateTransfer: vi.fn() } }));

const securityRepo = await import('../../src/repositories/securityRepository.js');
const complianceRepo = await import('../../src/repositories/complianceRepository.js');
const userRepo = await import('../../src/repositories/userRepository.js');
const paymentRepo = await import('../../src/repositories/paymentRepository.js');
const collectorRepo = await import('../../src/repositories/collectorRepository.js');
const disbursementRepo = await import('../../src/repositories/disbursementRepository.js');
const notificationService = await import('../../src/services/notificationService.js');
const sessionService = await import('../../src/services/sessionService.js');
const securityService = await import('../../src/services/securityService.js');
const approvals = await import('../../src/services/sensitiveActionService.js');
const riskService = await import('../../src/services/riskService.js');
const payoutService = await import('../../src/services/payoutService.js');
const adminService = await import('../../src/services/adminService.js');

const req = { ip: '102.89.4.211', cookies: {}, get: () => 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0' };
const res = () => ({ cookie: vi.fn() });
const staff = (id, permissions) => ({ id, roles: ['FINANCE_ADMIN'], permissions });

beforeEach(() => {
  vi.clearAllMocks();
  complianceRepo.getRiskProfile.mockResolvedValue(null);
  complianceRepo.getKyc.mockResolvedValue({ level: 2, restricted: false });
});

describe('sessions & devices', () => {
  it('registers the first device silently and binds a server-side session', async () => {
    securityRepo.findDevice.mockResolvedValue(null);
    securityRepo.countDevices.mockResolvedValue(0);
    securityRepo.insertDevice.mockResolvedValue({ id: 'dev-1' });
    securityRepo.insertSession.mockResolvedValue({ id: 'sess-1' });
    const r = res();
    const id = await sessionService.start({ userId: 'u1', authMethod: 'password', req, res: r });
    expect(id).toBe('sess-1');
    expect(r.cookie).toHaveBeenCalledWith('ach_did', expect.any(String), expect.objectContaining({ httpOnly: true }));
    expect(securityRepo.insertSecurityEvent).not.toHaveBeenCalled();
    // The raw device token is never stored, only a keyed hash.
    const token = r.cookie.mock.calls[0][1];
    expect(securityRepo.insertDevice.mock.calls[0][0].device_id_hash).not.toContain(token);
  });

  it('alerts on a sign-in from an unrecognised device (neutral wording)', async () => {
    securityRepo.findDevice.mockResolvedValue(null);
    securityRepo.countDevices.mockResolvedValue(2);
    securityRepo.insertDevice.mockResolvedValue({ id: 'dev-2' });
    securityRepo.insertSession.mockResolvedValue({ id: 'sess-2' });
    userRepo.findById.mockResolvedValue({ full_name: 'Ada', email: 'ada@example.com' });
    await sessionService.start({ userId: 'u1', authMethod: 'password', req, res: res() });
    expect(securityRepo.insertSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'new_device', severity: 'low' }));
    expect(securityRepo.insertAccountChange).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'device_added' }));
    expect(notificationService.notify).toHaveBeenCalledWith('u1', expect.objectContaining({ type: 'new_device_sign_in' }));
  });

  it('rejects a revoked session and a session belonging to someone else', async () => {
    securityRepo.findSession.mockResolvedValueOnce({ id: 's-rev', user_id: 'u1', revoked_at: '2026-09-01' });
    await expect(sessionService.validate('s-rev', 'u1')).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    securityRepo.findSession.mockResolvedValueOnce({ id: 's-other', user_id: 'u2', revoked_at: null });
    await expect(sessionService.validate('s-other', 'u1')).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });

  it('step-up is only valid on the current session within the configured window', async () => {
    securityRepo.findSession.mockResolvedValueOnce({ id: 's1', step_up_at: new Date().toISOString(), revoked_at: null });
    expect(await sessionService.hasRecentStepUp({ sessionId: 's1' })).toBe(true);
    securityRepo.findSession.mockResolvedValueOnce({ id: 's1', step_up_at: new Date(Date.now() - 11 * 60_000).toISOString(), revoked_at: null });
    expect(await sessionService.hasRecentStepUp({ sessionId: 's1' })).toBe(false);
    expect(await sessionService.hasRecentStepUp({ sessionId: null })).toBe(false);
  });

  it('a wrong password on step-up is audited and refused', async () => {
    await expect(sessionService.stepUp({ id: 'u1', email: 'a@x.ng', sessionId: 's1' }, 'nope', async () => false, req))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(securityRepo.updateSession).not.toHaveBeenCalled();
  });
});

describe('sensitive data access log', () => {
  it('requires a reason and writes the log entry', async () => {
    await expect(securityService.logDataAccess({ actor: { id: 'a' }, resourceType: 'profile', reason: 'x', req })).rejects.toMatchObject({ code: 'ACCESS_REASON_REQUIRED' });
    await securityService.logDataAccess({ actor: { id: 'a', sessionId: 's' }, subjectUserId: 'u', resourceType: 'profile', fields: ['address'], reason: 'Dispute CASE-2026-000001', req });
    expect(securityRepo.insertDataAccess).toHaveBeenCalledWith(expect.objectContaining({ actor_id: 'a', subject_user_id: 'u', session_id: 's', reason: 'Dispute CASE-2026-000001' }));
  });
});

describe('two-person approvals', () => {
  const requester = staff('fin-1', ['finance.reversal.request', 'finance.reversal.approve']);
  const approver = staff('fin-2', ['finance.reversal.approve']);

  it('only successful, reversible transactions can be put up for reversal', async () => {
    paymentRepo.findTransaction.mockResolvedValue({ id: 't1', user_id: 'u1', status: 'success', type: 'osusu_payout' });
    await expect(approvals.request(requester, { action: 'transaction_reversal', targetId: 't1', reason: 'Duplicate charge confirmed' }, req))
      .rejects.toMatchObject({ code: 'REVERSAL_NOT_SUPPORTED' });
  });

  it('refuses a request without the request permission', async () => {
    await expect(approvals.request(staff('x', ['finance.ledger.read']), { action: 'transaction_reversal', targetId: 't1', reason: 'Duplicate charge confirmed' }, req))
      .rejects.toMatchObject({ status: 403 });
  });

  it('the requester can never approve their own request', async () => {
    complianceRepo.findApproval.mockResolvedValue({ id: 'r1', action: 'transaction_reversal', requested_by: 'fin-1', status: 'pending', expires_at: new Date(Date.now() + 3600e3).toISOString() });
    await expect(approvals.decide(requester, 'r1', { decision: 'approve' }, req)).rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' });
    expect(complianceRepo.updateApproval).not.toHaveBeenCalled();
  });

  it('a second authorised person can approve; execution then runs the atomic reversal', async () => {
    complianceRepo.findApproval.mockResolvedValue({ id: 'r1', action: 'transaction_reversal', target_id: 't1', requested_by: 'fin-1', status: 'pending', expires_at: new Date(Date.now() + 3600e3).toISOString() });
    complianceRepo.updateApproval.mockResolvedValue({ id: 'r1', status: 'approved', expires_at: new Date(Date.now() + 3600e3).toISOString() });
    await approvals.decide(approver, 'r1', { decision: 'approve' }, req);
    expect(complianceRepo.updateApproval).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'approved', decided_by: 'fin-2' }), 'pending');

    complianceRepo.findApproval.mockResolvedValue({ id: 'r1', action: 'transaction_reversal', target_id: 't1', requested_by: 'fin-1', status: 'approved', expires_at: new Date(Date.now() + 3600e3).toISOString() });
    complianceRepo.reverseTransaction.mockResolvedValue({ reversal_transaction_id: 'rv1', refund_transaction_id: null });
    const out = await approvals.execute(requester, 'r1', req);
    expect(complianceRepo.reverseTransaction).toHaveBeenCalledWith('t1', 'r1', 'fin-1');
    expect(out.result.reversal_transaction_id).toBe('rv1');
  });

  it('nothing executes before approval', async () => {
    complianceRepo.findApproval.mockResolvedValue({ id: 'r2', action: 'transaction_reversal', target_id: 't1', requested_by: 'fin-1', status: 'pending', expires_at: new Date(Date.now() + 3600e3).toISOString() });
    await expect(approvals.execute(approver, 'r2', req)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(complianceRepo.reverseTransaction).not.toHaveBeenCalled();
  });
});

describe('withdrawal security', () => {
  const item = { id: 'po1', kind: 'osusu_payout', userId: 'u9', amount: 1_000_000, status: 'approved', executionMode: 'manual' };
  const account = { status: 'verified', cooldown_until: null, bank_name: 'Bank', account_last4: '1234' };

  it('holds a payout to a recently changed account (cool-down) and to low-KYC recipients', async () => {
    userRepo.getPayoutAccount.mockResolvedValue({ ...account, cooldown_until: new Date(Date.now() + 3600e3).toISOString() });
    complianceRepo.getKyc.mockResolvedValue({ level: 1, restricted: false });
    const ev = await riskService.evaluateDisbursement(item);
    expect(ev.hold).toBe(true);
    expect(ev.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['payout_account_cooldown', 'kyc_level']));
  });

  it('passes a normal payout to a verified, settled account', async () => {
    userRepo.getPayoutAccount.mockResolvedValue(account);
    expect((await riskService.evaluateDisbursement(item)).hold).toBe(false);
  });

  it('manual confirmation of a held payout needs a recorded override reason', async () => {
    disbursementRepo.find.mockResolvedValue(item);
    userRepo.getPayoutAccount.mockResolvedValue(null);
    await expect(payoutService.confirmManual(staff('fin-1', []), 'osusu_payout', 'po1', { externalReference: 'BANK-1' }, req))
      .rejects.toMatchObject({ code: 'PAYOUT_HELD' });
    expect(disbursementRepo.complete).not.toHaveBeenCalled();
    await payoutService.confirmManual(staff('fin-1', []), 'osusu_payout', 'po1', { externalReference: 'BANK-1', overrideReason: 'Paid to account confirmed by phone call' }, req);
    expect(disbursementRepo.complete).toHaveBeenCalled();
  });

  it('large payouts need a second approver and nobody can pay themselves', async () => {
    disbursementRepo.find.mockResolvedValue({ ...item, amount: 150_000_000 });
    userRepo.getPayoutAccount.mockResolvedValue(account);
    await expect(payoutService.confirmManual(staff('fin-1', []), 'osusu_payout', 'po1', { externalReference: 'BANK-1', overrideReason: 'Reviewed large amount' }, req))
      .rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    await expect(payoutService.confirmManual(staff('u9', []), 'osusu_payout', 'po1', { externalReference: 'BANK-1' }, req))
      .rejects.toMatchObject({ code: 'SELF_PAYOUT_FORBIDDEN' });
  });
});

describe('collector onboarding', () => {
  const compliance = { id: 'c-1', roles: ['COMPLIANCE_ADMIN'], permissions: ['collectors.review', 'collectors.status'] };

  it('revocation cannot bypass the two-person rule', async () => {
    collectorRepo.findAccount.mockResolvedValue({ id: 'ca1', collector_id: 'u5', status: 'active' });
    await expect(adminService.setCollectorStatus(compliance, 'ca1', 'revoked', 'Misappropriation', req)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  });

  it('an applicant below the operator KYC level cannot be approved', async () => {
    collectorRepo.findAccount.mockResolvedValue({ id: 'ca1', collector_id: 'u5', status: 'pending_review' });
    complianceRepo.getKyc.mockResolvedValue({ level: 1, restricted: false });
    await expect(adminService.setCollectorStatus(compliance, 'ca1', 'active', 'Documents checked', req)).rejects.toMatchObject({ code: 'KYC_LEVEL_REQUIRED' });
    expect(complianceRepo.setCollectorStatus).not.toHaveBeenCalled();
  });

  it('approves a verified applicant through the audited database function', async () => {
    collectorRepo.findAccount.mockResolvedValue({ id: 'ca1', collector_id: 'u5', status: 'pending_review' });
    complianceRepo.setCollectorStatus.mockResolvedValue({ from: 'pending_review', to: 'active' });
    await adminService.setCollectorStatus(compliance, 'ca1', 'active', 'Documents checked', req);
    expect(complianceRepo.setCollectorStatus).toHaveBeenCalledWith('ca1', 'active', 'c-1', 'Documents checked');
  });

  it('staff cannot review their own collector account', async () => {
    collectorRepo.findAccount.mockResolvedValue({ id: 'ca1', collector_id: 'c-1', status: 'pending_review' });
    await expect(adminService.setCollectorStatus(compliance, 'ca1', 'active', 'Self approval', req)).rejects.toMatchObject({ code: 'SELF_REVIEW_FORBIDDEN' });
  });

  it('invalid transitions are refused (e.g. suspending a pending application)', async () => {
    collectorRepo.findAccount.mockResolvedValue({ id: 'ca1', collector_id: 'u5', status: 'pending_review' });
    await expect(adminService.setCollectorStatus(compliance, 'ca1', 'suspended', 'Not yet active', req)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

describe('risk status', () => {
  it('lifting a restriction requires a consumed two-person approval', async () => {
    userRepo.findById.mockResolvedValue({ id: 'u7' });
    complianceRepo.getRiskProfile.mockResolvedValue({ risk_status: 'restricted' });
    const actor = { id: 'sec-1', permissions: ['risk.review'] };
    await expect(riskService.setStatus(actor, 'u7', { status: 'normal', reason: 'Review completed with no finding' }, req, {}))
      .rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(complianceRepo.upsertRiskProfile).not.toHaveBeenCalled();
  });
});
