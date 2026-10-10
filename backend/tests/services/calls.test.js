import { beforeEach, describe, expect, it, vi } from 'vitest';

// Call lifecycle with an in-memory call store: who may end a call for everyone,
// who gets rung (live event + push), and how the ringing notification is replaced.
vi.stubEnv('LIVEKIT_API_KEY', 'lk-key');
vi.stubEnv('LIVEKIT_API_SECRET', 'lk-secret-that-is-long-enough-123456');
vi.stubEnv('LIVEKIT_URL', 'wss://lk.example');

const st = { calls: new Map(), members: new Map(), conv: new Map(), closed: [], pushes: [], live: [] };
const clone = (x) => JSON.parse(JSON.stringify(x));

vi.mock('../../src/repositories/callRepository.js', () => ({
  insertCall: vi.fn(async (row) => { const c = { started_at: new Date().toISOString(), participants: [], ...row }; st.calls.set(c.id, c); return clone(c); }),
  findCall: vi.fn(async (id) => (st.calls.has(id) ? clone(st.calls.get(id)) : null)),
  findLiveCall: vi.fn(async (conv) => [...st.calls.values()].find((c) => c.conversation_id === conv && ['ringing', 'active'].includes(c.status)) || null),
  insertParticipants: vi.fn(async (rows) => { for (const r of rows) { const c = st.calls.get(r.call_id); if (!c.participants.some((p) => p.user_id === r.user_id)) c.participants.push({ ...r }); } }),
  updateParticipant: vi.fn(async (callId, userId, patch) => { const p = st.calls.get(callId).participants.find((x) => x.user_id === userId); if (p) Object.assign(p, patch); }),
  listParticipants: vi.fn(async (callId) => clone(st.calls.get(callId).participants)),
  transitionCall: vi.fn(async (id, from, patch) => { const c = st.calls.get(id); if (!from.includes(c.status)) return null; Object.assign(c, patch); return clone(c); }),
  findCallByRoom: vi.fn(), history: vi.fn(async () => []),
}));
vi.mock('../../src/repositories/messageRepository.js', () => ({
  findConversation: vi.fn(async (id) => st.conv.get(id)),
  activeMemberIds: vi.fn(async (id) => [...st.members.entries()].filter(([k, m]) => k.startsWith(`${id}:`) && !m.left_at).map(([k]) => k.split(':')[1])),
  findMembership: vi.fn(async (conv, uid) => st.members.get(`${conv}:${uid}`) || null),
}));
vi.mock('../../src/repositories/meetingRepository.js', () => ({ findByCall: vi.fn(async () => null), update: vi.fn() }));
vi.mock('../../src/repositories/paymentRepository.js', () => ({ recordWebhook: vi.fn(), updateWebhook: vi.fn() }));
vi.mock('../../src/services/auditService.js', () => ({ record: vi.fn(async () => {}) }));
vi.mock('../../src/services/storageService.js', () => ({ publicUrl: () => null }));
vi.mock('../../src/services/messageService.js', () => ({
  assertMember: vi.fn(async (uid, conv) => {
    const m = st.members.get(`${conv}:${uid}`);
    if (!m || m.left_at) throw Object.assign(new Error('You are not a member of this conversation'), { status: 403, code: 'NOT_A_MEMBER' });
    return m;
  }),
  postSystemMessage: vi.fn(async () => {}),
}));
vi.mock('../../src/services/realtimeHub.js', () => ({ publishToUsers: vi.fn((ids, event, payload) => st.live.push({ ids, event, payload })) }));
vi.mock('../../src/services/pushService.js', () => ({ sendCall: vi.fn(async (uid, call, kind) => { st.pushes.push({ uid, kind, callId: call.id }); return { ok: true }; }) }));
vi.mock('../../src/integrations/livekit/livekitClient.js', async (orig) => ({
  ...(await orig()),
  closeRoom: vi.fn(async (room) => { st.closed.push(room); }),
}));

const calls = await import('../../src/services/callService.js');
const { createRoomToken } = await import('../../src/integrations/livekit/livekitClient.js');

const U = (id) => ({ id, fullName: `User ${id}` });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  st.calls.clear(); st.members.clear(); st.conv.clear(); st.closed.length = 0; st.pushes.length = 0; st.live.length = 0;
  st.conv.set('g1', { id: 'g1', type: 'group' });
  st.conv.set('d1', { id: 'd1', type: 'direct' });
  for (const [uid, role] of [['ini', 'member'], ['adm', 'admin'], ['m3', 'member'], ['m4', 'member']]) st.members.set(`g1:${uid}`, { role, left_at: null });
  for (const uid of ['a', 'b']) st.members.set(`d1:${uid}`, { role: 'member', left_at: null });
});

async function groupCall() {
  const r = await calls.startCall(U('ini'), { conversationId: 'g1', callType: 'voice' });
  for (const uid of ['adm', 'm3']) await calls.joinCall(U(uid), r.call.id);
  return r.call.id;
}

