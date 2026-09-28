import { useEffect, useState } from 'react';
import { MailCheck } from 'lucide-react';
import { Alert, Button, Input } from '../ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { api } from '../../services/api.js';

/**
 * Phone verification that follows the server: SMS codes when SMS verification
 * is on and working, otherwise the verified email is used (the server decides
 * whether that is allowed). The app never assumes SMS is always required.
 */
export function useVerificationMethods() {
  const [methods, setMethods] = useState(null);
  useEffect(() => {
    let live = true;
    api.get('/auth/verification-methods').then(({ data }) => live && setMethods(data)).catch(() => live && setMethods(null));
    return () => {
      live = false;
    };
  }, []);
  return methods;
}

export default function PhoneVerification({ onDone }) {
  const toast = useToast();
  const methods = useVerificationMethods();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [smsFailed, setSmsFailed] = useState(false);
  const useEmail = smsFailed || (methods && !methods.sms.available);

  const run = async (fn) => {
    setPending(true);
    try {
      await fn();
    } catch (err) {
      if (err.code === 'SMS_UNAVAILABLE') setSmsFailed(true);
      else toast.error(err);
    } finally {
      setPending(false);
    }
  };

  if (!methods) return <p className="small muted">Checking verification options…</p>;

  if (useEmail) {
    return (
      <div className="stack-sm">
        <Alert tone="info" icon={MailCheck}>SMS verification is temporarily unavailable. Please use email verification.</Alert>
        <p className="small muted">Your verified email address will be used instead. You can confirm your phone by SMS later when it is available again.</p>
        <div>
          <Button size="sm" loading={pending} onClick={() => run(async () => {
            await api.post('/auth/phone/email-fallback');
            toast.success('Your verified email will be used for now');
            onDone?.();
          })}>Use my verified email</Button>
        </div>
      </div>
    );
  }

  if (!sent) {
    return <Button size="sm" loading={pending} onClick={() => run(async () => { await api.post('/auth/phone/send'); setSent(true); toast.success('Code sent by SMS'); })}>Send SMS code</Button>;
  }
  return (
    <div className="row-wrap">
      <Input label="SMS code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      <Button onClick={() => run(async () => { await api.post('/auth/phone/verify', { code }); toast.success('Phone number verified'); onDone?.(); })}
        loading={pending} disabled={code.length !== 6} style={{ alignSelf: 'flex-end' }}>Verify</Button>
    </div>
  );
}
