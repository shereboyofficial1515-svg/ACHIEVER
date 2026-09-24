import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repositories/securityRepository.js', () => ({
  insertChallenge: vi.fn(), findChallenge: vi.fn(), updateChallenge: vi.fn(), consumeChallenge: vi.fn(),
  countRecentChallenges: vi.fn(), insertSecurityEvent: vi.fn(), insertAccountChange: vi.fn(), listRolePermissions: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../src/repositories/privacyRepository.js', () => ({
  insert: vi.fn(), find: vi.fn(), listForUser: vi.fn(), openForUser: vi.fn(), transition: vi.fn(), list: vi.fn(), eraseOptionalPersonalData: vi.fn(),
}));
vi.mock('../../src/repositories/userRepository.js', () => ({
  findById: vi.fn(), findByEmail: vi.fn(), update: vi.fn(), openObligations: vi.fn(), listUserPreferences: vi.fn(),
  getUserPreferences: vi.fn(), upsertUserPreferences: vi.fn(),
}));
vi.mock('../../src/repositories/messageRepository.js', () => ({ findMembership: vi.fn(), findConversation: vi.fn(), listMembers: vi.fn() }));
vi.mock('../../src/services/sessionService.js', () => ({ revokeAll: vi.fn() }));
vi.mock('../../src/services/notificationService.js', () => ({ notify: vi.fn(), kickDispatcher: vi.fn() }));
vi.mock('../../src/services/auditService.js', () => ({ record: vi.fn() }));
vi.mock('../../src/services/storageService.js', () => ({ remove: vi.fn(), publicUrl: (_b, p) => (p ? `https://cdn/${p}` : null) }));
vi.mock('../../src/integrations/resend/resendClient.js', () => ({ sendEmail: vi.fn().mockResolvedValue({ ok: true, id: 'e1' }) }));

const securityRepo = await import('../../src/repositories/securityRepository.js');
const privacyRepo = await import('../../src/repositories/privacyRepository.js');
const userRepo = await import('../../src/repositories/userRepository.js');
const messageRepo = await import('../../src/repositories/messageRepository.js');
const { sendEmail } = await import('../../src/integrations/resend/resendClient.js');
const challengeService = await import('../../src/services/challengeService.js');
const privacyService = await import('../../src/services/privacyService.js');
const oauthService = await import('../../src/services/oauthService.js');
const emailService = await import('../../src/services/emailService.js');
const messageService = await import('../../src/services/messageService.js');
const preferencesService = await import('../../src/services/preferencesService.js');
const { hmac } = await import('../../src/utils/crypto.js');
const { env } = await import('../../src/config/env.js');

const user = { id: 'u1', email: 'ada@example.com', fullName: 'Ada', sessionId: 's1' };
const req = { ip: '1.2.3.4', get: () => 'test' };
const future = () => new Date(Date.now() + 5 * 60_000).toISOString();
const challenge = (over = {}) => ({
  id: 'c1', user_id: 'u1', action: 'password_change', session_id: 's1', attempts: 0, max_attempts: 5,
  expires_at: future(), verified_at: null, consumed_at: null,
  code_hash: hmac(env.JWT_SECRET, 'challenge:c1:u1:password_change:123456'), ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  securityRepo.countRecentChallenges.mockResolvedValue(0);
  securityRepo.consumeChallenge.mockResolvedValue({ id: 'c1' });
});

