import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Input, fieldErrors } from '../../components/ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { api } from '../../services/api.js';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ email: params.get('email') || '', code: '', newPassword: '', confirm: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      setError({ message: 'Passwords do not match', fields: { confirm: 'Passwords do not match' } });
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.post('/auth/password/reset', { email: form.email, code: form.code, newPassword: form.newPassword });
      toast.success('Password updated. Please sign in.');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const fe = fieldErrors(error);
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div>
        <h1>Choose a new password</h1>
        <p className="muted">All devices will be signed out after the reset.</p>
      </div>
      {error && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
      <Input label="Email address" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={fe.email} />
      <Input label="Reset code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, '') })} error={fe.code} />
      <Input label="New password" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} error={fe.newPassword} hint="At least 10 characters with upper and lower case letters and a number" />
      <Input label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} error={fe.confirm} />
      <Button type="submit" block loading={pending}>
        Update password
      </Button>
      <p className="small">
        <Link to="/forgot-password">Request a new code</Link>
      </p>
    </form>
  );
}
