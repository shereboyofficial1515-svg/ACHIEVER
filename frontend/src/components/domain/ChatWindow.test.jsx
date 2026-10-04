// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn(async () => ({ data: {} }));
vi.mock('../../services/api.js', () => ({ api: { get: (...a) => get(...a), post: (...a) => post(...a), put: vi.fn(), patch: vi.fn(), upload: vi.fn(), uploadWithProgress: vi.fn() } }));
// Realtime: tests fire events through the captured handlers.
const handlers = new Map();
vi.mock('../../contexts/RealtimeContext.jsx', () => ({
  useRealtimeEvent: (event, fn) => { handlers.set(event, fn); },
  useRealtime: () => ({ status: 'connected' }),
}));
vi.mock('../../contexts/CallContext.jsx', () => ({ useCalls: () => ({ startCall: vi.fn(), busy: false, inCall: false }) }));
vi.mock('../../contexts/ToastContext.jsx', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('../ui/ConfirmProvider.jsx', () => ({ useConfirm: () => async () => true }));
vi.mock('../../platform/index.js', () => ({ requestMicrophonePermission: vi.fn(), isNative: () => false, openExternalLink: vi.fn(), saveFile: vi.fn(), shareGeneratedFile: vi.fn() }));
vi.mock('../../platform/overlays.js', () => ({ pushOverlay: () => () => {} }));
vi.mock('../../utils/sounds.js', () => ({ playSound: vi.fn() }));
const ChatWindow = (await import('./ChatWindow.jsx')).default;
const { __resetMediaCache } = await import('../../utils/mediaCache.js');

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.MediaRecorder = function MediaRecorder() {};
  navigator.mediaDevices = { getUserMedia: vi.fn() };
});
afterEach(() => { cleanup(); get.mockReset(); post.mockClear(); handlers.clear(); __resetMediaCache(); });

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

function mount(conv, messages, extraGet) {
  get.mockImplementation(async (url, params) => {
    if (extraGet) { const r = await extraGet(url, params); if (r) return r; }
    return url.endsWith('/messages') ? { data: { messages, hasMore: false } } : { data: conv };
  });
  return render(<MemoryRouter><ChatWindow conversationId="c1" currentUserId="me" onBack={() => {}} /></MemoryRouter>);
}
const composer = () => screen.getByLabelText('Message');

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

  it('edit is offered for 10 minutes only', async () => {
    mount(baseConv, [msg('m1', { createdAt: iso(9 * 60_000) }), msg('m2', { createdAt: iso(11 * 60_000), body: 'older' })]);
    const [newer, older] = await screen.findAllByRole('article');
    fireEvent.doubleClick(older);
    await waitFor(() => expect(screen.getByLabelText('Reply')).toBeTruthy());
    expect(screen.queryByLabelText('Edit')).toBeNull();
    fireEvent.click(screen.getByLabelText('Close message actions'));
    fireEvent.doubleClick(newer);
    await waitFor(() => expect(screen.getByLabelText('Edit')).toBeTruthy());
  });
});

describe('message input: Send/Mic follows the real value', () => {
  it('typing, paste and programmatic input all switch Mic → Send; spaces only stay Mic', async () => {
    mount(baseConv, []);
    await screen.findByLabelText('Record a voice message');
    fireEvent.change(composer(), { target: { value: '   ' } });
    expect(screen.getByLabelText('Record a voice message')).toBeTruthy();
    // Paste / clipboard chip: the value changes through an input event, no key press.
    composer().value = 'pasted text';
    fireEvent.input(composer());
    await screen.findByLabelText('Send message');
    fireEvent.change(composer(), { target: { value: '' } });
    await screen.findByLabelText('Record a voice message');
    composer().value = 'from paste event';
    fireEvent.paste(composer());
    await screen.findByLabelText('Send message');
  });
});

describe('realtime', () => {
  it('a new message appears without refresh, once, in created_at order', async () => {
    mount(baseConv, [msg('m1', { createdAt: iso(120_000) }), msg('m3', { createdAt: iso(10_000) })]);
    await screen.findByText('body m1');
    const incoming = msg('m2', { senderId: 'u2', body: 'hello from Aisha', createdAt: iso(60_000) });
    act(() => handlers.get('message.new')(incoming));
    act(() => handlers.get('message.new')(incoming));   // delivered twice (e.g. reconnect overlap)
    await screen.findByText('hello from Aisha');
    expect(screen.getAllByText('hello from Aisha')).toHaveLength(1);
    const texts = [...document.querySelectorAll('.msg-text')].map((n) => n.textContent);
    expect(texts).toEqual(['body m1', 'hello from Aisha', 'body m3']);
  });

  it('after a reconnect it fetches what was missed (after the newest message) and merges it', async () => {
    const missed = msg('m9', { senderId: 'u2', body: 'sent while offline', createdAt: iso(1000) });
    let asked = null;
    mount(baseConv, [msg('m1')], async (url, params) => {
      if (url.endsWith('/messages') && params?.after) { asked = params; return { data: { messages: [missed], hasMore: false } }; }
      return null;
    });
    await screen.findByText('body m1');
    await act(async () => { await handlers.get('resync')({}); });
    await screen.findByText('sent while offline');
    expect(asked.after).toBe(msg('m1').createdAt);
  });
});

describe('media', () => {
  it('tapping a loaded photo opens the full-screen viewer with the same URL (no second download)', async () => {
    let urlCalls = 0;
    mount(baseConv, [msg('m1', { kind: 'attachment', body: null, attachments: [{ id: 'a1', fileName: 'receipt.jpg', mimeType: 'image/jpeg', sizeBytes: 120_000 }] })], async (url) => {
      if (url.includes('/attachments/a1/url')) { urlCalls += 1; return { data: { url: 'https://storage.example/signed/receipt.jpg?token=x' } }; }
      return null;
    });
    const thumb = await screen.findByRole('button', { name: /Photo: receipt\.jpg/ });
    await waitFor(() => expect(thumb.querySelector('img')).toBeTruthy());
    fireEvent.click(thumb);
    const viewer = await screen.findByRole('dialog', { name: 'receipt.jpg' });
    expect(viewer.querySelector('img').getAttribute('src')).toBe('https://storage.example/signed/receipt.jpg?token=x');
    expect(urlCalls).toBe(1);
    expect(screen.getByLabelText('Share')).toBeTruthy();
    expect(screen.getByLabelText('Download')).toBeTruthy();
  });

  it('the attach button opens Camera / Photos / Video / Document instead of a file picker', async () => {
    mount(baseConv, []);
    fireEvent.click(await screen.findByLabelText(/Attach: camera, photos, video or document/));
    const sheet = await screen.findByRole('dialog', { name: 'Attach' });
    expect([...sheet.querySelectorAll('.attach-option')].map((b) => b.textContent)).toEqual(['Camera', 'Photos', 'Video', 'Document']);
  });
});