describe('verification challenges', () => {
  it('require the current password and email a code (only a hash is stored)', async () => {
    await expect(challengeService.create(user, { action: 'password_change', password: 'bad' }, async () => false, req))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(securityRepo.insertChallenge).not.toHaveBeenCalled();

    securityRepo.insertChallenge.mockImplementation(async (row) => ({ id: row.id, channel: 'email', destination_masked: row.destination_masked, expires_at: row.expires_at }));
    const out = await challengeService.create(user, { action: 'password_change', password: 'good' }, async () => true, req);
    const row = securityRepo.insertChallenge.mock.calls[0][0];
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toMatch(/"code"/);
    expect(row.session_id).toBe('s1');
    expect(out.sentTo).not.toBe(user.email);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: user.email, subject: expect.stringContaining('security code') }));
  });

  it('are rate limited per user', async () => {
    securityRepo.countRecentChallenges.mockResolvedValue(5);
    await expect(challengeService.create(user, { action: 'email_change', password: 'x' }, async () => true, req))
      .rejects.toMatchObject({ code: 'CHALLENGE_RATE_LIMITED' });
  });

  it('accept the right code once and consume it', async () => {
    securityRepo.findChallenge.mockResolvedValue(challenge());
    await challengeService.use(user, { challengeId: 'c1', code: '123456', action: 'password_change' }, req);
    expect(securityRepo.consumeChallenge).toHaveBeenCalledWith({ id: 'c1', userId: 'u1', action: 'password_change' });
  });

  it('reject a wrong code and count the attempt', async () => {
    securityRepo.findChallenge.mockResolvedValue(challenge());
    await expect(challengeService.use(user, { challengeId: 'c1', code: '000000', action: 'password_change' }, req)).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
    expect(securityRepo.updateChallenge).toHaveBeenCalledWith('c1', { attempts: 1 });
    expect(securityRepo.consumeChallenge).not.toHaveBeenCalled();
  });

  it('record a security event on the last failed attempt, then lock', async () => {
    securityRepo.findChallenge.mockResolvedValue(challenge({ attempts: 4 }));
    await expect(challengeService.use(user, { challengeId: 'c1', code: '000000', action: 'password_change' }, req)).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
    expect(securityRepo.insertSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'otp_failures' }));
    securityRepo.findChallenge.mockResolvedValue(challenge({ attempts: 5 }));
    await expect(challengeService.use(user, { challengeId: 'c1', code: '123456', action: 'password_change' }, req)).rejects.toMatchObject({ code: 'CHALLENGE_LOCKED' });
  });

  it('reject expired, reused, other-action, other-user and other-session codes', async () => {
    const cases = [
      [challenge({ expires_at: new Date(Date.now() - 1000).toISOString() }), 'CHALLENGE_EXPIRED'],
      [challenge({ consumed_at: new Date().toISOString(), verified_at: new Date().toISOString() }), 'CHALLENGE_USED'],
      [challenge({ action: 'email_change' }), 'CHALLENGE_INVALID'],
      [challenge({ user_id: 'someone-else' }), 'CHALLENGE_INVALID'],
      [challenge({ session_id: 'other-session' }), 'CHALLENGE_INVALID'],
    ];
    for (const [row, code] of cases) {
      securityRepo.findChallenge.mockResolvedValue(row);
      await expect(challengeService.use(user, { challengeId: 'c1', code: '123456', action: 'password_change' }, req)).rejects.toMatchObject({ code });
    }
    expect(securityRepo.consumeChallenge).not.toHaveBeenCalled();
  });

  it('fail if the atomic consume loses a race (single use)', async () => {
    securityRepo.findChallenge.mockResolvedValue(challenge());
    securityRepo.consumeChallenge.mockResolvedValue(null);
    await expect(challengeService.use(user, { challengeId: 'c1', code: '123456', action: 'password_change' }, req)).rejects.toMatchObject({ code: 'CHALLENGE_USED' });
  });

  it('are required: no challenge id means no change', async () => {
    await expect(challengeService.use(user, { action: 'password_change' }, req)).rejects.toMatchObject({ code: 'CHALLENGE_REQUIRED' });
  });
});

describe('deletion requests', () => {
  const staff = { id: 'staff1' };
  const pending = (over = {}) => ({ id: 'd1', user_id: 'u1', request_type: 'account', status: 'pending', cancellable_until: future(), ...over });

  it('cannot be completed during the cancellation window', async () => {
    privacyRepo.find.mockResolvedValue(pending());
    await expect(privacyService.decide(staff, 'd1', { decision: 'complete' }, req)).rejects.toMatchObject({ code: 'COOLING_OFF' });
    expect(privacyRepo.eraseOptionalPersonalData).not.toHaveBeenCalled();
  });

  it('never let staff decide their own request', async () => {
    privacyRepo.find.mockResolvedValue(pending({ user_id: 'staff1' }));
    await expect(privacyService.decide(staff, 'd1', { decision: 'complete' }, req)).rejects.toMatchObject({ code: 'SELF_REVIEW_FORBIDDEN' });
  });

  it('keep the account open while obligations remain', async () => {
    privacyRepo.find.mockResolvedValue(pending({ cancellable_until: new Date(Date.now() - 1000).toISOString() }));
    userRepo.openObligations.mockResolvedValue({ organisedGroups: 0, activeMemberships: 1, plans: 0, pendingPayouts: 0 });
    await expect(privacyService.decide(staff, 'd1', { decision: 'complete' }, req)).rejects.toMatchObject({ code: 'OPEN_OBLIGATIONS' });
    expect(privacyRepo.eraseOptionalPersonalData).not.toHaveBeenCalled();
  });

  it('erase optional data and close the account, retaining required records', async () => {
    privacyRepo.find.mockResolvedValue(pending({ cancellable_until: new Date(Date.now() - 1000).toISOString() }));
    userRepo.openObligations.mockResolvedValue({ organisedGroups: 0, activeMemberships: 0, plans: 0, pendingPayouts: 0 });
    privacyRepo.eraseOptionalPersonalData.mockResolvedValue({ avatar_path: null });
    privacyRepo.transition.mockResolvedValue(pending({ status: 'completed' }));
    await privacyService.decide(staff, 'd1', { decision: 'complete' }, req);
    expect(privacyRepo.eraseOptionalPersonalData).toHaveBeenCalledWith('u1', 'staff1', 'd1');
    expect(userRepo.update).toHaveBeenCalledWith('u1', expect.objectContaining({ account_status: 'closed' }));
    expect(privacyRepo.transition.mock.calls[0][2].retained_summary).toMatch(/Transactions/);
  });

  it('can be cancelled by the requester only within the window', async () => {
    privacyRepo.find.mockResolvedValue(pending({ cancellable_until: new Date(Date.now() - 1000).toISOString() }));
    await expect(privacyService.cancel(user, 'd1', req)).rejects.toMatchObject({ code: 'CANCELLATION_CLOSED' });
    privacyRepo.find.mockResolvedValue(pending({ user_id: 'other' }));
    await expect(privacyService.cancel(user, 'd1', req)).rejects.toMatchObject({ status: 404 });
  });
});

