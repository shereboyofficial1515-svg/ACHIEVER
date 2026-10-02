// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const haptic = vi.fn();
vi.mock('../../platform/index.js', () => ({ hapticFeedback: (...a) => haptic(...a) }));
const SecureKeypad = (await import('./SecureKeypad.jsx')).default;
const { applyKey, formatAmount } = await import('./SecureKeypad.jsx');

function Harness({ type = 'pin', length = 6, onComplete, shuffle }) {
  const [v, setV] = useState('');
  return <><SecureKeypad id="k" type={type} length={length} label="Enter PIN" value={v} onChange={setV} onComplete={onComplete} shuffle={shuffle} /><span data-testid="v">{v}</span></>;
}

afterEach(() => { cleanup(); haptic.mockReset(); localStorage.clear(); });

describe('SecureKeypad logic', () => {
  it('limits PIN/OTP length and accepts digits only', () => {
    expect(applyKey('pin', '12345', '6', 6)).toBe('123456');
    expect(applyKey('pin', '123456', '7', 6)).toBe('123456');
    expect(applyKey('pin', '12', '.', 6)).toBe('12');
    expect(applyKey('otp', '12', 'back', 6)).toBe('1');
  });
  it('amounts: one decimal point, two decimals, no leading zeros', () => {
    expect(applyKey('amount', '', '.', 9)).toBe('0.');
    expect(applyKey('amount', '0', '5', 9)).toBe('5');
    expect(applyKey('amount', '12.5', '0', 9)).toBe('12.50');
    expect(applyKey('amount', '12.50', '1', 9)).toBe('12.50');
    expect(applyKey('amount', '12.5', '.', 9)).toBe('12.5');
    expect(formatAmount('1500000.5')).toBe('1,500,000.5');
  });
});

describe('SecureKeypad component', () => {
  it('never renders PIN digits, announces progress, and completes once', () => {
    const done = vi.fn();
    render(<Harness onComplete={done} />);
    for (const d of ['4', '8', '2', '9', '1', '5']) fireEvent.click(screen.getByRole('button', { name: d }));
    expect(screen.getByTestId('v').textContent).toBe('482915');
    const keypad = screen.getByRole('group', { name: 'Enter PIN' });
    expect(keypad.textContent).not.toMatch(/4\D*8\D*2\D*9\D*1\D*5/);   // only the key labels, not the PIN
    expect(screen.getByRole('status').textContent).toBe('6 of 6 digits entered');
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith('482915');
    expect(keypad.querySelector('input')).toBeNull();   // no text field: no native keyboard, no autofill
  });

  it('every key has an accessible label, including delete', () => {
    render(<Harness />);
    for (const d of '0123456789') expect(screen.getByRole('button', { name: d })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '7' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete last digit' }));
    expect(screen.getByTestId('v').textContent).toBe('');
  });

  it('shuffled layout still contains every digit exactly once', () => {
    render(<Harness shuffle />);
    const keys = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label')).filter((l) => /^\d$/.test(l));
    expect([...keys].sort()).toEqual('0123456789'.split(''));
  });

  it('vibrates on key press unless turned off', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(haptic).toHaveBeenCalledWith('tap');
    cleanup();
    haptic.mockReset();
    localStorage.setItem('achiever.keypad', JSON.stringify({ haptics: false }));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(haptic).not.toHaveBeenCalled();
  });

  it('works with a physical keyboard on the web', () => {
    render(<Harness type="otp" />);
    act(() => { fireEvent.keyDown(window, { key: '3' }); fireEvent.keyDown(window, { key: '4' }); fireEvent.keyDown(window, { key: 'Backspace' }); });
    expect(screen.getByTestId('v').textContent).toBe('3');
  });
});
