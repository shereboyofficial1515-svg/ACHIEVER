import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { Alert, Button, Checkbox, Input, Loader, Select, Textarea, fieldErrors } from '../../components/ui/index.js';
import LocationPicker from '../../components/domain/LocationPicker.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { api } from '../../services/api.js';

const ACCOUNT_ROLES = [
  { value: 'personal:personal', label: 'Personal — join groups, save with a collector, pay bills' },
  { value: 'osusu:member', label: 'Osusu member' },
  { value: 'osusu:organizer', label: 'Osusu organiser (identity verification required)' },
  { value: 'collector:saver', label: 'Saver with a collector' },
  { value: 'collector:collector', label: 'Collector (identity verification and approval required)' },
];
const GENDERS = [
  { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }, { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

/**
 * Final step for a new Google/Facebook sign-in: create the ACHIEVER profile.
 * The social account proves control of the email address only — legal
 * details, phone verification and KYC are still required.
 */
export default function CompleteProfile() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [identity, setIdentity] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState({
    accountRole: 'personal:personal', firstName: '', middleName: '', lastName: '', gender: '', dateOfBirth: '',
    phone: '', stateCode: '', lgaId: '', city: '', address: '', acceptTerms: false, acceptPrivacy: false,
  });
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api.get('/auth/oauth/pending')
      .then(({ data }) => {
        setIdentity(data);
        setForm((f) => ({ ...f, firstName: data.suggested.firstName, lastName: data.suggested.lastName }));
      })
      .catch((err) => (err.code === 'PROFILE_EXISTS' ? navigate('/app', { replace: true }) : setLoadError(err)));
  }, [navigate]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const [accountType, role] = form.accountRole.split(':');
    try {
      const { data } = await api.post('/auth/oauth/complete', {
        accountType, role, firstName: form.firstName, middleName: form.middleName || undefined, lastName: form.lastName,
        gender: form.gender, dateOfBirth: form.dateOfBirth, phone: form.phone, stateCode: form.stateCode, lgaId: Number(form.lgaId),
        city: form.city, address: form.address || undefined, nationality: 'NG', acceptTerms: form.acceptTerms, acceptPrivacy: form.acceptPrivacy,
      });
      await refresh();
      navigate(data.emailVerificationRequired ? '/verify-email' : '/app/onboarding', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  if (loadError) {
    return (
      <div className="stack">
        <h1>Finish signing up</h1>
        <Alert tone="danger">Your sign-in session has ended. Please <Link to="/login">sign in again</Link>.</Alert>
      </div>
    );
  }
  if (!identity) return <Loader label="Loading your sign-in details..." />;
  const fe = fieldErrors(error);
  const operator = ['osusu:organizer', 'collector:collector'].includes(form.accountRole);
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div>
        <h1>Finish creating your account</h1>
        <p className="muted small">Signed in with {identity.provider === 'facebook' ? 'Facebook' : 'Google'} as <strong>{identity.email}</strong>.</p>
      </div>
      <Alert tone="info">Use your legal name exactly as on your government ID. Your phone number is verified by SMS next.</Alert>
      {error && !Object.keys(fe).length && <Alert tone="danger" icon={AlertCircle}>{error.message}</Alert>}
      <Select label="How will you use ACHIEVER?" value={form.accountRole} onChange={set('accountRole')} options={ACCOUNT_ROLES} />
      <div className="grid-2">
        <Input label="First name" value={form.firstName} onChange={set('firstName')} error={fe.firstName} />
        <Input label="Last name (surname)" value={form.lastName} onChange={set('lastName')} error={fe.lastName} />
      </div>
      <Input label="Middle name (optional)" value={form.middleName} onChange={set('middleName')} error={fe.middleName} />
      <div className="grid-2">
        <Input label="Date of birth" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} error={fe.dateOfBirth} hint="You must be 18 or older" />
        <Select label="Gender" placeholder="Choose" options={GENDERS} value={form.gender} onChange={set('gender')} error={fe.gender} />
      </div>
      <Input label="Phone number" type="tel" autoComplete="tel" placeholder="0803 123 4567" value={form.phone} onChange={set('phone')} error={fe.phone} />
      <LocationPicker stateCode={form.stateCode} lgaId={form.lgaId} errors={fe} onChange={({ stateCode, lgaId }) => setForm({ ...form, stateCode, lgaId })} />
      <Input label="City / town" value={form.city} onChange={set('city')} error={fe.city} />
      <Textarea label={operator ? 'Residential address' : 'Residential address (optional)'} rows={2} value={form.address} onChange={set('address')} error={fe.address} hint="Private — never shown publicly" />
      <Checkbox checked={form.acceptTerms} onChange={set('acceptTerms')} label={<>I accept the <a href="/terms.html" target="_blank" rel="noreferrer">Terms of Service</a> and understand ACHIEVER is not a bank.</>} />
      {fe.acceptTerms && <span className="error xsmall" style={{ color: 'var(--red-600)' }}>{fe.acceptTerms}</span>}
      <Checkbox checked={form.acceptPrivacy} onChange={set('acceptPrivacy')} label={<>I agree to the <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>.</>} />
      {fe.acceptPrivacy && <span className="error xsmall" style={{ color: 'var(--red-600)' }}>{fe.acceptPrivacy}</span>}
      <Button type="submit" block loading={pending} loadingText="Creating your account...">Create my account</Button>
    </form>
  );
}
