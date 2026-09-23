import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repositories/osusuRepository.js', () => ({
  findGroup: vi.fn(),
  findMembership: vi.fn(),
  findContribution: vi.fn(),
  findMember: vi.fn(),
  findCycle: vi.fn(),
  approvePayout: vi.fn(),
  countMembers: vi.fn(),
  updateMember: vi.fn(),
}));
vi.mock('../../src/repositories/collectorRepository.js', () => ({ findPlan: vi.fn(), findReturn: vi.fn(), approveReturn: vi.fn() }));
vi.mock('../../src/repositories/messageRepository.js', () => ({
  findMembership: vi.fn(), contactIds: vi.fn(), findByDirectKey: vi.fn(), insertConversation: vi.fn(), upsertMember: vi.fn(),
}));
vi.mock('../../src/repositories/callRepository.js', () => ({ findCall: vi.fn() }));
vi.mock('../../src/services/paymentService.js', () => ({ initialize: vi.fn() }));
vi.mock('../../src/services/payoutService.js', () => ({ execute: vi.fn() }));
vi.mock('../../src/services/auditService.js', () => ({ record: vi.fn() }));
vi.mock('../../src/services/notificationService.js', () => ({ notify: vi.fn(), kickDispatcher: vi.fn() }));
vi.mock('../../src/services/settingsService.js', () => ({ payoutMode: vi.fn().mockResolvedValue('manual') }));
vi.mock('../../src/integrations/livekit/livekitClient.js', () => ({
  createRoomToken: vi.fn().mockResolvedValue({ token: 'jwt', url: 'wss://lk' }), closeRoom: vi.fn(), receiveWebhook: vi.fn(),
}));

const osusuRepo = await import('../../src/repositories/osusuRepository.js');
const collectorRepo = await import('../../src/repositories/collectorRepository.js');
const messageRepo = await import('../../src/repositories/messageRepository.js');
const callRepo = await import('../../src/repositories/callRepository.js');
const paymentService = await import('../../src/services/paymentService.js');
const osusuService = await import('../../src/services/osusuService.js');
const collectorService = await import('../../src/services/collectorService.js');
const messageService = await import('../../src/services/messageService.js');
const callService = await import('../../src/services/callService.js');

const member = { id: 'u-member', email: 'm@example.com', fullName: 'Member', roles: ['OSUSU_MEMBER'] };
const outsider = { id: 'u-outsider', email: 'o@example.com', fullName: 'Outsider', roles: ['OSUSU_MEMBER'] };
const organiser = { id: 'u-admin', email: 'a@example.com', fullName: 'Organiser', roles: ['OSUSU_ADMIN', 'OSUSU_MEMBER'] };
const group = { id: 'g1', name: 'Market Women', admin_id: 'u-admin', status: 'active', contribution_amount: 2_000_000, max_members: 10 };

beforeEach(() => vi.clearAllMocks());

describe('Osusu authorisation', () => {
  it('denies group access to non-members', async () => {
    osusuRepo.findGroup.mockResolvedValue(group);
    osusuRepo.findMembership.mockResolvedValue(null);
    await expect(osusuService.listCycles(outsider, 'g1')).rejects.toMatchObject({ status: 403 });
  });

  it("will not let a user pay (or see) another member's contribution", async () => {
    osusuRepo.findContribution.mockResolvedValue({ id: 'c1', user_id: 'u-member', status: 'pending', amount: 2_000_000, group: { status: 'active' } });
    await expect(osusuService.payContribution(outsider, 'c1')).rejects.toMatchObject({ status: 404 });
    expect(paymentService.initialize).not.toHaveBeenCalled();
  });

  it('uses the server-side contribution amount, never a client value', async () => {
    osusuRepo.findContribution.mockResolvedValue({ id: 'c1', user_id: 'u-member', status: 'overdue', amount: 2_000_000, group_id: 'g1', cycle_number: 3, group: { status: 'active' } });
    await osusuService.payContribution(member, 'c1');
    expect(paymentService.initialize).toHaveBeenCalledWith(expect.objectContaining({ amount: 2_000_000, purpose: 'osusu_contribution', targetId: 'c1' }));
  });

  it('refuses to start a second payment for an already-paid contribution', async () => {
    osusuRepo.findContribution.mockResolvedValue({ id: 'c1', user_id: 'u-member', status: 'paid', amount: 2_000_000, group: { status: 'active' } });
    await expect(osusuService.payContribution(member, 'c1')).rejects.toMatchObject({ code: 'ALREADY_PAID' });
  });

  it('only the organiser may approve a payout', async () => {
    osusuRepo.findCycle.mockResolvedValue({ id: 'cy1', group_id: 'g1' });
    osusuRepo.findGroup.mockResolvedValue(group);
    osusuRepo.findMembership.mockResolvedValue({ status: 'active' });
    await expect(osusuService.approvePayout(member, 'cy1', {})).rejects.toMatchObject({ status: 403 });
    expect(osusuRepo.approvePayout).not.toHaveBeenCalled();
  });

  it('blocks member removal once rotation has started', async () => {
    osusuRepo.findMember.mockResolvedValue({ id: 'm1', group_id: 'g1', user_id: 'u-member', status: 'active' });
    osusuRepo.findGroup.mockResolvedValue(group);
    osusuRepo.findMembership.mockResolvedValue({ status: 'active' });
    await expect(osusuService.removeMember(organiser, 'm1', 'x', {})).rejects.toMatchObject({ code: 'MEMBER_REMOVAL_NOT_PERMITTED' });
  });

  it('prevents a member from leaving after the group starts (obligation to keep contributing)', async () => {
    osusuRepo.findGroup.mockResolvedValue(group);
    osusuRepo.findMembership.mockResolvedValue({ id: 'm1', status: 'active' });
    await expect(osusuService.leaveGroup(member, 'g1', {})).rejects.toMatchObject({ code: 'LEAVE_NOT_PERMITTED' });
  });
});

