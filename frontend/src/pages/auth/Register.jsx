import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, Crown, HandCoins, PiggyBank, User, UsersRound, Wallet } from 'lucide-react';
import { Alert, Button, Checkbox, Input, Select, Textarea, fieldErrors } from '../../components/ui/index.js';
import LocationPicker from '../../components/domain/LocationPicker.jsx';
import SocialSignIn from '../../components/domain/SocialSignIn.jsx';
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
    { value: 'collector', icon: Wallet, title: 'Collector', desc: 'Hold savings for savers and earn an agreed commission. Identity verification and approval required.' },
    { value: 'saver', icon: PiggyBank, title: 'Saver', desc: 'Save flexible amounts with a collector and get your money back at the end of the term.' },
  ],
  personal: [{ value: 'personal', icon: User, title: 'Personal account', desc: 'Member and saver features.' }],
};

const GENDERS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];
const EMPLOYMENT = [
  { value: 'employed', label: 'Employed' },
  { value: 'self_employed', label: 'Self-employed' },
  { value: 'business_owner', label: 'Business owner / trader' },
  { value: 'student', label: 'Student' },
  { value: 'unemployed', label: 'Not currently working' },
  { value: 'retired', label: 'Retired' },
  { value: 'other', label: 'Other' },
];

// Which form step owns each field (server errors jump back to the right step).
const FIELD_STEP = {
  firstName: 3, middleName: 3, lastName: 3, preferredName: 3, gender: 3, dateOfBirth: 3, nationality: 3, occupation: 3, employmentStatus: 3, businessName: 3,
  email: 4, phone: 4, stateCode: 4, lgaId: 4, city: 4, address: 4, addressUnit: 4, postalCode: 4,
  password: 5, confirm: 5, acceptTerms: 5, acceptPrivacy: 5,
};
const STEP_TITLES = { 1: 'Account type', 2: 'Your role', 3: 'About you', 4: 'Contact & address', 5: 'Security' };

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

function maxDob() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
}

