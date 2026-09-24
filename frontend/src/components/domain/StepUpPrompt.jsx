import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Alert, Button, Input, Modal } from '../ui/index.js';
import { api, setStepUpHandler } from '../../services/api.js';

/**
 * Sensitive staff actions need a fresh password confirmation on this session.
 * When the API answers STEP_UP_REQUIRED, this dialog asks for the password,
 * confirms it with the server, and the original request is retried once.
 */
export default function StepUpPrompt() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const resolver = useRef(null);

  useEffect(() => {
    setStepUpHandler(
      () =>
        new Promise((resolve) => {
          resolver.current = resolve;
          setPassword('');
          setError(null);
          setOpen(true);
        }),
    );
    return () => setStepUpHandler(null);
  }, []);

  const finish = (ok) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  const confirm = async (e) => {
    e?.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post('/auth/step-up', { password });
      finish(true);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => finish(false)}
      title="Confirm it's you"
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={() => finish(false)} disabled={pending}>
            Cancel
          </Button>
          <Button icon={ShieldCheck} onClick={confirm} loading={pending} disabled={!password}>
            Confirm
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={confirm}>
        <p className="muted small">This is a sensitive action. Enter your password to continue. You won&apos;t be asked again for a few minutes.</p>
        {error && <Alert tone="danger">{error.message}</Alert>}
        <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </form>
    </Modal>
  );
}
