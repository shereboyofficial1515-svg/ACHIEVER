import { useEffect, useState } from 'react';
import { BellRing, Fingerprint, Grid3x3, KeyRound } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, Checkbox, Input, fieldErrors } from '../ui/index.js';
import SecureKeypad from '../ui/SecureKeypad.jsx';
import { keypadPrefs, setKeypadPrefs } from '../../utils/keypadPrefs.js';
import { useConfirm } from '../ui/ConfirmProvider.jsx';
import CriticalGate from './CriticalGate.jsx';
import SecurityChallenge from './SecurityChallenge.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useSingleFlight } from '../../hooks/useSingleFlight.js';
import { api } from '../../services/api.js';
import {
  biometricAvailability, biometricEnrolment, createBiometricKey, forgetBiometrics, isNative, pushPermissionState, pushSupported,
  rememberBiometricEnrolment, signWithBiometrics,
} from '../../platform/index.js';
import { enablePush } from '../../services/pushDevice.js';
import { formatDateTime } from '../../utils/format.js';

// Settings → Security → Transaction PIN ---------------------------------------------------------
export function TransactionPinSection() {
  const toast = useToast();
  const status = useAsync(() => api.get('/security/transaction-pin'), []);
  const [form, setForm] = useState({ pin: '', confirmPin: '' });
  const [error, setError] = useState(null);
  const [run, pending] = useSingleFlight();
  const isSet = status.data?.set;

  const submit = (ch) => run(async () => {
    setError(null);
    try {
      const { data } = await api.put('/security/transaction-pin', { ...form, challengeId: ch.challengeId, code: ch.code });
      status.setData(data);
      setForm({ pin: '', confirmPin: '' });
      toast.success(isSet ? 'Transaction PIN changed' : 'Transaction PIN created');
      ch.reset();
    } catch (err) {
      setError(err);
    }
  });
  const fe = fieldErrors(error);
  return (
    <Card title={<span className="row"><KeyRound size={18} aria-hidden /> Transaction PIN</span>}>
      <AsyncContent loading={status.loading} error={status.error} onRetry={status.reload}>
        <div className="stack">
          <p className="small muted">
            A 6-digit PIN, separate from your sign-in password, that approves payments. Larger payments also need a code sent to your email.
            {isSet ? ` Last changed ${formatDateTime(status.data.changedAt)}.` : ' You need one before you can buy airtime, data or pay bills.'}
          </p>
          {status.data?.resetRequired && <Alert tone="danger">Your PIN was locked several times in a row. For your security, set a new PIN before your next payment.</Alert>}
          {status.data?.locked && <Alert tone="warning">Your PIN is locked after several wrong attempts. It unlocks at {formatDateTime(status.data.lockedUntil)}, or you can set a new one now.</Alert>}
          <CriticalGate type="change_transaction_pin" startLabel={isSet ? 'Change or reset PIN' : 'Create transaction PIN'}
            confirmOptions={isSet ? undefined : { title: 'Create a transaction PIN?', message: 'You will need your sign-in password and a security code sent to your email.' }}>
            {() => (
              <SecurityChallenge action="transaction_pin_change" intro="To protect your money, setting a transaction PIN needs your sign-in password and a code sent to your email.">
                {(ch) => (
                  <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(ch); }}>
                    {error?.message && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
                    {form.pin.length < 6 ? (
                      <SecureKeypad id="new-pin" type="pin" label="New 6-digit PIN" hint="Avoid birthdays and patterns like 123456 or 111111"
                        value={form.pin} onChange={(pin) => setForm({ pin, confirmPin: '' })} />
                    ) : (
                      <SecureKeypad id="confirm-pin" type="pin" label="Enter the same PIN again" value={form.confirmPin}
                        onChange={(confirmPin) => setForm({ ...form, confirmPin })} disabled={pending} />
                    )}
                    {(fe.pin || fe.confirmPin) && <p className="xsmall text-red" role="alert">{fe.pin || fe.confirmPin}</p>}
                    {form.confirmPin.length === 6 && form.confirmPin !== form.pin && <p className="xsmall text-red" role="alert">The PINs do not match. Try again.</p>}
                    <div className="row-wrap">
                      <Button type="submit" loading={pending} disabled={form.pin.length !== 6 || form.confirmPin !== form.pin}>Save PIN</Button>
                      {form.pin && <Button variant="ghost" onClick={() => setForm({ pin: '', confirmPin: '' })} disabled={pending}>Start again</Button>}
                    </div>
                  </form>
                )}
              </SecurityChallenge>
            )}
          </CriticalGate>
        </div>
      </AsyncContent>
    </Card>
  );
}

