import { beforeEach, describe, expect, it, vi } from 'vitest';

// Messaging rules in the API (the database enforces send / announce / block again: messaging.test.sql).
const state = { receipts: true, messages: new Map(), members: new Map(), conv: null, hidden: [], pins: [], audits: [], published: [], updatedConv: null, contacts: [] };
const key = (c, u) => `${c}:${u}`;

vi.mock('../../src/repositories/messageRepository.js', () => ({
  findMembership: vi.fn(async (c, u) => state.members.get(key(c, u)) || null),
  findConversation: vi.fn(async () => state.conv),
  findMessage: vi.fn(async (id) => state.messages.get(id) || null),
  updateMessage: vi.fn(async (id, patch) => ({ ...Object.assign(state.messages.get(id), patch) })),
  hideMessage: vi.fn(async (id, u) => { state.hidden.push([id, u]); }),
  setReaction: vi.fn(async (id, _c, u, emoji) => { const m = state.messages.get(id); m.reactions = (m.reactions || []).filter((r) => r.user_id !== u); if (emoji) m.reactions.push({ user_id: u, emoji }); }),
  pin: vi.fn(async (_c, id) => { state.pins.push(id); }),
  unpin: vi.fn(async (_c, id) => { state.pins = state.pins.filter((x) => x !== id); }),
  updateConversation: vi.fn(async (_id, patch) => { state.updatedConv = { ...state.conv, ...patch }; return state.updatedConv; }),
  updateMember: vi.fn(async (c, u, patch) => Object.assign(state.members.get(key(c, u)), patch)),
  postMessage: vi.fn(async () => 'sys-1'),
  contactIds: vi.fn(async () => state.contacts),
  mutualGroups: vi.fn(async () => [{ id: 'g1', name: 'Market Circle', image_path: null }]),
  blockedBetween: vi.fn(async () => ({ iBlocked: false, blockedMe: false })),
  findByDirectKey: vi.fn(async () => null),
}));
vi.mock('../../src/repositories/userRepository.js', () => ({
  findManyBasic: vi.fn(async () => [{ id: 'u-other', full_name: 'Aisha Peter', avatar_path: null, last_seen_at: new Date().toISOString() }]),
  listUserPreferences: vi.fn(async () => []),
}));
vi.mock('../../src/services/profileService.js', () => ({
  trustProfile: vi.fn(async () => ({ displayName: 'Aisha P.', avatarUrl: null, location: 'Lagos', memberSince: '2026-01-01', active: true, verification: { email: true }, completedGroups: 2, onTimeRate: 100 })),
}));
vi.mock('../../src/services/preferencesService.js', () => ({
  flagsFor: vi.fn(async () => () => ({ readReceipts: state.receipts, showOnlineStatus: true })),
}));
vi.mock('../../src/services/auditService.js', () => ({ record: vi.fn(async (a) => { state.audits.push(a.action); }) }));
vi.mock('../../src/services/realtimeHub.js', () => ({ publishToConversation: vi.fn(async (c, e) => { state.published.push(e); }) }));
vi.mock('../../src/services/storageService.js', () => ({ publicUrl: (_b, p) => (p ? `https://cdn/${p}` : null) }));

const svc = await import('../../src/services/messageService.js');
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const msg = (id, extra = {}) => ({ id, conversation_id: 'c1', sender_id: 'u-me', kind: 'text', body: 'hello', created_at: ago(60_000), reactions: [], attachments: [], ...extra });
const me = { id: 'u-me', fullName: 'Me' };

beforeEach(() => {
  state.messages.clear(); state.members.clear(); state.hidden = []; state.pins = []; state.audits = []; state.published = []; state.contacts = []; state.receipts = true;
  state.conv = { id: 'c1', type: 'group', settings: {} };
  state.members.set(key('c1', 'u-me'), { role: 'member', can_pin: false, can_change_picture: false });
  state.members.set(key('c1', 'u-admin'), { role: 'admin' });
});

describe('permissions come from the real role and the group settings', () => {
  it('members vs admins, and "selected members" flags', () => {
    const member = svc.chatPermissions({ type: 'group', settings: { send: 'admins' } }, { role: 'member' });
    expect(member).toMatchObject({ isAdmin: false, canSend: false, canPin: false, canAnnounce: false, canManageSettings: false });
    expect(svc.chatPermissions({ type: 'group', settings: { pin: 'selected' } }, { role: 'member', can_pin: true }).canPin).toBe(true);
    expect(svc.chatPermissions({ type: 'group', settings: {} }, { role: 'admin' })).toMatchObject({ isAdmin: true, canSend: true, canAnnounce: true, canPin: true, canManageSettings: true });
    expect(svc.chatPermissions({ type: 'direct' }, { role: 'member' })).toMatchObject({ canSend: true, canPin: true, isAdmin: false });
  });
});

