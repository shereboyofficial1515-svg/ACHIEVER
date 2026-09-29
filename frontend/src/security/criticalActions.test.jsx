// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider, useConfirm } from '../components/ui/ConfirmProvider.jsx';
import { CRITICAL_ACTIONS } from './criticalActions.js';
import { closeTopOverlay } from '../platform/overlays.js';
import { useSingleFlight } from '../hooks/useSingleFlight.js';

vi.mock('../contexts/ToastContext.jsx', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
const { usePaymentReview } = await import('../components/domain/usePaymentReview.js');

afterEach(cleanup);

let confirmAction;
function Grab() {
  confirmAction = useConfirm();
  return <button type="button">opener</button>;
}
function setup() {
  render(<MemoryRouter><ConfirmProvider><Grab /></ConfirmProvider></MemoryRouter>);
}
// Returns { p } (not the promise itself: an async function would wait for it).
async function open(opts) {
  let p;
  await act(async () => { p = confirmAction(opts); });
  return { p };
}

describe('critical-action matrix', () => {
  it('covers every action the spec lists, with clear labels (never Yes/No)', () => {
    for (const type of ['logout', 'change_password', 'change_email', 'change_phone', 'payment', 'withdrawal', 'delete_account', 'disable_security', 'leave_group', 'delete_message']) {
      expect(CRITICAL_ACTIONS[type], type).toBeTruthy();
      expect(CRITICAL_ACTIONS[type].confirmLabel).not.toMatch(/^(yes|no|ok|submit)$/i);
    }
    expect(CRITICAL_ACTIONS.delete_account.requireText).toBe('DELETE');
    expect(CRITICAL_ACTIONS.payment.confirmLabel).toBe('Confirm payment');
  });
});

describe('confirmation dialog', () => {
  it('logout: shows the question, Cancel keeps you signed in, Log out confirms', async () => {
    setup();
    let { p } = await open({ type: 'logout' });
    const dialog = screen.getByRole('dialog', { name: 'Log out of ACHIEVER?' });
    expect(dialog).toHaveProperty('ariaModal', 'true');
    expect(screen.getByText('You will need to sign in again to access your account.')).toBeTruthy();
    expect(document.activeElement.textContent).toBe('Cancel'); // safe default focus
    fireEvent.click(screen.getByText('Cancel'));
    await expect(p).resolves.toBe(false);
    ({ p } = await open({ type: 'logout' }));
    fireEvent.click(screen.getByText('Log out'));
    await expect(p).resolves.toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape and the Android back button cancel instead of confirming', async () => {
    setup();
    let { p } = await open({ type: 'logout' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await expect(p).resolves.toBe(false);
    ({ p } = await open({ type: 'change_phone' }));
    await act(async () => { expect(closeTopOverlay()).toBe(true); });
    await expect(p).resolves.toBe(false);
  });

  it('account deletion: the button stays disabled until DELETE is typed', async () => {
    setup();
    const { p } = await open({ type: 'delete_account' });
    const go = screen.getByText('Continue to verification').closest('button');
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'delete' } });
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DELETE' } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await expect(p).resolves.toBe(true);
  });

  it('focus is trapped inside the dialog', async () => {
    setup();
    await open({ type: 'logout' });
    const buttons = screen.getByRole('dialog').querySelectorAll('button');
    const last = buttons[buttons.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});

describe('payment review', () => {
  let review;
  function Pay() {
    ({ review } = usePaymentReview());
    return null;
  }
  it('shows recipient, amount, fee and total, and starts the payment once with an idempotency key', async () => {
    render(<MemoryRouter><ConfirmProvider><Pay /></ConfirmProvider></MemoryRouter>);
    const start = vi.fn().mockReturnValue(new Promise(() => {})); // checkout never returns in the test
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
    act(() => { review({ id: 'c1', recipient: 'Ikeja Traders (group pool)', purpose: 'Osusu contribution, cycle 3', amount: 2000000 }, start); });
    await screen.findByRole('dialog', { name: 'Review your payment' });
    for (const text of ['Ikeja Traders (group pool)', 'Osusu contribution, cycle 3', '₦0.00 (no fee)', 'Paystack: card, bank transfer or USSD']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.getAllByText('₦20,000.00')).toHaveLength(2); // amount and total
    expect(start).not.toHaveBeenCalled(); // nothing starts before confirmation
    const confirm = screen.getByText('Confirm payment');
    await act(async () => { fireEvent.click(confirm); fireEvent.click(confirm); });
    // A second review while the first is processing is ignored (double tap).
    act(() => { review({ id: 'c1', recipient: 'x', purpose: 'x', amount: 1 }, start); });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0][0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('Cancel never starts a payment', async () => {
    render(<MemoryRouter><ConfirmProvider><Pay /></ConfirmProvider></MemoryRouter>);
    const start = vi.fn();
    let done;
    act(() => { done = review({ id: 'c2', recipient: 'r', purpose: 'p', amount: 100 }, start); });
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByText('Cancel'));
    await act(async () => { await done; });
    expect(start).not.toHaveBeenCalled();
  });
});

describe('single-flight guard', () => {
  it('ignores repeated submissions while the first is running', async () => {
    let run;
    function Guard() {
      [run] = useSingleFlight();
      return null;
    }
    render(<Guard />);
    let release;
    const fn = vi.fn(() => new Promise((r) => { release = r; }));
    let first;
    act(() => { first = run(fn); run(fn); run(fn); });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await first; });
    await act(async () => { await run(async () => {}); });
  });
});