describe('social sign-in safety', () => {
  it('only allows same-site relative redirects', () => {
    expect(oauthService.safeNext('/app/osusu')).toBe('/app/osusu');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil', 'javascript:alert(1)', undefined]) expect(oauthService.safeNext(bad)).toBe('/app');
  });

  it('rejects a tampered or missing state cookie', async () => {
    expect(oauthService.readState('abc.def')).toBeNull();
    await expect(oauthService.callback({ code: 'x', stateCookie: 'forged.value' }, req)).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });
  });
});

describe('email system', () => {
  it('adds a signed one-click unsubscribe only to non-transactional mail', async () => {
    const profile = { email: 'ada@example.com', full_name: 'Ada Obi' };
    const notice = await emailService.renderNotification({ id: 'n1', user_id: 'u1', type: 'platform_notice', category: 'system', title: 'Maintenance', body: 'Tonight', data: {} }, profile);
    expect(notice.unsubscribe).toMatch(/\/api\/notifications\/unsubscribe\?u=u1&c=system&t=[0-9a-f]{64}/);
    const payment = await emailService.renderNotification({ id: 'n2', user_id: 'u1', type: 'payment_failed', category: 'payments', title: 'Payment failed', body: 'Declined', data: {} }, profile);
    expect(payment.unsubscribe).toBeUndefined();
    expect(payment.message.html).toContain('achiever-email-logo.png');
    expect(emailService.verifyUnsubscribe('u1', 'system', emailService.unsubscribeToken('u1', 'system'))).toBe(true);
    expect(emailService.verifyUnsubscribe('u2', 'system', emailService.unsubscribeToken('u1', 'system'))).toBe(false);
  });
});

describe('read receipts & online status privacy', () => {
  it('hides read receipts reciprocally and honours online-status privacy', async () => {
    messageRepo.findMembership.mockResolvedValue({ conversation_id: 'cv' });
    messageRepo.findConversation.mockResolvedValue({ id: 'cv', type: 'group', title: 'G' });
    const now = new Date().toISOString();
    messageRepo.listMembers.mockResolvedValue([
      { user_id: 'u1', role: 'member', last_read_at: now, profile: { full_name: 'Me', last_seen_at: now } },
      { user_id: 'u2', role: 'member', last_read_at: now, profile: { full_name: 'Private', last_seen_at: now } },
      { user_id: 'u3', role: 'member', last_read_at: now, profile: { full_name: 'Open', last_seen_at: now } },
    ]);
    userRepo.listUserPreferences.mockResolvedValue([{ user_id: 'u2', messages: { readReceipts: false }, privacy: { showOnlineStatus: false } }]);
    const conv = await messageService.getConversation('u1', 'cv');
    const byId = Object.fromEntries(conv.members.map((m) => [m.id, m]));
    expect(byId.u2.lastReadAt).toBeNull();
    expect(byId.u2.online).toBe(false);
    expect(byId.u3.lastReadAt).toBe(now);
    expect(byId.u3.online).toBe(true);

    userRepo.listUserPreferences.mockResolvedValue([{ user_id: 'u1', messages: { readReceipts: false } }]);
    const mine = await messageService.getConversation('u1', 'cv');
    expect(mine.members.find((m) => m.id === 'u3').lastReadAt).toBeNull();
  });
});

describe('preferences', () => {
  it('keeps both of two concurrent partial updates (no lost write)', async () => {
    let stored = null;
    userRepo.getUserPreferences.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 5)); return stored; });
    userRepo.upsertUserPreferences.mockImplementation(async (row) => { await new Promise((r) => setTimeout(r, 5)); stored = row; return row; });
    await Promise.all([
      preferencesService.update('u1', { accessibility: { fontScale: 1.25 } }),
      preferencesService.update('u1', { accessibility: { highContrast: true } }),
    ]);
    expect(stored.accessibility).toMatchObject({ fontScale: 1.25, highContrast: true });
  });
});
