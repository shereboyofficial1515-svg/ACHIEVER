import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Alert, Button, Input, Modal } from './ui/index.js';
import { api, setStepUpHandler } from '../services/api.js';

/**
 * Sensitive actions (suspending a user, changing settings, confirming payouts,
 * managing administrators…) need a fresh code from the authenticator app. When
 * the API answers STEP_UP_REQUIRED this dialog asks for it, then the original
 * request is retried once.
 */
export default function StepUpDialog() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const resolver = useRef(null);

  useEffect(() => {
    setStepUpHandler(() => new Promise((resolve) => {
      resolver.current = resolve;
      setCode('');
      setError(null);
      setOpen(true);
    }));
    return () => setStepUpHandler(null);
  }, []);

  const finish = (ok) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post('/admin/auth/step-up', { code });
      finish(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onClose={() => finish(false)} title="Confirm it's you">
      <form className="stack" onSubmit={submit}>
        <p className="muted small row"><ShieldCheck size={16} aria-hidden="true" /> Enter the 6-digit code from your authenticator app to continue with this sensitive action.</p>
        {error && <Alert tone="danger">{error}</Alert>}
        <Input label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" type="button" onClick={() => finish(false)}>Cancel</Button>
          <Button type="submit" loading={pending} disabled={code.length !== 6}>Confirm</Button>
        </div>
      </form>
    </Modal>
  );
}
