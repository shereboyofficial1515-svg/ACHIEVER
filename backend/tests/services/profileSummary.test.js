import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repositories/osusuRepository.js', () => ({
  listMemberships: vi.fn(async () => [{ group_id: 'g1', status: 'active' }, { group_id: 'g2', status: 'pending_approval' }]),
  listGroups: vi.fn(async ({ adminId, ids }) => (adminId
    ? { rows: [{ id: 'g2' }, { id: 'g3' }] }
    : { rows: ids.slice(0, 5).map((id) => ({ id, name: `Group ${id}`, image_path: id === 'g1' ? 'g1.webp' : null, contribution_amount: '2000000', frequency: 'biweekly', status: 'active', admin_id: id === 'g3' ? 'u1' : 'x', contact_email: 'secret@x.com' })) })),
}));
vi.mock('../../src/repositories/referralRepository.js', () => ({ countForReferrer: vi.fn(async () => 4) }));
vi.mock('../../src/repositories/paymentRepository.js', () => ({}));
vi.mock('../../src/repositories/collectorRepository.js', () => ({}));
vi.mock('../../src/services/collectorService.js', () => ({}));
vi.mock('../../src/services/onboardingService.js', () => ({}));
vi.mock('../../src/services/storageService.js', () => ({ publicUrl: (_b, p) => (p ? `https://cdn/${p}` : null) }));
vi.mock('../../src/services/profileService.js', () => ({
  trustProfile: vi.fn(async () => ({ completedGroups: 1, contributionsPaid: 12, onTimeRate: 100, verification: { email: true, identity: false }, memberSince: '2026-09-30', location: 'Warri, Delta' })),
}));
const { profileSummary } = await import('../../src/services/dashboardService.js');

describe('profile summary (one request for My Profile)', () => {
  it('real counts from the server, groups once each, only public group fields', async () => {
    const s = await profileSummary({ id: 'u1', roles: [] });
    expect(s.stats).toEqual({ groups: 3, completedGroups: 1, contributions: 12, onTimeRate: 100, referrals: 4 });
    expect(s.groups.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
    expect(s.groups[0]).toEqual({ id: 'g1', name: 'Group g1', imageUrl: 'https://cdn/g1.webp', contributionAmount: 2000000, frequency: 'biweekly', status: 'active', isAdmin: false });
    expect(s.groups[2].isAdmin).toBe(true);
    expect(JSON.stringify(s)).not.toContain('secret@');
    expect(s.verification).toEqual({ email: true, identity: false });
  });
});
