import { beforeEach, describe, expect, it, vi } from 'vitest';

// Messaging rules in the API (the database enforces send / announce / block again: messaging.test.sql).
const state = { pushes: [], delivered: [], connected: [], muted: [], sleep: false, preview: true, receipts: true, messages: new Map(), members: new Map(), conv: null, hidden: [], pins: [], audits: [], published: [], updatedConv: null, contacts: [] };
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
  postMessage: vi.fn(async (args) => { const id = `new-${state.messages.size + 1}`; state.messages.set(id, { id, conversation_id: args.conversationId, sender_id: args.senderId, kind: args.kind, body: args.body, created_at: new Date().toISOString(), reactions: [], attachments: [] }); return id; }),
  activeMemberIds: vi.fn(async () => ['u-me', 'u-admin', 'u-other']),
  mutedMemberIds: vi.fn(async (_c, ids) => ids.filter((id) => state.muted.includes(id))),
  contactIds: vi.fn(async () => state.contacts),
  mutualGroups: vi.fn(async () => [{ id: 'g1', name: 'Market Circle', image_path: null }]),
  blockedBetween: vi.fn(async () => ({ iBlocked: false, blockedMe: false })),
  findByDirectKey: vi.fn(async () => null),
  // Receipt watermarks: forward-only, like the conditional update in the repository.
  advanceReceipt: vi.fn(async (c, u, column, value) => {
    const m = state.members.get(key(c, u));
    if (!m || (m[column] && new Date(m[column]) >= new Date(value))) return null;
    m[column] = value;
    return { last_read_at: m.last_read_at ?? null, last_delivered_at: m.last_delivered_at ?? null };
  }),
  newestMessageAt: vi.fn(async (c, upTo) => {
    const list = [...state.messages.values()].filter((m) => m.conversation_id === c);
    if (upTo) return list.find((m) => m.id === upTo)?.created_at ?? null;
    return list.map((m) => m.created_at).sort().pop() ?? null;
  }),
  undeliveredConversations: vi.fn(async () => state.undelivered || []),
}));
vi.mock('../../src/repositories/userRepository.js', () => ({
  findManyBasic: vi.fn(async () => [{ id: 'u-other', full_name: 'Aisha Peter', avatar_path: null, last_seen_at: new Date().toISOString() }]),
  listUserPreferences: vi.fn(async () => []),
}));
vi.mock('../../src/services/profileService.js', () => ({
  trustProfile: vi.fn(async () => ({ displayName: 'Aisha P.', avatarUrl: null, location: 'Lagos', memberSince: '2026-01-01', active: true, verification: { email: true }, completedGroups: 2, onTimeRate: 100 })),
}));
vi.mock('../../src/services/preferencesService.js', () => ({
  flagsFor: vi.fn(async () => () => ({ readReceipts: state.receipts, showOnlineStatus: true, messagePreview: state.preview, sleepMode: state.sleep })),
}));
vi.mock('../../src/services/auditService.js', () => ({ record: vi.fn(async (a) => { state.audits.push(a.action); }) }));
vi.mock('../../src/services/realtimeHub.js', () => ({
  publishToConversation: vi.fn(async (c, e) => { state.published.push(e); }),
  publishMessage: vi.fn(async (m) => { state.delivered.push(m.id); }),
  isConnected: (id) => state.connected.includes(id),
}));
vi.mock('../../src/services/pushService.js', () => ({ isConfigured: () => true, send: vi.fn(async (item) => { state.pushes.push(item); return { ok: true }; }) }));
vi.mock('../../src/services/storageService.js', () => ({ publicUrl: (_b, p) => (p ? `https://cdn/${p}` : null) }));

const svc = await import('../../src/services/messageService.js');
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const msg = (id, extra = {}) => ({ id, conversation_id: 'c1', sender_id: 'u-me', kind: 'text', body: 'hello', created_at: ago(60_000), reactions: [], attachments: [], ...extra });
const me = { id: 'u-me', fullName: 'Me' };

