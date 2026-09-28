import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { Alert, Button, Checkbox, Input } from '../components/ui/index.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { api } from '../services/api.js';

function Shell({ children, title, subtitle }) {
  return (
    <main className="admin-auth" id="main">
      <div className="admin-auth-card">
        <div className="admin-auth-brand">
          <img src="/brand/achiever-mark-96.png" width="40" height="40" alt="" />
          <div>
            <strong>ACHIEVER</strong>
            <span>Site Administration</span>
          </div>
        </div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
      <p className="admin-auth-foot small muted">Restricted system. Every sign-in and action is recorded.</p>
    </main>
  );
}

export default function Login() {
  const { load, endedReason, clearEnded } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState('password'); // password | mfa | enroll | backup-codes
  const [form, setForm] = useState({ email: '', password: '' });
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [enroll, setEnroll] = useState(null);
  const [qr, setQr] = useState(null);
  const [codes, setCodes] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (enroll?.otpauthUri) QRCode.toDataURL(enroll.otpauthUri, { margin: 1, width: 200 }).then(setQr).catch(() => setQr(null));
  }, [enroll]);

  const run = async (fn) => {
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  const submitPassword = (e) => {
    e.preventDefault();
    clearEnded();
    run(async () => {
      const { data } = await api.post('/admin/auth/login', form);
      setForm((f) => ({ ...f, password: '' }));
      setCode('');
      if (data.next === 'enroll') {
        setEnroll(data);
        setStep('enroll');
      } else setStep('mfa');
    });
  };

  const submitCode = (e) => {
    e.preventDefault();
    run(async () => {
      const body = useBackup ? { backupCode: code.trim() } : { code };
      const { data } = await api.post('/admin/auth/mfa', body);
      if (data.backupCodes) {
        setCodes(data.backupCodes);
        setEnroll(null);
        setStep('backup-codes');
        return;
      }
      await load();
      navigate('/', { replace: true });
    });
  };

  const finish = async () => {
    await load();
    navigate('/', { replace: true });
  };

  if (step === 'backup-codes') {
    return (
      <Shell title="Save your backup codes" subtitle="Each code signs you in once if you lose your phone. They are shown only now.">
        <ol className="backup-codes mono">{codes.map((c) => <li key={c}>{c}</li>)}</ol>
        <Alert tone="warning">Store them somewhere safe and offline (for example a password manager). Anyone with a code and your password can sign in.</Alert>
        <Checkbox label="I have saved these codes" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <Button block onClick={finish} disabled={!saved}>Continue to the admin platform</Button>
      </Shell>
    );
  }

  if (step === 'enroll') {
    return (
      <Shell title="Set up your authenticator app" subtitle="Administrator accounts must use an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…). SMS is never used for admin sign-in.">
        <div className="enroll">
          {qr ? <img src={qr} width="200" height="200" alt="QR code to add ACHIEVER Admin to your authenticator app" /> : <div className="qr-placeholder" />}
          <div className="stack-sm">
            <p className="small">1. Scan the QR code with the app, or enter this key manually:</p>
            <code className="secret mono">{enroll.secret.match(/.{1,4}/g).join(' ')}</code>
            <p className="small">2. Enter the 6-digit code the app shows.</p>
          </div>
        </div>
        <form className="stack" onSubmit={submitCode}>
          {error && <Alert tone="danger">{error}</Alert>}
          <Input label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          <Button type="submit" block loading={pending} disabled={code.length !== 6} icon={ShieldCheck}>Confirm and sign in</Button>
          <p className="small muted">This setup expires after 5 minutes. <button type="button" className="link" onClick={() => setStep('password')}>Start again</button></p>
        </form>
      </Shell>
    );
  }

  if (step === 'mfa') {
    return (
      <Shell title="Two-step verification" subtitle={useBackup ? 'Enter one of your backup codes.' : 'Enter the 6-digit code from your authenticator app.'}>
        <form className="stack" onSubmit={submitCode}>
          {error && <Alert tone="danger">{error}</Alert>}
          {useBackup ? (
            <Input label="Backup code" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCDE-FGHIJ" autoFocus />
          ) : (
            <Input label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          )}
          <Button type="submit" block loading={pending} disabled={useBackup ? code.trim().length < 10 : code.length !== 6} icon={ShieldCheck}>Verify</Button>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="link small" onClick={() => { setUseBackup(!useBackup); setCode(''); setError(null); }}>
              {useBackup ? 'Use the authenticator app' : 'Use a backup code'}
            </button>
            <button type="button" className="link small" onClick={() => setStep('password')}>Start again</button>
          </div>
          <p className="small muted">Lost your authenticator and backup codes? Another administrator can reset your authenticator.</p>
        </form>
      </Shell>
    );
  }

  return (
    <Shell title="Administrator sign-in" subtitle="For ACHIEVER staff only. Member accounts cannot sign in here.">
      <form className="stack" onSubmit={submitPassword}>
        {endedReason && <Alert tone="info">{endedReason}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        <Input label="Email" type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoFocus />
        <Input label="Password" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <Button type="submit" block loading={pending} icon={KeyRound}>Continue</Button>
        <Link className="small" to="/forgot-password">Forgot your password?</Link>
      </form>
    </Shell>
  );
}
