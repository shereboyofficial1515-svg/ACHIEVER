// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('../../services/api.js', () => ({ api: { post: (...a) => post(...a) }, newIdempotencyKey: () => 'idem-key-123' }));
vi.mock('../../platform/index.js', () => ({
  biometricEnrolment: () => null, forgetBiometrics: vi.fn(), isNative: () => false, signWithBiometrics: vi.fn(), hapticFeedback: vi.fn(),
}));
vi.mock('../../hooks/useSecureScreen.js', () => ({ useSecureScreen: () => {} }));
const TransactionApproval = (await import('./TransactionApproval.jsx')).default;

const typePin = (pin) => { for (const d of pin) fireEvent.click(screen.getByRole('button', { name: d })); };
const mount = (props) => render(
  <MemoryRouter>
    <TransactionApproval amount={200000} title="Wallet transfer" authorizeUrl="/wallet/transfers/t1/authorize" confirmUrl="/wallet/transfers/t1/confirm" onCancel={() => {}} {...props} />
  </MemoryRouter>,
);
const err = (code, message) => Object.assign(new Error(message), { code });

afterEach(() => { cleanup(); post.mockReset(); });

describe('transaction approval', () => {
  it('small amount: the PIN alone approves (no email code)', async () => {
    const approved = vi.fn();
    post.mockImplementation(async (url) => (url.endsWith('/authorize') ? { data: { challengeId: 'c1', method: 'pin' } } : { data: { status: 'SUCCESS' } }));
    mount({ onApproved: approved, options: { methods: ['pin', 'email_otp', 'device_biometric'] } });
    typePin('482915');
    await waitFor(() => expect(approved).toHaveBeenCalledWith({ status: 'SUCCESS' }));
    expect(post).toHaveBeenNthCalledWith(1, '/wallet/transfers/t1/authorize', { method: 'pin', pin: '482915' });
    expect(post).toHaveBeenNthCalledWith(2, '/wallet/transfers/t1/confirm', { challengeId: 'c1' }, { idempotencyKey: 'idem-key-123' });
  });

  it('server asks for a step-up: explains why, then asks for the emailed code', async () => {
    const approved = vi.fn();
    post.mockImplementation(async (url, body) => {
      if (url.endsWith('/authorize') && body.method === 'pin') throw err('TX_STEP_UP_REQUIRED', 'For larger amounts we also send a code to your email.');
      if (url.endsWith('/authorize')) return { data: { challengeId: 'c2', method: 'email_otp', sentTo: 'm***@example.com' } };
      return { data: { status: 'SUCCESS' } };
    });
    mount({ onApproved: approved });
    typePin('482915');
    await screen.findByText(/we also send a code to your email/i);
    await screen.findByText(/m\*\*\*@example.com/);
    typePin('123456');
    await waitFor(() => expect(approved).toHaveBeenCalled());
    expect(post).toHaveBeenLastCalledWith('/wallet/transfers/t1/confirm', { challengeId: 'c2', code: '123456' }, { idempotencyKey: 'idem-key-123' });
  });

  it('when PIN-only is not allowed it goes straight to PIN + emailed code', async () => {
    post.mockResolvedValue({ data: { challengeId: 'c3', method: 'email_otp', sentTo: 'x' } });
    mount({ onApproved: vi.fn(), options: { methods: ['email_otp', 'device_biometric'], reason: 'Automatic payments need your PIN and a code sent to your email.' } });
    expect(screen.getByText(/Automatic payments need/)).toBeTruthy();
    typePin('482915');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/wallet/transfers/t1/authorize', { method: 'email_otp', pin: '482915' }));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('a wrong PIN shows the server message and clears the keypad', async () => {
    post.mockRejectedValue(err('TRANSACTION_PIN_INVALID', 'Incorrect transaction PIN. 4 attempt(s) left.'));
    mount({ onApproved: vi.fn() });
    typePin('000001');
    await screen.findByText(/4 attempt\(s\) left/);
    expect(screen.getByRole('status').textContent).toBe('0 of 6 digits entered');
  });
});
