import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Delete } from 'lucide-react';
import { hapticFeedback } from '../../platform/index.js';
import { keypadPrefs } from '../../utils/keypadPrefs.js';

/**
 * ACHIEVER secure keypad: an on-screen keypad for PINs, one-time codes and
 * amounts, used instead of the phone's keyboard for these fields only (normal
 * text fields keep the native keyboard).
 *
 *  - type 'pin'     : digits are never shown (dots), optional shuffled layout,
 *                     nothing is written to the DOM as text, autocomplete off
 *  - type 'otp'     : digits shown, fixed layout
 *  - type 'amount'  : naira with up to 2 decimals (value is the typed string)
 *  - type 'numeric' : plain digits up to `length`
 *
 * Accessible: every key is a real <button> with a label; progress is announced
 * without reading PIN digits aloud. A physical keyboard also works (desktop).
 * Android key-press vibration can be turned off in Settings → Security.
 */
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

function shuffled(list) {
  const a = [...list];
  const rnd = new Uint32Array(a.length);
  crypto.getRandomValues(rnd);
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = rnd[i] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function applyKey(type, value, key, length) {
  if (key === 'back') return value.slice(0, -1);
  if (key === 'clear') return '';
  if (type === 'amount') {
    if (key === '.') return value.includes('.') ? value : `${value || '0'}.`;
    const [whole, dec] = value.split('.');
    if (dec !== undefined && dec.length >= 2) return value;
    if (dec === undefined && whole.replace(/^0+/, '').length >= (length || 9)) return value;
    if (value === '0' && key !== '.') return key;
    return value + key;
  }
  if (!/^\d$/.test(key) || value.length >= length) return value;
  return value + key;
}

export function formatAmount(value) {
  if (!value) return '0';
  const [whole, dec] = value.split('.');
  const w = Number(whole || 0).toLocaleString('en-NG');
  return dec === undefined ? w : `${w}.${dec}`;
}

export default function SecureKeypad({
  type = 'pin', length = 6, value, onChange, onComplete, label, hint, disabled = false, shuffle, id,
}) {
  const prefs = keypadPrefs();
  const randomise = type === 'pin' && (shuffle ?? prefs.shuffle);
  // A new layout each time the keypad is shown (not on every key press).
  const layout = useMemo(() => (randomise ? shuffled(DIGITS) : DIGITS), [randomise]);
  const completed = useRef(false);
  const latest = useRef(value);   // fast typing: each key builds on the previous key, not on the last render
  latest.current = value;
  const max = type === 'amount' ? 9 : length;

  const press = useCallback((key) => {
    if (disabled) return;
    const current = latest.current;
    const next = applyKey(type, current, key, max);
    if (next === current) {
      if (prefs.haptics) hapticFeedback('reject');
      return;
    }
    if (prefs.haptics) hapticFeedback('tap');
    latest.current = next;
    onChange(next);
  }, [disabled, type, max, onChange, prefs.haptics]);

  useEffect(() => {
    if (type === 'amount' || value.length !== length) { completed.current = false; return; }
    if (!completed.current) {
      completed.current = true;
      onComplete?.(value);
    }
  }, [value, length, type, onComplete]);

  // Physical keyboard (desktop web): digits, Backspace, '.' for amounts.
  useEffect(() => {
    if (disabled) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); } else if (e.key === 'Backspace') { e.preventDefault(); press('back'); } else if (e.key === '.' && type === 'amount') { e.preventDefault(); press('.'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, disabled, type]);

  const labelId = id ? `${id}-label` : undefined;
  const filled = value.length;
  const announce = type === 'pin' ? `${filled} of ${length} digits entered`
    : type === 'amount' ? `₦${formatAmount(value)}` : `${filled} of ${length} digits entered`;

  const display = type === 'pin' || type === 'otp' ? (
    <div className={`keypad-slots${type === 'pin' ? ' is-secret' : ''}`} aria-hidden>
      {Array.from({ length }, (_, i) => (
        <span key={i} className={`keypad-slot${i < filled ? ' is-filled' : ''}${i === filled ? ' is-current' : ''}`}>
          {type === 'otp' && i < filled ? value[i] : null}
        </span>
      ))}
    </div>
  ) : (
    <div className="keypad-amount" aria-hidden>
      {type === 'amount' && <span className="keypad-currency">₦</span>}
      <span className="keypad-amount-value">{type === 'amount' ? formatAmount(value) : value || '0'}</span>
    </div>
  );

  // Bottom row: [extra] [last digit] [delete]
  const extra = type === 'amount' ? '.' : null;
  const top = layout.slice(0, 9);
  const last = layout[9];

  return (
    <div className={`secure-keypad secure-keypad--${type}${disabled ? ' is-disabled' : ''}`} role="group" aria-labelledby={labelId} aria-label={labelId ? undefined : label}>
      {label && <p id={labelId} className="keypad-label">{label}</p>}
      {display}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      {hint && <p className="keypad-hint xsmall muted">{hint}</p>}
      <div className="keypad-grid">
        {top.map((d) => (
          <button key={d} type="button" className="keypad-key" onClick={() => press(d)} disabled={disabled} aria-label={d}>{d}</button>
        ))}
        {extra
          ? <button type="button" className="keypad-key keypad-key-alt" onClick={() => press(extra)} disabled={disabled} aria-label="Decimal point">.</button>
          : <span className="keypad-key keypad-key-blank" aria-hidden />}
        <button type="button" className="keypad-key" onClick={() => press(last)} disabled={disabled} aria-label={last}>{last}</button>
        <button
          type="button"
          className="keypad-key keypad-key-alt"
          onClick={() => press('back')}
          onContextMenu={(e) => { e.preventDefault(); press('clear'); }}
          disabled={disabled || !value}
          aria-label="Delete last digit"
        >
          <Delete size={22} aria-hidden />
        </button>
      </div>
    </div>
  );
}
