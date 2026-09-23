import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Crown, HandCoins, PiggyBank, User, UsersRound, Wallet } from 'lucide-react';
import { Alert, Button, Checkbox, Input, Textarea, fieldErrors } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';

const TYPES = [
  { value: 'osusu', icon: UsersRound, title: 'Osusu', desc: 'Rotational group savings: fixed contributions, one payout per cycle.' },
  { value: 'collector', icon: HandCoins, title: 'Collector', desc: 'Individual savings held by a collector for an agreed period.' },
  { value: 'personal', icon: User, title: 'Personal use', desc: 'Join groups you are invited to, save with a collector and pay bills.' },
];

const ROLES = {
  osusu: [
    { value: 'organizer', icon: Crown, title: 'Organiser (Admin)', desc: 'Create groups, set contributions, manage payouts. Identity verification required.' },
    { value: 'member', icon: UsersRound, title: 'Member', desc: 'Join a group, contribute each cycle and receive your payout in turn.' },
  ],
  collector: [
    { value: 'collector', icon: Wallet, title: 'Collector', desc: 'Hold savings for savers and earn an agreed commission. Identity verification required.' },
    { value: 'saver', icon: PiggyBank, title: 'Saver', desc: 'Save flexible amounts with a collector and get your money back at the end of the term.' },
  ],
  personal: [{ value: 'personal', icon: User, title: 'Personal account', desc: 'Member and saver features.' }],
};

function Choice({ item, selected, onSelect }) {
  return (
    <button type="button" className="choice" aria-pressed={selected} onClick={() => onSelect(item.value)}>
      <span className="cicon">
        <item.icon size={20} aria-hidden />
      </span>
      <span>
        <strong>{item.title}</strong>
        <span className="desc">{item.desc}</span>
      </span>
    </button>
  );
}

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState(1);
  const [accountType, setAccountType] = useState(null);
  const [role, setRole] = useState(null);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', confirm: '', address: '', dateOfBirth: '', acceptTerms: false });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [localErrors, setLocalErrors] = useState({});

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const operator = role === 'organizer' || role === 'collector';

  const chooseType = (t) => {
    setAccountType(t);
    setRole(t === 'personal' ? 'personal' : null);
    setStep(t === 'personal' ? 3 : 2);
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (form.password !== form.confirm) errs.confirm = 'Passwords do not match';
    if (!form.acceptTerms) errs.acceptTerms = 'You must accept the terms to continue';
    setLocalErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    setError(null);
    try {
      await register({
        accountType,
        role,
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        password: form.password,
        address: form.address || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        acceptTerms: true,
      });
      navigate('/verify-email', { replace: true, state: { next: location.state?.next } });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const fe = { ...fieldErrors(error), ...localErrors };

  return (
    <div className="stack">
      <div>
        <h1>Create your account</h1>
        <p className="muted">Step {step} of 3</p>
        <div className="steps" aria-hidden>
          {[1, 2, 3].map((n) => (
            <span key={n} className={n <= step ? 'done' : ''} />
          ))}
        </div>
      </div>

      {step === 1 && (
        <div className="stack">
          <h2>How will you use ACHIEVER?</h2>
          <div className="choice-grid">
            {TYPES.map((t) => (
              <Choice key={t.value} item={t} selected={accountType === t.value} onSelect={chooseType} />
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <button type="button" className="back-link" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={() => setStep(1)}>
            <ArrowLeft size={15} /> Back
          </button>
          <h2>Choose your role</h2>
          <div className="choice-grid">
            {ROLES[accountType].map((r) => (
              <Choice
                key={r.value}
                item={r}
                selected={role === r.value}
                onSelect={(v) => {
                  setRole(v);
                  setStep(3);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <form className="stack" onSubmit={submit} noValidate>
          <button
            type="button"
            className="back-link"
            style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
            onClick={() => setStep(accountType === 'personal' ? 1 : 2)}
          >
            <ArrowLeft size={15} /> Back
          </button>
          {operator && (
            <Alert tone="info">
              As an {role === 'organizer' ? 'organiser' : 'collector'} you will verify your phone and identity (BVN or NIN) and accept a
              written undertaking before you can manage other people&apos;s money.
            </Alert>
          )}
          {error && !Object.keys(fieldErrors(error)).length && (
            <Alert tone="danger" icon={AlertCircle}>
              {error.message}
            </Alert>
          )}
          <Input label="Full name" autoComplete="name" required value={form.fullName} onChange={set('fullName')} error={fe.fullName} />
          <Input label="Email address" type="email" autoComplete="email" required value={form.email} onChange={set('email')} error={fe.email} />
          <Input label="Phone number" type="tel" autoComplete="tel" placeholder="0803 123 4567" required value={form.phone} onChange={set('phone')} error={fe.phone} hint="Nigerian mobile number" />
          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            value={form.password}
            onChange={set('password')}
            error={fe.password}
            hint="At least 10 characters with upper and lower case letters and a number"
          />
          <Input label="Confirm password" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} error={fe.confirm} />
          {operator && (
            <>
              <Input label="Date of birth" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} error={fe.dateOfBirth} hint="Required for identity verification" />
              <Textarea label="Residential address" rows={2} value={form.address} onChange={set('address')} error={fe.address} hint="Used for accountability; never shown publicly" />
            </>
          )}
          <Checkbox
            checked={form.acceptTerms}
            onChange={set('acceptTerms')}
            label={
              <>
                I have read the <Link to="/legal" target="_blank">terms and money-handling notice</Link> and understand ACHIEVER is not a bank.
              </>
            }
          />
          {fe.acceptTerms && <span className="error xsmall" style={{ color: 'var(--red-600)' }}>{fe.acceptTerms}</span>}
          <Button type="submit" block loading={pending} loadingText="Creating account...">
            Create account
          </Button>
        </form>
      )}

      <p className="small muted">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
