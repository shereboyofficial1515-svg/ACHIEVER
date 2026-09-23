import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { Alert, Button, Input } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

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

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <div>
        <h1>Sign in</h1>
        <p className="muted">Welcome back to ACHIEVER.</p>
      </div>
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