describe('Collector authorisation', () => {
  const plan = { id: 'p1', saver_id: 'u-saver', collector_id: 'u-collector', status: 'active', end_date: '2099-01-01' };

  it('only the saver can contribute to a plan', async () => {
    collectorRepo.findPlan.mockResolvedValue(plan);
    const collector = { id: 'u-collector', roles: ['COLLECTOR'] };
    await expect(collectorService.contribute(collector, { planId: 'p1', amount: 100000 })).rejects.toMatchObject({ status: 403 });
  });

  it('outsiders cannot view a plan', async () => {
    collectorRepo.findPlan.mockResolvedValue(plan);
    await expect(collectorService.getPlan({ id: 'u-x', roles: ['SAVER'] }, 'p1')).rejects.toMatchObject({ status: 403 });
  });

  it('rejects contributions after maturity', async () => {
    collectorRepo.findPlan.mockResolvedValue({ ...plan, status: 'matured' });
    await expect(collectorService.contribute({ id: 'u-saver', roles: ['SAVER'] }, { planId: 'p1', amount: 100000 })).rejects.toMatchObject({ code: 'PLAN_NOT_ACCEPTING' });
  });

  it("a saver cannot approve their own return — only the collector or finance staff", async () => {
    collectorRepo.findReturn.mockResolvedValue({ id: 'r1', collector_id: 'u-collector', saver_id: 'u-saver' });
    await expect(collectorService.approveReturn({ id: 'u-saver', roles: ['SAVER'] }, 'r1', {})).rejects.toMatchObject({ status: 403 });
    expect(collectorRepo.approveReturn).not.toHaveBeenCalled();
  });
});

describe('Chat and call permissions', () => {
  it('blocks reading a conversation without membership', async () => {
    messageRepo.findMembership.mockResolvedValue(null);
    await expect(messageService.listMessages('u-x', 'conv-1', { limit: 20 })).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
  });

  it('blocks members who have left', async () => {
    messageRepo.findMembership.mockResolvedValue({ left_at: '2026-01-01T00:00:00Z' });
    await expect(messageService.assertMember('u-x', 'conv-1')).rejects.toMatchObject({ status: 403 });
  });

  it('only allows direct messages between people who share a group or plan', async () => {
    messageRepo.contactIds.mockResolvedValue(['u-friend']);
    await expect(messageService.openDirect({ id: 'u-me', roles: ['OSUSU_MEMBER'] }, 'u-stranger')).rejects.toMatchObject({ code: 'NOT_A_CONTACT' });
  });

  it('issues LiveKit tokens only to call participants', async () => {
    callRepo.findCall.mockResolvedValue({ id: 'call-1', status: 'active', room_name: 'ach_call-1', participants: [{ user_id: 'u-a', status: 'joined' }] });
    await expect(callService.token({ id: 'u-b' }, 'call-1')).rejects.toMatchObject({ status: 403 });
    const ok = await callService.token({ id: 'u-a', fullName: 'A' }, 'call-1');
    expect(ok).toEqual({ token: 'jwt', url: 'wss://lk', roomName: 'ach_call-1' });
  });
});
