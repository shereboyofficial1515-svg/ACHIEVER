// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn(async () => ({ data: {} }));
vi.mock('../../services/api.js', () => ({ api: { get: (...a) => get(...a), post: (...a) => post(...a), put: vi.fn(), patch: vi.fn(), upload: vi.fn() } }));
vi.mock('../../contexts/RealtimeContext.jsx', () => ({ useRealtimeEvent: () => {} }));
vi.mock('../../contexts/CallContext.jsx', () => ({ useCalls: () => ({ startCall: vi.fn(), busy: false, inCall: false }) }));
vi.mock('../../contexts/ToastContext.jsx', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('../ui/ConfirmProvider.jsx', () => ({ useConfirm: () => async () => true }));
vi.mock('../../platform/index.js', () => ({ requestMicrophonePermission: vi.fn() }));
vi.mock('../../platform/overlays.js', () => ({ pushOverlay: () => () => {} }));
const ChatWindow = (await import('./ChatWindow.jsx')).default;

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); get.mockReset(); post.mockClear(); });

const now = Date.now();
const iso = (ms) => new Date(now - ms).toISOString();
const baseConv = {
  id: 'c1', type: 'group', title: 'Market Circle', group: { imageUrl: null }, settings: {},
  permissions: { canSend: true, canPin: false, canAnnounce: false, canManageSettings: false, canSeeOnline: true, isAdmin: false, canSeeMembers: true },
  me: { role: 'member', mutedUntil: null }, memberCount: 3, onlineCount: 2, blocked: null, pinned: [],
  members: [
    { id: 'me', name: 'Me', online: true, sharesReceipts: true, lastReadAt: iso(0), lastDeliveredAt: iso(0) },
    { id: 'u2', name: 'Aisha Peter', online: true, sharesReceipts: true, lastReadAt: iso(0), lastDeliveredAt: iso(0) },
    { id: 'u3', name: 'Bayo Ade', online: false, sharesReceipts: true, lastReadAt: iso(10 * 60_000), lastDeliveredAt: iso(0) },
  ],
};
const msg = (id, extra = {}) => ({ id, conversationId: 'c1', senderId: 'me', kind: 'text', body: `body ${id}`, deleted: false, createdAt: iso(60_000), reactions: [], attachments: [], ...extra });

function mount(conv, messages) {
  get.mockImplementation(async (url) => (url.endsWith('/messages') ? { data: { messages, hasMore: false } } : { data: conv }));
  return render(<MemoryRouter><ChatWindow conversationId="c1" currentUserId="me" onBack={() => {}} /></MemoryRouter>);
}

describe('chat window', () => {
  it('group header shows real member and online counts; tapping the name opens Group info', async () => {
    mount(baseConv, [msg('m1')]);
    await screen.findByText('3 members · 2 online');
    expect(screen.getByRole('button', { name: /Market Circle\. Group info/ })).toBeTruthy();
  });

  it('receipts come from what members share: delivered to all but not read by all → delivered', async () => {
    mount(baseConv, [msg('m1')]);
    await screen.findByLabelText('Delivered');
    expect(screen.queryByLabelText('Read')).toBeNull();
  });

  it('a member who hides receipts means "sent" only (never a fake read)', async () => {
    const conv = { ...baseConv, members: baseConv.members.map((m) => (m.id === 'u3' ? { ...m, sharesReceipts: false, lastReadAt: null, lastDeliveredAt: null } : m)) };
    mount(conv, [msg('m1')]);
    await screen.findByLabelText('Sent');
  });

  it('deleted messages show a tombstone; replies, edits and announcements are labelled', async () => {
    mount(baseConv, [
      msg('m1', { deleted: true, body: null }),
      msg('m2', { senderId: 'u2', kind: 'announcement', body: 'Contributions due Friday' }),
      msg('m3', { replyTo: { id: 'm2', senderId: 'u2', body: 'Contributions due Friday' }, editedAt: iso(0), body: 'Noted' }),
    ]);
    await screen.findByText('This message was deleted');
    expect(screen.getByText(/Group announcement/)).toBeTruthy();
    expect(screen.getByText('edited')).toBeTruthy();
    expect(screen.getAllByText('Contributions due Friday')).toHaveLength(2);
  });

  it('admins-only groups replace the composer for members', async () => {
    mount({ ...baseConv, permissions: { ...baseConv.permissions, canSend: false } }, []);
    await screen.findByText('Only group admins can send messages.');
    expect(screen.queryByLabelText('Message')).toBeNull();
  });

  it('selecting a message shows only the actions you may use', async () => {
    mount(baseConv, [msg('m1', { senderId: 'u2' })]);
    fireEvent.doubleClick(await screen.findByRole('article'));
    await waitFor(() => expect(screen.getByLabelText('Reply')).toBeTruthy());
    expect(screen.getByLabelText('Report')).toBeTruthy();
    expect(screen.queryByLabelText('Edit')).toBeNull();   // not your message
    expect(screen.queryByLabelText('Pin')).toBeNull();    // pinning is admin-only here
  });
});
