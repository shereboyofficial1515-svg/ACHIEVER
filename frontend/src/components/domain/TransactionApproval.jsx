import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Fingerprint, MailCheck, ShieldCheck } from 'lucide-react';
import { Alert, Button } from '../ui/index.js';
import SecureKeypad from '../ui/SecureKeypad.jsx';
import { useSingleFlight } from '../../hooks/useSingleFlight.js';
import { useSecureScreen } from '../../hooks/useSecureScreen.js';
import { api, newIdempotencyKey } from '../../services/api.js';
import { biometricEnrolment, forgetBiometrics, isNative, signWithBiometrics } from '../../platform/index.js';
import { naira } from '../../utils/format.js';

/**
 * Approve a reviewed money action. Nothing moves until the server has
 * verified the approval:
 *   Android with biometrics on: the phone's secure key signs the server's
 *     challenge after a fingerprint / face / screen-lock check.
 *   Otherwise: transaction PIN (secure keypad). Small amounts: the PIN alone.
 *     Larger amounts (or when the server asks for it): PIN, then the code
 *     emailed to the account owner.
 * The server decides which methods are allowed; "biometric = true" from the
 * app is never accepted as proof.
 *
 * Use either `review` (a bill quote; bill endpoints are used) or `authorizeUrl`
 * + `confirmUrl` (wallet transfers, wallet payments, automatic payments).
 */
export default function TransactionApproval({
  review, amount, title, subtitle, authorizeUrl, confirmUrl, extra = {}, confirmExtra = {}, options, onApproved, onCancel, footnote, confirmLabel = 'Confirm',
}) {
  useSecureScreen(true);
  const enrolment = biometricEnrolment();
  const canBio = isNative() && Boolean(enrolment?.keyId && enrolment.allowTransactions);
  const [mode, setMode] = useState(canBio ? 'biometric' : 'pin');
  const [challenge, setChallenge] = useState(null);
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(options?.reason && !options.methods?.includes('pin') ? options.reason : null);
  const [run, pending] = useSingleFlight();
  // One idempotency key per approval: a retried confirm never runs twice.
  const idemKey = useMemo(() => newIdempotencyKey(), [challenge?.challengeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = amount ?? review?.total;
  const heading = title ?? review?.service;
  const sub = subtitle ?? (review?.recipient ? `${review.service} · ${review.recipient}` : review?.service);
  const urls = {
    authorize: authorizeUrl ?? `/bills/${review?.billId}/authorize`,
    confirm: confirmUrl ?? `/bills/${review?.billId}/confirm`,
  };
  const pinAllowed = !options || options.methods?.includes('pin');

  const confirm = (body) => api.post(urls.confirm, { ...confirmExtra, ...body }, { idempotencyKey: idemKey }).then(({ data }) => onApproved(data));
  const authorize = (body) => api.post(urls.authorize, { ...extra, ...body }).then(({ data }) => data);

  const approveWithBiometrics = () => run(async () => {
    setError(null);
    setNotice(null);
    try {
      const data = await authorize({ method: 'device_biometric', deviceKeyId: enrolment.keyId });
      let signature;
      try {
        signature = await signWithBiometrics(data.signPayload, { title: `Approve ${naira(total)}`, subtitle: heading, cancelText: 'Use PIN instead' });
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

  /** PIN entered: PIN alone when allowed for this amount; otherwise PIN + emailed code. */
  const submitPin = (value) => run(async () => {
    setError(null);
    try {
      if (pinAllowed) {
        try {
          const data = await authorize({ method: 'pin', pin: value });
          setPin('');
          await confirm({ challengeId: data.challengeId });
          return;
        } catch (err) {
          if (err?.code !== 'TX_STEP_UP_REQUIRED') throw err;
          setNotice(err.message);   // explained, e.g. "For larger amounts we also send a code to your email."
        }
      }
      const data = await authorize({ method: 'email_otp', pin: value });
      setChallenge(data);
    } catch (err) {
      setError(err);
    } finally {
      setPin('');
    }
  });

  const submitCode = (value) => run(async () => {
    setError(null);
    try {
      await confirm({ challengeId: challenge.challengeId, code: value });
    } catch (err) {
      setError(err);
      setCode('');
    }
  });

  const pinMissing = error?.code === 'TRANSACTION_PIN_NOT_SET' || error?.code === 'TRANSACTION_PIN_RESET_REQUIRED';
  return (
    <div className="stack approval" aria-live="polite">
      <div className="approval-head">
        <ShieldCheck size={20} aria-hidden />
        <div>
          <strong>Approve {naira(total)}</strong>
          {sub && <p className="xsmall muted">{sub}</p>}
        </div>
      </div>
      {notice && <Alert tone="info">{notice}</Alert>}
      {error && !pinMissing && <Alert tone="danger">{error.message}</Alert>}
      {pinMissing && (
        <Alert tone="warning">
          {error.code === 'TRANSACTION_PIN_RESET_REQUIRED' ? 'For your security, reset your transaction PIN to continue.' : 'You need a transaction PIN to approve payments.'}{' '}
          <Link to="/app/settings/security">{error.code === 'TRANSACTION_PIN_RESET_REQUIRED' ? 'Reset your transaction PIN' : 'Create your transaction PIN'}</Link>, then come back.
        </Alert>
      )}

      {mode === 'biometric' && (
        <>
          <Button icon={Fingerprint} onClick={approveWithBiometrics} loading={pending} loadingText="Waiting for approval…" block>
            Approve with fingerprint or face
          </Button>
          <Button variant="ghost" onClick={() => setMode('pin')} disabled={pending}>Use PIN instead</Button>
        </>
      )}

      {mode === 'pin' && !challenge && (
        <>
          <SecureKeypad
            id="tx-pin"
            type="pin"
            length={6}
            label="Enter your transaction PIN"
            hint="The 6-digit PIN you created for payments (not your sign-in password)"
            value={pin}
            onChange={setPin}
            onComplete={submitPin}
            disabled={pending}
          />
          {canBio && <Button variant="ghost" onClick={() => setMode('biometric')} disabled={pending}>Use fingerprint or face instead</Button>}
        </>
      )}

      {mode === 'pin' && challenge && (
        <>
          <Alert tone="info" icon={MailCheck}>
            {challenge.sent === false ? 'We could not send the email right now. Try again in a moment.' : <>We sent a 6-digit code to <strong>{challenge.sentTo}</strong>. It expires in a few minutes.</>}
          </Alert>
          <SecureKeypad id="tx-otp" type="otp" length={6} label="Code from your email" value={code} onChange={setCode} onComplete={submitCode} disabled={pending} />
          {pending && <p className="xsmall muted" role="status">{confirmLabel}…</p>}
          <Button variant="ghost" onClick={() => { setChallenge(null); setCode(''); }} disabled={pending}>Send a new code</Button>
        </>
      )}

      <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>
      <p className="xsmall muted">
        {footnote ?? (extra.fundingSource === 'wallet'
          ? 'Your ACHIEVER Wallet is debited only after you approve. If the purchase fails, the money returns to your wallet.'
          : 'You will pay on Paystack’s secure page next. Your purchase is sent only after Paystack confirms the payment.')}
      </p>
    </div>
  );
}