describe('edit and delete', () => {
  it('only your own message, within 15 minutes', async () => {
    state.messages.set('m1', msg('m1'));
    await expect(svc.editMessage('u-me', 'm1', 'hello again')).resolves.toMatchObject({ body: 'hello again', editedAt: expect.any(String) });
    state.messages.set('m2', msg('m2', { sender_id: 'u-admin' }));
    await expect(svc.editMessage('u-me', 'm2', 'x')).rejects.toMatchObject({ code: 'NOT_YOUR_MESSAGE' });
    state.messages.set('m3', msg('m3', { created_at: ago(20 * 60_000) }));
    await expect(svc.editMessage('u-me', 'm3', 'x')).rejects.toMatchObject({ code: 'EDIT_WINDOW_PASSED' });
    expect(state.published).toContain('message.updated');
  });

  it('delete for me hides it only for you; delete for everyone leaves a tombstone', async () => {
    state.messages.set('m1', msg('m1'));
    await svc.deleteMessage(me, 'm1', 'me');
    expect(state.hidden).toEqual([['m1', 'u-me']]);
    expect(state.messages.get('m1').deleted_at).toBeUndefined();
    await svc.deleteMessage(me, 'm1', 'everyone');
    expect(svc.formatMessage(state.messages.get('m1'))).toMatchObject({ deleted: true, body: null, attachments: [], reactions: [] });
  });

  it('members cannot delete others\' messages for everyone; group admins can (audited)', async () => {
    state.messages.set('m2', msg('m2', { sender_id: 'u-admin' }));
    await expect(svc.deleteMessage(me, 'm2', 'everyone')).rejects.toMatchObject({ code: 'NOT_YOUR_MESSAGE' });
    state.messages.set('m4', msg('m4'));
    await svc.deleteMessage({ id: 'u-admin' }, 'm4', 'everyone', {});
    expect(state.audits).toContain('chat.message.moderated_delete');
  });

  it('delete-for-everyone window is one hour for your own messages', async () => {
    state.messages.set('m5', msg('m5', { created_at: ago(2 * 3600_000) }));
    await expect(svc.deleteMessage(me, 'm5', 'everyone')).rejects.toMatchObject({ code: 'DELETE_WINDOW_PASSED' });
  });
});

describe('reactions and pins', () => {
  it('one supported reaction per person; changing it replaces it', async () => {
    state.messages.set('m1', msg('m1'));
    await svc.react('u-me', 'm1', '👍');
    const r = await svc.react('u-me', 'm1', '❤️');
    expect(r.reactions).toEqual([{ userId: 'u-me', emoji: '❤️' }]);
    await expect(svc.react('u-me', 'm1', '💩')).rejects.toMatchObject({ code: 'INVALID_REACTION' });
  });

  it('pinning follows the group setting', async () => {
    state.messages.set('m1', msg('m1'));
    await expect(svc.setPinned(me, 'c1', 'm1', true, {})).rejects.toMatchObject({ code: 'NOT_ALLOWED' });
    await svc.setPinned({ id: 'u-admin' }, 'c1', 'm1', true, {});
    expect(state.pins).toEqual(['m1']);
    expect(state.audits).toContain('chat.message.pinned');
  });
});

describe('group administration (server-side)', () => {
  it('only the admin can change group chat settings; changes are audited and announced', async () => {
    await expect(svc.updateGroupChat(me, 'c1', { settings: { send: 'admins' } }, {})).rejects.toMatchObject({ code: 'ADMIN_ONLY' });
    await svc.updateGroupChat({ id: 'u-admin' }, 'c1', { settings: { send: 'admins' }, reason: 'Contribution week' }, {});
    expect(state.updatedConv.settings.send).toBe('admins');
    expect(state.audits).toContain('chat.group.settings');
    await expect(svc.updateGroupChat({ id: 'u-admin' }, 'c1', { settings: { send: 'everyone!' } }, {})).rejects.toMatchObject({ code: 'INVALID_SETTING' });
  });

  it('selected-member permissions are admin-only', async () => {
    await expect(svc.setMemberPermissions(me, 'c1', 'u-admin', { canPin: true }, {})).rejects.toMatchObject({ code: 'ADMIN_ONLY' });
    await expect(svc.setMemberPermissions({ id: 'u-admin' }, 'c1', 'u-me', { canPin: true }, {})).resolves.toMatchObject({ canPin: true });
  });
});

describe('read receipts respect privacy', () => {
  it('reading updates your own state, but is only broadcast when you share read receipts', async () => {
    await svc.markRead('u-me', 'c1');
    expect(state.published).toEqual(['conversation.receipt']);
    state.published = [];
    state.receipts = false;
    await svc.markRead('u-me', 'c1');
    await svc.markDelivered('u-me', 'c1');
    expect(state.published).toEqual([]);
    expect(state.members.get(key('c1', 'u-me')).last_read_at).toEqual(expect.any(String));
  });
});

describe('profile from chat', () => {
  it('only people you share a group/plan with; public fields only', async () => {
    await expect(svc.personProfile(me, 'u-other')).rejects.toMatchObject({ status: 404 });
    state.contacts = ['u-other'];
    const p = await svc.personProfile(me, 'u-other');
    expect(p).toMatchObject({ fullName: 'Aisha Peter', location: 'Lagos', online: true, mutualGroups: [{ id: 'g1', name: 'Market Circle' }] });
    // Top-level fields are public profile data only (verification is badges, not the email address itself).
    for (const k of ['email', 'phone', 'address', 'bvn', 'nin', 'balance', 'bankAccount', 'walletBalance']) expect(p).not.toHaveProperty(k);
    expect(JSON.stringify(p)).not.toMatch(/@|\+234/);
  });
});
