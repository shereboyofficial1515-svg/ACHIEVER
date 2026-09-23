import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { Alert, Button, Input } from '../../components/ui/index.js';
import { api } from '../../services/api.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post('/auth/password/forgot', { email });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div>
        <h1>Reset your password</h1>
        <p className="muted">We will email you a 6-digit reset code.</p>
      </div>
      {sent ? (
        <>
          <Alert tone="success" icon={CheckCircle2}>
            If an account exists for {email}, a reset code is on its way.
          </Alert>
          <Button to={`/reset-password?email=${encodeURIComponent(email)}`} block>
            Enter reset code
          </Button>
        </>
      ) : (
        <>
          {error && <Alert tone="danger">{error.message}</Alert>}
          <Input label="Email address" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" block loading={pending}>
            Send reset code
          </Button>
        </>
      )}
      <p className="small">
        <Link to="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
