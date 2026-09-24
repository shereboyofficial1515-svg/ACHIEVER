import { useEffect, useState } from 'react';
import { KeyRound, MailCheck } from 'lucide-react';
import { Alert, Button, Input, fieldErrors } from '../ui/index.js';
import { api } from '../../services/api.js';

/**
 * Step 1 of every sensitive change: confirm the current password, then enter
 * the single-use code ACHIEVER emails to the verified address. The server
 * validates the code when the protected action is submitted — this component
 * never decides that a code is valid.
 *
 * Renders children({ challengeId, code }) once a code has been entered.
 */
export default function SecurityChallenge({ action, intro, children }) {
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!cooldown) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async (e) => {
    e?.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api.post('/auth/challenges', { action, password });
      setChallenge(data);
      setCode('');
      setCooldown(60);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const fe = fieldErrors(error);
  if (!challenge) {
    return (
      <form className="stack" onSubmit={send}>
        {intro && <p className="small muted">{intro}</p>}
        {error && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
        <Input label="Current password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fe.password} />
        <div>
          <Button type="submit" icon={KeyRound} loading={pending} disabled={!password}>Send security code</Button>
        </div>
      </form>
    );
  }
  return (
    <div className="stack">
      <Alert tone="info" icon={MailCheck}>
        We sent a 6-digit security code to {challenge.sentTo}. It expires in 10 minutes and works once.
      </Alert>
      <Input
        label="Security code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
      />
      <div className="row-wrap">
        <Button size="sm" variant="ghost" onClick={() => setChallenge(null)}>Start again</Button>
        <Button size="sm" variant="ghost" onClick={send} disabled={cooldown > 0 || pending}>
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </Button>
      </div>
      {code.length === 6 && children({ challengeId: challenge.challengeId, code, reset: () => setChallenge(null) })}
    </div>
  );
}
