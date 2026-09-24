import { useState } from 'react';
import { Alert, Button, Modal, Textarea } from '../ui/index.js';

/**
 * Asks staff for a reason before revealing sensitive information or taking a
 * sensitive action. The reason is sent to the API, which records it in the
 * data access log / audit trail before anything is returned.
 */
export default function ReasonDialog({ open, title, description, confirmLabel = 'Continue', minLength = 5, onClose, onSubmit }) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const close = () => {
    setReason('');
    setError(null);
    onClose();
  };

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
      setReason('');
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={pending}>Cancel</Button>
          <Button onClick={submit} loading={pending} disabled={reason.trim().length < minLength}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="stack">
        {description && <p className="small muted">{description}</p>}
        {error && <Alert tone="danger">{error.message}</Alert>}
        <Textarea label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} hint={`Recorded with your name and the time (at least ${minLength} characters).`} />
      </div>
    </Modal>
  );
}
