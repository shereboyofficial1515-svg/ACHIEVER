import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node-side referral rules. The qualification engine itself (six vs five,
// three weeks, verification, activity, flags, two-person payment) is tested in
// supabase/tests/database/bills_referrals.test.sql against real Postgres.
const codes = new Map([['ACH-8F4K2Q', { code: 'ACH-8F4K2Q', user_id: 'ref-1', disabled_at: null }], ['ACH-DDDDDD', { code: 'ACH-DDDDDD', user_id: 'ref-2', disabled_at: 'x' }]]);
const profiles = {
  'ref-1': { id: 'ref-1', first_name: 'john', last_name: 'adewale', full_name: 'John Adewale', account_status: 'active' },
  'ref-3': { id: 'ref-3', first_name: 'Private', last_name: 'Person', full_name: 'Private Person', account_status: 'active' },
};
vi.mock('../../src/repositories/referralRepository.js', () => ({
  findCode: vi.fn(async (c) => codes.get(c) || null),
  ensureCode: vi.fn(async () => 'ACH-8F4K2Q'),
  createReferral: vi.fn(async () => ({ outcome: 'created' })),
  listForReferrer: vi.fn(async () => [
    { id: 'r1', status: 'QUALIFYING', status_reason: 'Waiting for qualifying activity', flag_status: null, reward_id: null, created_at: '2026-09-10',
      referred: { first_name: 'Bola', last_name: 'Tinubu-Okafor', full_name: 'Bola Tinubu-Okafor', account_status: 'active', email: 'bola@x.ng', phone: '+2348030000000' },
      qualification: [{ verified: true, osusu_met: true, days_elapsed: 14, activity_count: 0, checks: {} }] },
    { id: 'r2', status: 'QUALIFIED', flag_status: 'SUSPICIOUS', reward_id: null, created_at: '2026-09-01',
      referred: { first_name: 'Chidi', last_name: 'Eze', account_status: 'active' }, qualification: [{ verified: true, osusu_met: true, days_elapsed: 23, activity_count: 2 }] },
  ]),
  listRewards: vi.fn(async () => [{ id: 'w1', amount: 1500000, status: 'PAID', created_at: 'x' }]),
}));
vi.mock('../../src/repositories/userRepository.js', () => ({ findById: vi.fn(async (id) => profiles[id] || null) }));
vi.mock('../../src/services/preferencesService.js', () => ({
  get: vi.fn(async (id) => ({ privacy: { showNameToReferrals: id !== 'ref-3' } })),
}));
vi.mock('../../src/services/settingsService.js', () => ({
  get: vi.fn(async (_k, d) => d), getInt: vi.fn(async (_k, d) => d), getBool: vi.fn(async (_k, d) => d),
}));
vi.mock('../../src/services/auditService.js', () => ({ record: vi.fn(async () => null) }));

const referralService = await import('../../src/services/referralService.js');
const referralRepo = await import('../../src/repositories/referralRepository.js');
const { register } = await import('../../src/validators/authValidators.js');

beforeEach(() => vi.clearAllMocks());

describe('referral codes', () => {
  it('valid code shows only a masked referrer name', async () => {
    expect(await referralService.validateCode(' ach-8f4k2q ')).toEqual({ valid: true, code: 'ACH-8F4K2Q', referredBy: 'John A.' });
  });

  it('respects the referrer choosing not to show their name', async () => {
    codes.set('ACH-PPPPPP', { code: 'ACH-PPPPPP', user_id: 'ref-3', disabled_at: null });
    expect((await referralService.validateCode('ACH-PPPPPP')).referredBy).toBe('An ACHIEVER member');
  });

  it('rejects unknown, malformed and disabled codes', async () => {
    expect((await referralService.validateCode('ACH-ZZZZZZ')).valid).toBe(false);
    expect((await referralService.validateCode('1234')).valid).toBe(false);
    expect((await referralService.validateCode('ACH-DDDDDD')).valid).toBe(false);
  });
});

describe('registration', () => {
  const base = {
    accountType: 'osusu', role: 'member', firstName: 'Ada', lastName: 'Obi', gender: 'female', dateOfBirth: '1990-01-01',
    email: 'ada@example.com', phone: '+2348031234567', stateCode: 'LA', lgaId: 1, city: 'Ikeja', password: 'A-long-Password-1',
    acceptTerms: true, acceptPrivacy: true,
  };
  it('the client cannot name a referrer or mark itself qualified — only a code is accepted', () => {
    const parsed = register.safeParse({ ...base, referralCode: 'ach-8f4k2q', referrerId: 'attacker', referredByUserId: 'x', qualified: true, rewardStatus: 'PAID' });
    expect(parsed.success).toBe(true);
    expect(parsed.data.referralCode).toBe('ACH-8F4K2Q');
    for (const k of ['referrerId', 'referredByUserId', 'qualified', 'rewardStatus']) expect(parsed.data).not.toHaveProperty(k);
  });

  it('a malformed referral code is refused by validation', () => {
    expect(register.safeParse({ ...base, referralCode: 'ACH-0O1I00' }).success).toBe(false);
  });

  it('attaching after registration goes through the database function and never blocks sign-up on error', async () => {
    referralRepo.createReferral.mockRejectedValueOnce(new Error('db down'));
    await expect(referralService.attachAfterRegistration('new-user', 'ACH-8F4K2Q', {})).resolves.toBeNull();
    await referralService.attachAfterRegistration('new-user', 'ach-8f4k2q', {});
    expect(referralRepo.createReferral).toHaveBeenLastCalledWith('new-user', 'ACH-8F4K2Q');
  });
});

describe('member dashboard', () => {
  it('shows progress with masked names and no private data', async () => {
    const d = await referralService.dashboard({ id: 'ref-1', emailVerified: true });
    expect(d.code).toBe('ACH-8F4K2Q');
    expect(d.link).toMatch(/\/register\?ref=ACH-8F4K2Q$/);
    expect(d.referrals[0]).toMatchObject({ name: 'Bola T.', status: 'QUALIFYING', daysActive: 14, requiredDays: 21, activities: 0, osusuActive: true });
    const text = JSON.stringify(d);
    expect(text).not.toMatch(/bola@x\.ng|\+234803|Tinubu-Okafor|bvn|nin/i);
    expect(d.referrals[1]).toMatchObject({ underReview: true });   // held neutrally, not labelled "fraud"
    expect(text).not.toMatch(/SUSPICIOUS/);
    expect(d.stats).toMatchObject({ registered: 2, qualified: 1, pending: 1, paidRewards: 1500000 });
    expect(d.programme).toMatchObject({ rewardAmount: 1500000, requiredReferrals: 6, qualificationDays: 21 });
  });

  it('needs a verified email to get a code', async () => {
    await expect(referralService.myCode({ id: 'ref-1', emailVerified: false })).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });
});
