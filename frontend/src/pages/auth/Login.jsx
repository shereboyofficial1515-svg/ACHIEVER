import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Fingerprint } from 'lucide-react';
import { Alert, Button, Input } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import SocialSignIn, { OAUTH_ERRORS } from '../../components/domain/SocialSignIn.jsx';
import { biometricEnrolment, forgetBiometrics, isNative } from '../../platform/index.js';

export default function Login() {
  const { login, loginWithBiometrics } = useAuth();
  const [bio, setBio] = useState(() => (isNative() && biometricEnrolment()?.allowLogin ? biometricEnrolment() : null));
  const [notice, setNotice] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [params] = useSearchParams();
  const oauthError = params.get('oauth_error');

  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const me = await login(form.email.trim(), form.password);
      const dest = location.state?.from?.pathname || '/app';
      navigate(me.emailVerified ? dest : '/verify-email', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const bioSignIn = async () => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const me = await loginWithBiometrics();
      navigate(me.emailVerified ? location.state?.from?.pathname || '/app' : '/verify-email', { replace: true });
    } catch (err) {
      if (err?.code === 'CANCELLED') setNotice('Biometric sign-in was cancelled. You can sign in with your password.');
      else if (['KEY_INVALIDATED', 'KEY_MISSING', 'BIOMETRIC_LOGIN_UNAVAILABLE'].includes(err?.code)) {
        await forgetBiometrics();
        setBio(null);
        setNotice('Biometric sign-in is no longer set up on this phone (for example, fingerprints changed or it was turned off). Sign in with your password, then turn it on again in Settings.');
      } else setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <div>
        <h1>Sign in</h1>
        <p className="muted">Welcome back to ACHIEVER.</p>
      </div>
      {oauthError && !error && (
        <Alert tone="danger" icon={AlertCircle}>
          {OAUTH_ERRORS[oauthError] || 'Social sign-in could not be completed. Please try again.'}
        </Alert>
      )}
      {notice && <Alert tone="info">{notice}</Alert>}
      {bio && (
        <>
          <Button type="button" icon={Fingerprint} block onClick={bioSignIn} loading={pending} loadingText="Waiting for biometrics...">
            Sign in with fingerprint or face
          </Button>
          <p className="xsmall muted" style={{ textAlign: 'center' }}>or use your password</p>
        </>
      )}
      <SocialSignIn next={location.state?.from?.pathname || '/app'} />
      {error && (
        <Alert tone="danger" icon={AlertCircle}>
          {error.message}
        </Alert>
      )}
      <Input label="Email address" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <Input label="Password" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      <Button type="submit" block loading={pending} loadingText="Signing in...">
        Sign in
      </Button>
      <div className="auth-links">
        <Link to="/forgot-password">Forgot password?</Link>
        <Link to="/register">Create an account</Link>
      </div>
    </form>
  );
}