describe('group calls: only the person who started the call can end it for everyone', () => {
  it('a participant pressing "end" only leaves; the call stays active and the room is not closed', async () => {
    const id = await groupCall();
    const res = await calls.endCall(U('m3'), id);
    expect(res).toEqual({ ended: false, left: true });
    expect(st.calls.get(id).status).toBe('active');
    expect(st.calls.get(id).participants.find((p) => p.user_id === 'm3').status).toBe('left');
    expect(st.closed).toEqual([]);
  });

  it('a group admin who did not start the call cannot end it either', async () => {
    const id = await groupCall();
    expect(await calls.endCall(U('adm'), id)).toEqual({ ended: false, left: true });
    expect(st.calls.get(id).status).toBe('active');
    expect(st.closed).toEqual([]);
  });

  it('the initiator (from the stored call record) ends it for everyone and the room is closed', async () => {
    const id = await groupCall();
    expect(await calls.endCall(U('ini'), id)).toEqual({ ended: true, left: false });
    expect(st.calls.get(id)).toMatchObject({ status: 'ended', ended_by: 'ini' });
    expect(st.closed).toEqual([`ach_${id}`]);
  });

  it('if the initiator leaves, the call goes on; it closes only when the last person leaves', async () => {
    const id = await groupCall();
    await calls.leaveCall(U('ini'), id);
    expect(st.calls.get(id).status).toBe('active');
    await calls.leaveCall(U('adm'), id);
    expect(st.calls.get(id).status).toBe('active');
    await calls.leaveCall(U('m3'), id);
    expect(st.calls.get(id).status).toBe('ended');
  });

  it('someone outside the call cannot end, join or get a token', async () => {
    const id = await groupCall();
    st.members.set('g1:out', { role: 'admin', left_at: null });
    await expect(calls.endCall(U('out'), id)).rejects.toMatchObject({ status: 403 });
    await expect(calls.token(U('out'), id)).rejects.toMatchObject({ status: 403 });
    expect(st.calls.get(id).status).toBe('active');
  });

  it('a member who left the group cannot rejoin a call they were invited to', async () => {
    const id = await groupCall();
    st.members.get('g1:m4').left_at = '2026-10-10T00:00:00Z';
    await expect(calls.joinCall(U('m4'), id)).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
  });
});

describe('ringing: live event and push to the invited people only', () => {
  it('a direct call rings the other person (not the caller), with identifiers only', async () => {
    const r = await calls.startCall(U('a'), { conversationId: 'd1', callType: 'video' });
    await flush();
    expect(st.live).toEqual([expect.objectContaining({ ids: ['b'], event: 'call.incoming', payload: expect.objectContaining({ id: r.call.id, status: 'ringing', initiatedBy: 'a' }) })]);
    expect(st.pushes).toEqual([{ uid: 'b', kind: 'ring', callId: r.call.id }]);
    expect(JSON.stringify(st.live)).not.toMatch(/token|lk-secret|ach_/);
  });

  it('a group call rings every member except the initiator', async () => {
    await calls.startCall(U('ini'), { conversationId: 'g1', callType: 'voice' });
    await flush();
    expect(st.pushes.map((p) => p.uid).sort()).toEqual(['adm', 'm3', 'm4']);
  });

  it('a second start in the same conversation joins the live call instead of ringing again', async () => {
    const first = await calls.startCall(U('a'), { conversationId: 'd1', callType: 'voice' });
    await flush();
    st.pushes.length = 0;
    const second = await calls.startCall(U('b'), { conversationId: 'd1', callType: 'voice' });
    await flush();
    expect(second.call.id).toBe(first.call.id);
    expect(st.pushes.filter((p) => p.kind === 'ring')).toEqual([]);
  });

  it('caller hangs up before an answer: the ringing phone gets "missed" (cancelled) instead', async () => {
    const r = await calls.startCall(U('a'), { conversationId: 'd1', callType: 'voice' });
    await calls.endCall(U('a'), r.call.id);
    await flush();
    expect(st.calls.get(r.call.id).status).toBe('cancelled');
    expect(st.pushes.at(-1)).toEqual({ uid: 'b', kind: 'cancelled', callId: r.call.id });
  });

  it('declining stops the ringing on the decliner’s other phones; answering does the same', async () => {
    const r1 = await calls.startCall(U('a'), { conversationId: 'd1', callType: 'voice' });
    await calls.rejectCall(U('b'), r1.call.id);
    await flush();
    expect(st.calls.get(r1.call.id).status).toBe('rejected');
    expect(st.pushes.at(-1)).toMatchObject({ uid: 'b', kind: 'ended' });

    const r2 = await calls.startCall(U('a'), { conversationId: 'd1', callType: 'voice' });
    await calls.acceptCall(U('b'), r2.call.id);
    await flush();
    expect(st.calls.get(r2.call.id).status).toBe('active');
    expect(st.pushes.at(-1)).toMatchObject({ uid: 'b', kind: 'answered' });
  });

  it('an ended call cannot be answered', async () => {
    const r = await calls.startCall(U('a'), { conversationId: 'd1', callType: 'voice' });
    await calls.endCall(U('a'), r.call.id);
    await expect(calls.acceptCall(U('b'), r.call.id)).rejects.toMatchObject({ code: 'CALL_ENDED' });
  });
});

describe('LiveKit tokens are least-privilege', () => {
  it('one room, join/publish/subscribe only: no room admin, room create or recording rights', async () => {
    const { token } = await createRoomToken({ roomName: 'ach_x', identity: 'u1', name: 'U' });
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(claims.video).toMatchObject({ room: 'ach_x', roomJoin: true, canPublish: true, canSubscribe: true });
    for (const k of ['roomAdmin', 'roomCreate', 'roomList', 'roomRecord', 'ingressAdmin']) expect(claims.video[k]).toBeFalsy();
    expect(claims.sub).toBe('u1');
  });
});
