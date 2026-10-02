// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const me = vi.fn();
vi.mock('../services/api.js', () => ({
  api: { get: (...a) => me(...a), post: vi.fn(async () => ({})), primeCsrf: vi.fn(async () => {}) },
  setSessionEndedHandler: vi.fn(),
}));
vi.mock('../services/pushDevice.js', () => ({ disablePushForSignOut: vi.fn(async () => {}) }));
vi.mock('../platform/index.js', () => ({ biometricEnrolment: () => null, flushNativeCookies: vi.fn(), signWithBiometrics: vi.fn() }));

const { AuthProvider, useAuth } = await import('./AuthContext.jsx');

function Probe() {
  const { status } = useAuth();
  return <p data-testid="s">{status}</p>;
}
const mount = async () => {
  await act(async () => { render(<AuthProvider><Probe /></AuthProvider>); });
  return screen.getByTestId('s').textContent;
};
const err = (status, code) => Object.assign(new Error(code), { status, code });

afterEach(() => { cleanup(); me.mockReset(); localStorage.clear(); });

describe('session restore on app start', () => {
  it('restores a valid session', async () => {
    me.mockResolvedValue({ data: { id: 'u1', emailVerified: true } });
    expect(await mount()).toBe('authenticated');
    expect(localStorage.getItem('achiever.signedIn')).toBe('1');
  });

  it('a network failure (offline / API waking up) keeps the session — never the sign-in page', async () => {
    localStorage.setItem('achiever.signedIn', '1');
    me.mockRejectedValue(err(0, 'NETWORK_ERROR'));
    expect(await mount()).toBe('unreachable');
    expect(localStorage.getItem('achiever.signedIn')).toBe('1');
  });

  it('a 502/503 from the gateway is also not a sign-out', async () => {
    me.mockRejectedValue(err(503, 'SERVICE_UNAVAILABLE'));
    expect(await mount()).toBe('unreachable');
  });

  it('rate limiting or a non-API response is not a sign-out (and never crashes)', async () => {
    localStorage.setItem('achiever.signedIn', '1');
    me.mockRejectedValueOnce(err(429, 'RATE_LIMITED'));
    expect(await mount()).toBe('unreachable');
    cleanup();
    me.mockResolvedValueOnce({ data: undefined });   // e.g. an HTML page returned with 200
    expect(await mount()).toBe('unreachable');
    expect(localStorage.getItem('achiever.signedIn')).toBe('1');
  });

  it('only a real authentication failure shows sign-in', async () => {
    localStorage.setItem('achiever.signedIn', '1');
    me.mockRejectedValue(err(401, 'SESSION_EXPIRED'));
    expect(await mount()).toBe('anonymous');
    expect(localStorage.getItem('achiever.signedIn')).toBeNull();
  });
});
