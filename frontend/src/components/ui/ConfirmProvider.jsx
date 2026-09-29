import { createContext, useCallback, useContext, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react';
import { Modal } from './Modal.jsx';
import { Button } from './Button.jsx';
import { criticalAction } from '../../security/criticalActions.js';

/**
 * One confirmation system for the whole app.
 *
 *   const confirmAction = useConfirm();
 *   if (!(await confirmAction({ type: 'logout' }))) return;
 *
 * Options (all optional when `type` is in the critical-action matrix):
 *   title, message, confirmLabel, cancelLabel, severity (info|warning|danger|success),
 *   details: [[label, value], ...]  — e.g. recipient, amount, fee, total
 *   requireText: 'DELETE'           — the person must type this to enable the button
 *   acknowledge: 'I understand ...' — a checkbox that must be ticked
 *   secondary: { label: 'Edit' }    — resolves 'secondary' instead of true/false
 *
 * Resolves true (confirm), false (cancel / Escape / back button) or 'secondary'.
 * Critical details are shown statically (no animation) so they stay readable.
 */
const ConfirmContext = createContext(null);

const ICONS = { info: Info, warning: AlertTriangle, danger: OctagonAlert, success: CheckCircle2 };
const BUTTON = { info: 'primary', warning: 'primary', danger: 'danger', success: 'success' };

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const [typed, setTyped] = useState('');
  const [ack, setAck] = useState(false);
  const resolver = useRef(null);
  const descId = useId();

  const confirmAction = useCallback((opts = {}) => new Promise((resolve) => {
    const base = opts.type ? criticalAction(opts.type) : {};
    resolver.current?.(false); // only one confirmation at a time
    resolver.current = resolve;
    setTyped('');
    setAck(false);
    setRequest({ cancelLabel: 'Cancel', severity: 'warning', ...base, ...opts });
  }), []);

  const finish = (value) => {
    const r = resolver.current;
    resolver.current = null;
    setRequest(null);
    r?.(value);
  };

  const r = request;
  const Icon = r ? ICONS[r.severity] || Info : null;
  const blocked = Boolean(r && ((r.requireText && typed.trim() !== r.requireText) || (r.acknowledge && !ack)));
  return (
    <ConfirmContext.Provider value={confirmAction}>
      {children}
      {r && (
        <Modal
          open
          onClose={() => finish(false)}
          title={r.title}
          describedBy={descId}
          initialFocus={r.requireText ? 'input' : '[data-cancel]'}
          footer={(
            <>
              <Button variant="secondary" data-cancel onClick={() => finish(false)}>{r.cancelLabel}</Button>
              {r.secondary && <Button variant="ghost" onClick={() => finish('secondary')}>{r.secondary.label}</Button>}
              <Button variant={BUTTON[r.severity] || 'primary'} onClick={() => finish(true)} disabled={blocked}>{r.confirmLabel || 'Confirm'}</Button>
            </>
          )}
        >
          <div className={`confirm confirm-${r.severity}`}>
            <span className="confirm-icon" aria-hidden="true"><Icon size={22} /></span>
            <div className="stack-sm grow">
              <span className="sr-only">{r.severity === 'danger' ? 'Warning: high-impact action.' : r.severity === 'warning' ? 'Please confirm.' : ''}</span>
              {r.message && <p id={descId}>{r.message}</p>}
              {r.details?.length > 0 && (
                <dl className="confirm-details">
                  {r.details.filter(Boolean).map(([k, v]) => (
                    <div key={k} className="confirm-row"><dt>{k}</dt><dd>{v}</dd></div>
                  ))}
                </dl>
              )}
              {r.warning && <p className="confirm-caution small">{r.warning}</p>}
              {r.acknowledge && (
                <label className="checkbox">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  <span>{r.acknowledge}</span>
                </label>
              )}
              {r.requireText && (
                <label className="field">
                  <span className="small">Type <strong className="mono">{r.requireText}</strong> to continue</span>
                  <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
                </label>
              )}
            </div>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}