// Settings → Security → Secure keypad (this device) ---------------------------------------------
export function KeypadSection() {
  const [prefs, setPrefs] = useState(keypadPrefs());
  const update = (patch) => setPrefs(setKeypadPrefs(patch));
  return (
    <Card title={<span className="row"><Grid3x3 size={18} aria-hidden /> Secure keypad</span>}>
      <div className="stack">
        <p className="small muted">ACHIEVER uses its own keypad for PINs, codes and amounts. These settings apply to this device.</p>
        {isNative() && <Checkbox label="Vibrate when I press a key" checked={prefs.haptics} onChange={(e) => update({ haptics: e.target.checked })} />}
        <Checkbox label="Shuffle the PIN keypad layout each time (harder for others to watch)" checked={prefs.shuffle} onChange={(e) => update({ shuffle: e.target.checked })} />
      </div>
    </Card>
  );
}

// Settings → Security → Biometrics (Android app) ------------------------------------------------
export function BiometricSection() {
  const toast = useToast();
  const confirmAction = useConfirm();
  const [avail, setAvail] = useState(null);
  const [local, setLocal] = useState(() => biometricEnrolment());
  const devices = useAsync(() => api.get('/security/biometric/devices'), []);
  const [password, setPassword] = useState('');
  const [step, setStep] = useState('idle');
  const [error, setError] = useState(null);
  const [run, pending] = useSingleFlight();

  useEffect(() => { biometricAvailability().then(setAvail); }, []);
  const onThisPhone = local && devices.data?.some((d) => d.id === local.keyId);

  const enable = (e) => {
    e.preventDefault();
    return run(async () => {
      setError(null);
      try {
        const { data: start } = await api.post('/security/biometric/enrol/start', { password });
        const publicKey = await createBiometricKey();
        let signature;
        try {
          signature = await signWithBiometrics(start.signPayload, { title: 'Turn on biometrics', subtitle: 'Confirm with your fingerprint, face or screen lock', cancelText: 'Cancel' });
        } catch (err) {
          await forgetBiometrics();
          setError({ message: err?.code === 'CANCELLED' ? 'Biometric setup was cancelled. Nothing was changed.' : 'Biometric setup did not complete on this phone.' });
          return;
        }
        const { data: key } = await api.post('/security/biometric/enrol/complete', {
          registrationToken: start.registrationToken, publicKey, signature, label: 'This Android phone', allowLogin: true, allowTransactions: true,
        });
        const enrolment = { keyId: key.id, allowLogin: key.allowLogin, allowTransactions: key.allowTransactions, label: key.label };
        rememberBiometricEnrolment(enrolment);
        setLocal(enrolment);
        setPassword('');
        setStep('idle');
        devices.reload();
        toast.success('Biometric sign-in and approval are on');
      } catch (err) {
        setError(err);
      }
    });
  };

  const disable = async (id) => {
    if (!(await confirmAction({ type: 'disable_biometrics' }))) return;
    await run(async () => {
      try {
        await api.post(`/security/biometric/devices/${id}/revoke`, {});
        if (local?.keyId === id) {
          await forgetBiometrics();
          setLocal(null);
        }
        devices.reload();
        toast.success('Biometrics turned off');
      } catch (err) {
        toast.error(err);
      }
    });
  };

  const others = (devices.data || []).filter((d) => d.id !== local?.keyId);
  return (
    <Card title={<span className="row"><Fingerprint size={18} aria-hidden /> Biometric sign-in and approval</span>}>
      <div className="stack">
        <p className="small muted">
          Sign in and approve payments with your fingerprint, face or screen lock on the ACHIEVER Android app. Your biometric data never leaves your phone:
          Android only confirms the check, and a secure key on the phone signs in for you.
        </p>
        {!isNative() && <Alert tone="info">Available in the ACHIEVER Android app.</Alert>}
        {isNative() && avail && !avail.available && (
          <Alert tone="info">{avail.reason === 'none_enrolled' ? 'Add a fingerprint or face in your phone’s settings first.' : 'This phone does not support secure biometrics.'}</Alert>
        )}
        {error?.message && <Alert tone="danger">{error.message}</Alert>}
        {isNative() && avail?.available && (onThisPhone ? (
          <div className="setting-row">
            <div className="grow"><strong className="small">On for this phone</strong><p className="xsmall muted">Sign-in and payment approval</p></div>
            <Button variant="danger" onClick={() => disable(local.keyId)} loading={pending}>Turn off</Button>
          </div>
        ) : step === 'password' ? (
          <form className="stack" onSubmit={enable}>
            <Input label="Your sign-in password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fieldErrors(error).password} />
            <div className="row-wrap">
              <Button type="submit" loading={pending} disabled={!password}>Continue</Button>
              <Button variant="secondary" onClick={() => { setStep('idle'); setPassword(''); }}>Cancel</Button>
            </div>
          </form>
        ) : (
          <div><Button icon={Fingerprint} onClick={async () => { if (await confirmAction({ type: 'enable_biometrics' })) setStep('password'); }}>Turn on biometrics</Button></div>
        ))}
        {others.length > 0 && (
          <AsyncContent loading={devices.loading} error={devices.error}>
            <div className="stack-sm">
              <strong className="small">Other devices with biometrics on</strong>
              {others.map((d) => (
                <div key={d.id} className="setting-row">
                  <div className="grow"><span className="small">{d.label}</span><p className="xsmall muted">Added {formatDateTime(d.createdAt)}{d.lastUsedAt ? ` · last used ${formatDateTime(d.lastUsedAt)}` : ''}</p></div>
                  <Button variant="secondary" onClick={() => disable(d.id)} loading={pending}>Remove</Button>
                </div>
              ))}
            </div>
          </AsyncContent>
        )}
      </div>
    </Card>
  );
}

