import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Fingerprint, KeyRound, MailCheck, ShieldCheck } from 'lucide-react';
import { Alert, Button, Input } from '../ui/index.js';
import { useSingleFlight } from '../../hooks/useSingleFlight.js';
import { useSecureScreen } from '../../hooks/useSecureScreen.js';
import { api, newIdempotencyKey } from '../../services/api.js';
import { biometricEnrolment, forgetBiometrics, isNative, signWithBiometrics } from '../../platform/index.js';
import { naira } from '../../utils/format.js';

/**
 * Approve a reviewed purchase. Nothing is paid until the server has verified
 * the approval:
 *   Android with biometrics on: the phone's secure key signs the server's
 *     challenge after a fingerprint / face / screen-lock check.
 *   Otherwise: transaction PIN, then the code emailed to the account owner.
 * The server never accepts "biometric = true" from the app.
 */
export default function TransactionApproval({ review, onApproved, onCancel }) {
  useSecureScreen(true);
  const enrolment = biometricEnrolment();
  const canBio = isNative() && Boolean(enrolment?.keyId && enrolment.allowTransactions);
  const [mode, setMode] = useState(canBio ? 'biometric' : 'pin');
  const [challenge, setChallenge] = useState(null);
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [run, pending] = useSingleFlight();
  // One idempotency key per approval: a retried confirm never starts a second checkout.
  const idemKey = useMemo(() => newIdempotencyKey(), [challenge?.challengeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = (body) => api.post(`/bills/${review.billId}/confirm`, body, { idempotencyKey: idemKey }).then(({ data }) => onApproved(data));

  const approveWithBiometrics = () => run(async () => {
    setError(null);
    setNotice(null);
    try {
      const { data } = await api.post(`/bills/${review.billId}/authorize`, { method: 'device_biometric', deviceKeyId: enrolment.keyId });
      let signature;
      try {
        signature = await signWithBiometrics(data.signPayload, { title: 'Approve purchase', subtitle: `${naira(review.total)} · ${review.service}`, cancelText: 'Use PIN instead' });
      } catch (err) {
        if (err?.code === 'KEY_INVALIDATED' || err?.code === 'KEY_MISSING') {
          await forgetBiometrics();
          setNotice('Your phone’s fingerprints or face data changed, so biometric approval was switched off. Use your PIN, then turn biometrics on again in Settings.');
        } else if (err?.code === 'CANCELLED') {
          setNotice('Biometric approval was cancelled. Nothing was paid.');
        } else {
          setNotice('Biometric approval is not available right now. Use your PIN instead.');
        }
        setMode('pin');
        return;
      }
      await confirm({ challengeId: data.challengeId, signature });
    } catch (err) {
      setError(err);
    }
  });

  const sendCode = (e) => {
    e?.preventDefault();
    return run(async () => {
      setError(null);
      try {
        const { data } = await api.post(`/bills/${review.billId}/authorize`, { method: 'email_otp', pin });
        setChallenge(data);
        setPin('');
      } catch (err) {
        setError(err);
      }
    });
  };

  const submitCode = (e) => {
    e.preventDefault();
    return run(async () => {
      setError(null);
      try {
        await confirm({ challengeId: challenge.challengeId, code });
      } catch (err) {
        setError(err);
      }
    });
  };

  const pinMissing = error?.code === 'TRANSACTION_PIN_NOT_SET';
  return (
    <div className="stack approval" aria-live="polite">
      <div className="approval-head">
        <ShieldCheck size={20} aria-hidden />
        <div>
          <strong>Approve {naira(review.total)}</strong>
          <p className="xsmall muted">{review.service}{review.recipient ? ` · ${review.recipient}` : ''}</p>
        </div>
      </div>
      {notice && <Alert tone="info">{notice}</Alert>}
      {error && !pinMissing && <Alert tone="danger">{error.message}</Alert>}
      {pinMissing && (
        <Alert tone="warning">
          You need a transaction PIN to approve payments. <Link to="/app/settings/security">Create your transaction PIN</Link>, then come back.
        </Alert>
      )}

      {mode === 'biometric' && (
        <>
          <Button icon={Fingerprint} onClick={approveWithBiometrics} loading={pending} loadingText="Waiting for approval…" block>
            Approve with fingerprint or face
          </Button>
          <Button variant="ghost" onClick={() => setMode('pin')} disabled={pending}>Use PIN and email code instead</Button>
        </>
      )}

      {mode === 'pin' && !challenge && (
        <form className="stack" onSubmit={sendCode}>
          <Input
            label="Transaction PIN"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            hint="The 6-digit PIN you created for payments (not your sign-in password)"
          />
          <Button type="submit" icon={KeyRound} loading={pending} disabled={pin.length !== 6} block>Continue</Button>
          {canBio && <Button variant="ghost" onClick={() => setMode('biometric')} disabled={pending}>Use fingerprint or face instead</Button>}
        </form>
      )}

      {mode === 'pin' && challenge && (
        <form className="stack" onSubmit={submitCode}>
          <Alert tone="info" icon={MailCheck}>
            {challenge.sent === false ? 'We could not send the email right now. Try again in a moment.' : <>We sent a 6-digit code to <strong>{challenge.sentTo}</strong>. It expires in a few minutes.</>}
          </Alert>
          <Input
            label="Code from your email"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <Button type="submit" loading={pending} loadingText="Confirming…" disabled={code.length !== 6} block>Confirm purchase</Button>
          <Button variant="ghost" onClick={() => { setChallenge(null); setCode(''); }} disabled={pending}>Send a new code</Button>
        </form>
      )}

      <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
      <p className="xsmall muted">You will pay on Paystack’s secure page next. Your purchase is sent only after Paystack confirms the payment.</p>
    </div>
  );
}