beforeEach(() => {
  state.messages.clear(); state.members.clear(); state.hidden = []; state.pins = []; state.audits = []; state.published = []; state.contacts = []; state.receipts = true; state.pushes = []; state.delivered = []; state.connected = []; state.muted = []; state.sleep = false; state.preview = true;
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
  it('only your own message, within 10 minutes (server-enforced)', async () => {
    state.messages.set('m1', msg('m1'));
    await expect(svc.editMessage('u-me', 'm1', 'hello again')).resolves.toMatchObject({ body: 'hello again', editedAt: expect.any(String) });
    state.messages.set('m2', msg('m2', { sender_id: 'u-admin' }));
    await expect(svc.editMessage('u-me', 'm2', 'x')).rejects.toMatchObject({ code: 'NOT_YOUR_MESSAGE' });
    state.messages.set('m3', msg('m3', { created_at: ago(11 * 60_000) }));
    await expect(svc.editMessage('u-me', 'm3', 'x')).rejects.toMatchObject({ code: 'EDIT_WINDOW_PASSED' });
    state.messages.set('m6', msg('m6', { created_at: ago(9 * 60_000) }));
    await expect(svc.editMessage('u-me', 'm6', 'still in time')).resolves.toMatchObject({ id: 'm6', body: 'still in time' });
    expect(state.published).toContain('message.updated');
    expect(state.audits).toContain('chat.message.edited');   // previous text kept in the audit log
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

  it('delete-for-everyone window is 2 days for your own messages (server-enforced)', async () => {
    state.messages.set('m5', msg('m5', { created_at: ago(47 * 3600_000) }));
    await expect(svc.deleteMessage(me, 'm5', 'everyone')).resolves.toEqual({ deleted: 'everyone' });
    expect(state.audits).toContain('chat.message.deleted');
    state.messages.set('m7', msg('m7', { created_at: ago(49 * 3600_000) }));
    await expect(svc.deleteMessage(me, 'm7', 'everyone')).rejects.toMatchObject({ code: 'DELETE_WINDOW_PASSED' });
    await expect(svc.deleteMessage(me, 'm7', 'me')).resolves.toEqual({ deleted: 'me' });   // still possible for yourself
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

describe('new messages are delivered in real time and pushed to people not in the app', () => {
  it('a sent message is published to connected members straight away', async () => {
    const m = await svc.sendText('u-me', 'c1', 'hello team', { sender: { id: 'u-me', fullName: 'Ade Me' } });
    expect(state.delivered).toEqual([m.id]);
  });

  it('push goes to members who are not connected, not muted, not the sender', async () => {
    state.connected = ['u-admin'];
    await svc.sendText('u-me', 'c1', 'contribution reminder', { sender: { id: 'u-me', fullName: 'Ade Me' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(state.pushes.map((p) => p.user_id)).toEqual(['u-other']);
    expect(state.pushes[0]).toMatchObject({ category: 'messages', body: 'Ade: contribution reminder', data: { conversation_id: 'c1' }, quiet: false });
  });

  it('message previews off → generic text; sleep mode → silent channel; muted → no push', async () => {
    state.preview = false; state.sleep = true;
    await svc.sendText('u-me', 'c1', 'my secret', { sender: { id: 'u-me', fullName: 'Ade Me' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(state.pushes.every((p) => p.body === 'You have a new message' && p.quiet)).toBe(true);
    expect(JSON.stringify(state.pushes)).not.toContain('my secret');
    state.pushes = []; state.muted = ['u-admin', 'u-other'];
    await svc.sendText('u-me', 'c1', 'x', { sender: { id: 'u-me', fullName: 'Ade Me' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(state.pushes).toEqual([]);
  });
});

describe('read receipts respect privacy', () => {
  it('reading is stored; the read time is broadcast only when you share read receipts (delivery always is)', async () => {
    state.messages.set('m1', msg('m1', { sender_id: 'u-admin' }));
    await svc.markRead('u-me', 'c1');
    expect(state.published).toEqual(['conversation.receipt']);
    state.published = [];
    state.receipts = false;
    state.messages.set('m2', msg('m2', { sender_id: 'u-admin', created_at: ago(1000) }));
    await svc.markRead('u-me', 'c1');
    expect(state.published).toEqual(['conversation.receipt']);   // delivered moved; read time withheld (checked below)
    expect(state.members.get(key('c1', 'u-me')).last_read_at).toBe(state.messages.get('m2').created_at);
  });
});

describe('message status: sent, delivered, read', () => {
  const hub = async () => (await import('../../src/services/realtimeHub.js')).publishToConversation;
  beforeEach(async () => (await hub()).mockClear());

  it('read covers only the messages the app showed (upTo), never a message that arrived after', async () => {
    state.messages.set('m1', msg('m1', { sender_id: 'u-admin', created_at: ago(5000) }));
    state.messages.set('m2', msg('m2', { sender_id: 'u-admin', created_at: ago(1000) }));
    await svc.markRead('u-me', 'c1', { upTo: 'm1' });
    const me_ = state.members.get(key('c1', 'u-me'));
    expect(me_.last_read_at).toBe(state.messages.get('m1').created_at);
    expect(new Date(state.messages.get('m2').created_at) > new Date(me_.last_read_at)).toBe(true);   // m2 is still unread
    const [, event, payload] = (await hub()).mock.calls[0];
    expect(event).toBe('conversation.receipt');
    expect(payload).toMatchObject({ userId: 'u-me', lastReadAt: state.messages.get('m1').created_at });
  });

  it('a repeated or older read changes nothing and publishes no duplicate receipt', async () => {
    state.messages.set('m1', msg('m1', { sender_id: 'u-admin', created_at: ago(5000) }));
    state.messages.set('m2', msg('m2', { sender_id: 'u-admin', created_at: ago(1000) }));
    await expect(svc.markRead('u-me', 'c1', { upTo: 'm2' })).resolves.toEqual({ changed: true });
    await expect(svc.markRead('u-me', 'c1', { upTo: 'm2' })).resolves.toEqual({ changed: false });
    await expect(svc.markRead('u-me', 'c1', { upTo: 'm1' })).resolves.toEqual({ changed: false });   // never moves backwards
    expect((await hub()).mock.calls).toHaveLength(1);
    expect(state.members.get(key('c1', 'u-me')).last_read_at).toBe(state.messages.get('m2').created_at);
  });

  it('delivered is two grey ticks only: it never marks the message read', async () => {
    state.messages.set('m1', msg('m1', { sender_id: 'u-admin' }));
    await svc.markDelivered('u-me', 'c1', { upTo: 'm1' });
    const me_ = state.members.get(key('c1', 'u-me'));
    expect(me_.last_delivered_at).toBe(state.messages.get('m1').created_at);
    expect(me_.last_read_at).toBeUndefined();
    const [, , payload] = (await hub()).mock.calls[0];
    expect(payload.lastReadAt).toBeUndefined();
  });

  it('with read receipts off, delivery is still shared but the read time is not', async () => {
    state.receipts = false;
    state.messages.set('m1', msg('m1', { sender_id: 'u-admin' }));
    await svc.markRead('u-me', 'c1', { upTo: 'm1' });
    const [, , payload] = (await hub()).mock.calls[0];
    expect(payload).toMatchObject({ lastDeliveredAt: state.messages.get('m1').created_at });
    expect(payload.lastReadAt).toBeUndefined();
  });

  it('a message from another conversation cannot be used as the read boundary', async () => {
    state.messages.set('x1', msg('x1', { conversation_id: 'c2' }));
    await expect(svc.markRead('u-me', 'c1', { upTo: 'x1' })).rejects.toMatchObject({ code: 'MESSAGE_NOT_FOUND' });
    expect(state.members.get(key('c1', 'u-me')).last_read_at).toBeUndefined();
  });

  it('only members can report receipts', async () => {
    await expect(svc.markRead('u-stranger', 'c1')).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
  });

  it('opening the app marks waiting chats delivered (not read)', async () => {
    state.messages.set('m1', msg('m1', { sender_id: 'u-admin' }));
    state.undelivered = [{ conversation_id: 'c1' }];
    await expect(svc.markAllDelivered('u-me')).resolves.toEqual({ changed: 1 });
    expect(state.members.get(key('c1', 'u-me')).last_delivered_at).toBe(state.messages.get('m1').created_at);
    expect(state.members.get(key('c1', 'u-me')).last_read_at).toBeUndefined();
    state.undelivered = [];
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
