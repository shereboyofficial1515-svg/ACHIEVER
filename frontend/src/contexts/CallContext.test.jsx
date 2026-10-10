// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = {};
const get = vi.fn();
const post = vi.fn(async () => ({ data: {} }));
vi.mock('./RealtimeContext.jsx', () => ({ useRealtimeEvent: (event, h) => { handlers[event] = h; } }));
vi.mock('./AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('./ToastContext.jsx', () => ({ useToast: () => ({ error: vi.fn(), info: vi.fn() }) }));
vi.mock('./PreferencesContext.jsx', () => ({ usePreferences: () => ({ prefs: { messages: { callRingtone: false } } }) }));
vi.mock('../services/api.js', () => ({ api: { get: (...a) => get(...a), post: (...a) => post(...a) } }));
const { CallProvider } = await import('./CallContext.jsx');

const ID = '11111111-2222-3333-4444-555555555555';
const incoming = { id: ID, callType: 'voice', scope: 'direct', status: 'ringing', initiatedBy: 'caller', callerName: 'Ada' };
const dialogs = () => screen.queryAllByRole('alertdialog');

beforeEach(() => { get.mockReset(); post.mockClear(); });
afterEach(cleanup);

describe('incoming calls', () => {
  it('live event and push for the same call show ONE ringing screen', async () => {
    get.mockResolvedValue({ data: { ...incoming, participants: [{ userId: 'me', status: 'invited' }, { userId: 'caller', name: 'Ada' }] } });
    render(<CallProvider><p>app</p></CallProvider>);
    act(() => handlers['call.incoming'](incoming));
    await act(async () => { window.dispatchEvent(new CustomEvent('achiever:incoming-call', { detail: { callId: ID } })); });
    act(() => handlers['call.incoming'](incoming));
    expect(dialogs()).toHaveLength(1);
    expect(screen.getByText('Ada')).toBeTruthy();
  });

  it('a declined call never rings again, even if a late event arrives', async () => {
    render(<CallProvider><p>app</p></CallProvider>);
    act(() => handlers['call.incoming'](incoming));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Decline call' })));
    expect(post).toHaveBeenCalledWith(`/calls/${ID}/reject`);
    act(() => handlers['call.incoming'](incoming));
    expect(dialogs()).toHaveLength(0);
  });

  it('opening an old call notification does not ring when the server says the call ended', async () => {
    get.mockResolvedValue({ data: { ...incoming, status: 'missed', participants: [{ userId: 'me', status: 'missed' }] } });
    render(<CallProvider><p>app</p></CallProvider>);
    await act(async () => { window.dispatchEvent(new CustomEvent('achiever:incoming-call', { detail: { callId: ID } })); });
    expect(dialogs()).toHaveLength(0);
  });

  it('my own call does not ring me', () => {
    render(<CallProvider><p>app</p></CallProvider>);
    act(() => handlers['call.incoming']({ ...incoming, initiatedBy: 'me' }));
    expect(dialogs()).toHaveLength(0);
  });
});