const EMPTY = {
  firstName: '', middleName: '', lastName: '', preferredName: '', gender: '', dateOfBirth: '', nationality: 'NG',
  occupation: '', employmentStatus: '', businessName: '',
  email: '', phone: '', stateCode: '', lgaId: '', city: '', address: '', addressUnit: '', postalCode: '',
  password: '', confirm: '', acceptTerms: false, acceptPrivacy: false,
};

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState(1);
  const [accountType, setAccountType] = useState(null);
  const [role, setRole] = useState(null);
  const [form, setForm] = useState(EMPTY);
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

  // Light client-side checks per step; the server validates everything again.
  const validateStep = (n) => {
    const errs = {};
    const req = (k, msg) => {
      if (!String(form[k] ?? '').trim()) errs[k] = msg;
    };
    if (n === 3) {
      req('firstName', 'Enter your first name as on your ID');
      req('lastName', 'Enter your last name as on your ID');
      req('gender', 'Choose an option');
      req('dateOfBirth', 'Enter your date of birth');
      if (form.dateOfBirth && form.dateOfBirth > maxDob()) errs.dateOfBirth = 'You must be at least 18 years old';
    }
    if (n === 4) {
      req('email', 'Enter your email address');
      req('phone', 'Enter your phone number');
      req('stateCode', 'Choose a state');
      req('lgaId', 'Choose an LGA');
      req('city', 'Enter your city or town');
      if (operator && String(form.address).trim().length < 5) errs.address = 'Operators must provide a residential address';
    }
    if (n === 5) {
      if (form.password !== form.confirm) errs.confirm = 'Passwords do not match';
      if (!form.acceptTerms) errs.acceptTerms = 'You must accept the terms to continue';
      if (!form.acceptPrivacy) errs.acceptPrivacy = 'You must accept the privacy notice to continue';
    }
    setLocalErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = (e) => {
    e.preventDefault();
    if (validateStep(step)) setStep(step + 1);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validateStep(5)) return;
    setPending(true);
    setError(null);
    try {
      const { confirm, ...rest } = form;
      void confirm;
      await register({
        accountType,
        role,
        ...rest,
        lgaId: Number(rest.lgaId),
        employmentStatus: rest.employmentStatus || undefined,
        address: rest.address || undefined,
        acceptTerms: true,
        acceptPrivacy: true,
      });
      navigate('/verify-email', { replace: true, state: { next: location.state?.next } });
    } catch (err) {
      setError(err);
      const fields = Object.keys(fieldErrors(err));
      const target = Math.min(...fields.map((f) => FIELD_STEP[f] ?? 5));
      if (Number.isFinite(target)) setStep(target);
    } finally {
      setPending(false);
    }
  };

  const fe = { ...fieldErrors(error), ...localErrors };
  const back = (to) => (
    <button type="button" className="back-link" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={() => { setLocalErrors({}); setStep(to); }}>
      <ArrowLeft size={15} /> Back
    </button>
  );
  const serverAlert = error && !Object.keys(fieldErrors(error)).length && (
    <Alert tone="danger" icon={AlertCircle}>
      {error.message}
    </Alert>
  );

  return (
    <div className="stack">
      <div>
        <h1>Create your account</h1>
        <p className="muted">
          Step {step} of 5 · {STEP_TITLES[step]}
        </p>
        <div className="steps" aria-hidden>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={n <= step ? 'done' : ''} />
          ))}
        </div>
      </div>

      {step === 1 && (
        <div className="stack">
          <SocialSignIn label="Sign up" />
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
          {back(1)}
          <h2>Choose your role</h2>
          <div className="choice-grid">
            {ROLES[accountType].map((r) => (
              <Choice key={r.value} item={r} selected={role === r.value} onSelect={(v) => { setRole(v); setStep(3); }} />
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <form className="stack" onSubmit={next} noValidate>
          {back(accountType === 'personal' ? 1 : 2)}
          <p className="small muted">Use your legal name exactly as it appears on your government ID. It is used for verification and is never shown in full to other members.</p>
          {serverAlert}
          <div className="grid-2">
            <Input label="First name" autoComplete="given-name" required value={form.firstName} onChange={set('firstName')} error={fe.firstName} />
            <Input label="Last name (surname)" autoComplete="family-name" required value={form.lastName} onChange={set('lastName')} error={fe.lastName} />
          </div>
          <div className="grid-2">
            <Input label="Middle name (optional)" autoComplete="additional-name" value={form.middleName} onChange={set('middleName')} error={fe.middleName} />
            <Input label="Preferred name (optional)" value={form.preferredName} onChange={set('preferredName')} error={fe.preferredName} hint="What others see in groups" />
          </div>
          <div className="grid-2">
            <Input label="Date of birth" type="date" max={maxDob()} required value={form.dateOfBirth} onChange={set('dateOfBirth')} error={fe.dateOfBirth} hint="You must be 18 or older" />
            <Select label="Gender" placeholder="Choose" options={GENDERS} value={form.gender} onChange={set('gender')} error={fe.gender} />
          </div>
          <div className="grid-2">
            <Select label="Employment" placeholder="Choose (optional)" options={EMPLOYMENT} value={form.employmentStatus} onChange={set('employmentStatus')} error={fe.employmentStatus} />
            <Input label="Occupation (optional)" value={form.occupation} onChange={set('occupation')} error={fe.occupation} />
          </div>
          {['self_employed', 'business_owner'].includes(form.employmentStatus) && (
            <Input label="Business name (optional)" value={form.businessName} onChange={set('businessName')} error={fe.businessName} />
          )}
          <Button type="submit" block icon={ArrowRight}>
            Continue
          </Button>
        </form>
      )}

      {step === 4 && (
        <form className="stack" onSubmit={next} noValidate>
          {back(3)}
          {serverAlert}
          <Input label="Email address" type="email" autoComplete="email" required value={form.email} onChange={set('email')} error={fe.email} />
          <Input label="Phone number" type="tel" autoComplete="tel" placeholder="0803 123 4567" required value={form.phone} onChange={set('phone')} error={fe.phone} hint="Nigerian mobile number; you will verify it by SMS" />
          <LocationPicker
            stateCode={form.stateCode}
            lgaId={form.lgaId}
            errors={fe}
            onChange={({ stateCode, lgaId }) => setForm({ ...form, stateCode, lgaId })}
          />
          <Input label="City / town" autoComplete="address-level2" required value={form.city} onChange={set('city')} error={fe.city} />
          <Textarea
            label={operator ? 'Residential address' : 'Residential address (optional)'}
            rows={2}
            autoComplete="street-address"
            value={form.address}
            onChange={set('address')}
            error={fe.address}
            hint="Private: used for verification and accountability, never shown publicly"
          />
          <div className="grid-2">
            <Input label="Flat / house no. (optional)" value={form.addressUnit} onChange={set('addressUnit')} error={fe.addressUnit} />
            <Input label="Postal code (optional)" inputMode="numeric" value={form.postalCode} onChange={set('postalCode')} error={fe.postalCode} />
          </div>
          <Button type="submit" block icon={ArrowRight}>
            Continue
          </Button>
        </form>
      )}

      {step === 5 && (
        <form className="stack" onSubmit={submit} noValidate>
          {back(4)}
          {operator && (
            <Alert tone="info">
              As an {role === 'organizer' ? 'organiser' : 'collector'} you will verify your phone and a government ID and accept a written undertaking
              {role === 'collector' ? ', and your application will be reviewed,' : ''} before you can manage other people&apos;s money.
            </Alert>
          )}
          {serverAlert}
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
          <Checkbox
            checked={form.acceptPrivacy}
            onChange={set('acceptPrivacy')}
            label={
              <>
                I agree to the <Link to="/legal#privacy" target="_blank">privacy notice</Link>: my identity and address are kept private, used for verification,
                security and dispute resolution, and disclosed only where the law requires.
              </>
            }
          />
          {fe.acceptPrivacy && <span className="error xsmall" style={{ color: 'var(--red-600)' }}>{fe.acceptPrivacy}</span>}
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
