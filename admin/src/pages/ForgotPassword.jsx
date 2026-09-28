import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Input } from '../components/ui/index.js';
import { api } from '../services/api.js';

/** Password recovery by emailed code. The authenticator app is still required to sign in afterwards. */
export default function ForgotPassword() {
  const [step, setStep] = useState('request');
  const [form, setForm] = useState({ email: '', code: '', newPassword: '' });
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const run = (fn) => async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.fields ? Object.values(err.fields)[0] : err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="admin-auth" id="main">
      <div className="admin-auth-card">
        <h1>Reset your password</h1>
        {message && <Alert tone="success">{message}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        {step === 'request' ? (
          <form className="stack" onSubmit={run(async () => {
            const r = await api.post('/admin/auth/password/forgot', { email: form.email });
            setMessage(r.message);
            setStep('reset');
          })}>
            <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoFocus />
            <Button type="submit" block loading={pending}>Email me a code</Button>
          </form>
        ) : step === 'reset' ? (
          <form className="stack" onSubmit={run(async () => {
            const r = await api.post('/admin/auth/password/reset', form);
            setMessage(r.message);
            setStep('done');
          })}>
            <Input label="Code from the email" inputMode="numeric" maxLength={6} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, '') })} required />
            <Input label="New password" type="password" autoComplete="new-password" hint="At least 10 characters with upper and lower case letters and a number." value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required />
            <Button type="submit" block loading={pending}>Set new password</Button>
          </form>
        ) : null}
        <Link className="small" to="/login">Back to sign-in</Link>
      </div>
    </main>
  );
}
