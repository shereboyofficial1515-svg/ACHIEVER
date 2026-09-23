import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, MailCheck } from 'lucide-react';
import { Alert, Button, Input, Loader } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { api } from '../../services/api.js';

export default function VerifyEmail() {
  const { user, status, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState(null);

  if (status === 'loading') return <Loader />;
  if (status !== 'authenticated') return <Navigate to="/login" replace />;
  if (user.emailVerified) return <Navigate to={location.state?.next || '/app'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api.post('/auth/email/verify', { code });
      setUser(data);
      toast.success('Email verified. Welcome to ACHIEVER.');
      navigate(location.state?.next || '/app', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const resend = async () => {
    setResending(true);
    try {
      const { data } = await api.post('/auth/email/resend');
      if (data?.sent) toast.success('A new code has been sent.');
      else toast.error('We could not send the email right now. Please try again shortly or contact support.');
    } catch (err) {
      toast.error(err);
    } finally {
      setResending(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="state-icon" style={{ width: 52, height: 52, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--navy-50)', color: 'var(--navy-700)' }}>
        <MailCheck size={24} />
      </div>
      <div>
        <h1>Check your email</h1>
        <p className="muted">
          Enter the 6-digit code we sent to <strong>{user.email}</strong>. It expires in 10 minutes.
        </p>
      </div>
      {error && (
        <Alert tone="danger" icon={AlertCircle}>
          {error.message}
        </Alert>
      )}
      <Input
        label="Verification code"
        className="otp"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        style={{ letterSpacing: '0.5em', textAlign: 'center', fontSize: 22, fontWeight: 600 }}
      />
      <Button type="submit" block loading={pending} disabled={code.length !== 6}>
        Verify email
      </Button>
      <div className="auth-links">
        <button type="button" className="btn btn-ghost btn-sm" onClick={resend} disabled={resending}>
          {resending ? 'Sending...' : 'Send a new code'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => logout().then(() => navigate('/login'))}>
          Use a different account
        </button>
      </div>
    </form>
  );
}