// Push notifications (Android app) -----------------------------------------------------------------
export function PushSection() {
  const toast = useToast();
  const [state, setState] = useState('loading');
  const [run, pending] = useSingleFlight();
  useEffect(() => { pushPermissionState().then(setState); }, []);
  if (!pushSupported()) {
    return <p className="small muted">{isNative() ? 'Push notifications are not enabled in this version of the app yet.' : 'Push notifications are available in the ACHIEVER Android app.'}</p>;
  }
  const turnOn = () => run(async () => {
    const r = await enablePush();
    setState(r.granted ? 'granted' : 'denied');
    if (r.granted) toast.success('Push notifications are on');
  });
  return (
    <div className="stack-sm">
      {state === 'granted' ? (
        <p className="small"><BellRing size={15} aria-hidden /> Push notifications are on for this phone.</p>
      ) : state === 'denied' ? (
        <Alert tone="info">Notifications are blocked for ACHIEVER. Turn them on in your phone’s Settings → Apps → ACHIEVER → Notifications.</Alert>
      ) : (
        <>
          <p className="small muted">Get told straight away when a payment is confirmed, a contribution is due or something changes on your account. Lock-screen messages never show amounts or account numbers.</p>
          <div><Button icon={BellRing} onClick={turnOn} loading={pending}>Turn on push notifications</Button></div>
        </>
      )}
    </div>
  );
}

/** Keeps the push token current after sign-in (tokens can be rotated by Firebase). */
export function usePushRefresh() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user || !pushSupported()) return;
    pushPermissionState().then((s) => { if (s === 'granted') enablePush(); });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
}
