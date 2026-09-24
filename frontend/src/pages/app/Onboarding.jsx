import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Camera, CheckCircle2, FileUp, Phone, ScrollText, ShieldCheck } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, Checkbox, Input, PageHeader, Select, StatusBadge, fieldErrors } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';

function Step({ n, done, current, icon: Icon, title, children }) {
  return (
    <div className={`onboarding-step ${done ? 'done' : ''} ${current ? 'current' : ''}`}>
      <span className="num">{done ? <CheckCircle2 size={18} /> : n}</span>
      <div className="grow stack-sm">
        <div className="row">
          <Icon size={18} aria-hidden />
          <h2 style={{ fontSize: 16 }}>{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

function PhoneStep({ onDone }) {
  const toast = useToast();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const send = async () => {
    setPending(true);
    try {
      await api.post('/auth/phone/send');
      setSent(true);
      toast.success('Code sent by SMS');
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  const verify = async () => {
    setPending(true);
    try {
      await api.post('/auth/phone/verify', { code });
      toast.success('Phone number verified');
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  if (!sent) return <Button onClick={send} loading={pending} size="sm">Send SMS code</Button>;
  return (
    <div className="row-wrap">
      <Input label="SMS code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      <Button onClick={verify} loading={pending} disabled={code.length !== 6} style={{ alignSelf: 'flex-end' }}>
        Verify
      </Button>
    </div>
  );
}

const ID_TYPES = [
  { value: 'nin', label: 'NIN (National Identification Number)', hint: '11 digits', maxLength: 11, digits: true },
  { value: 'bvn', label: 'BVN (Bank Verification Number)', hint: '11 digits', maxLength: 11, digits: true },
  { value: 'passport', label: 'International passport', hint: 'Letter followed by 8 digits, e.g. A12345678', maxLength: 9, expiry: true },
  { value: 'drivers_licence', label: "Driver's licence", hint: 'As printed on the licence', maxLength: 15, expiry: true },
  { value: 'voters_card', label: "Voter's card (PVC)", hint: '19-character VIN', maxLength: 19 },
];
const ID_LABEL = Object.fromEntries(ID_TYPES.map((t) => [t.value, t.label.split(' (')[0]]));

function IdentityStep({ identity, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({ idType: 'nin', idNumber: '', firstName: '', lastName: '', dateOfBirth: '', issueDate: '', expiryDate: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post('/verification/identity', {
        ...form,
        issueDate: form.issueDate || undefined,
        expiryDate: form.expiryDate || undefined,
      });
      setForm((f) => ({ ...f, idNumber: '' })); // never keep the number in memory longer than needed
      toast.success('Details submitted');
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  const upload = async () => {
    if (!file) return;
    setPending(true);
    try {
      await api.upload('/verification/identity/document', file);
      toast.success('Document uploaded for review');
      setFile(null);
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };

  if (identity?.status === 'verified') {
    return (
      <p className="small">
        {ID_LABEL[identity.idType] || identity.idType} ending {identity.last4} verified{identity.expiryDate ? ` · expires ${identity.expiryDate}` : ''}.
      </p>
    );
  }
  if (identity && ['pending', 'manual_review'].includes(identity.status)) {
    return (
      <div className="stack-sm">
        <p className="small">
          {ID_LABEL[identity.idType] || identity.idType} ending {identity.last4} · <StatusBadge status={identity.status} />
        </p>
        {!identity.documentUploaded ? (
          <>
            <p className="small muted">Upload a clear photo or PDF of the document you entered (the photo page for a passport). Max 5 MB.</p>
            <div className="row-wrap">
              <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <Button icon={FileUp} size="sm" onClick={upload} loading={pending} disabled={!file}>
                Upload document
              </Button>
            </div>
          </>
        ) : (
          <p className="small muted">Your document is with our review team. You will be notified when a decision is made.</p>
        )}
      </div>
    );
  }
  const fe = fieldErrors(error);
  const type = ID_TYPES.find((t) => t.value === form.idType);
  return (
    <form className="stack" onSubmit={submit}>
      {identity?.status === 'failed' && <Alert tone="danger">Previous attempt unsuccessful: {identity.failureReason}</Alert>}
      {error && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
      <p className="small muted">
        Your document number is stored only as a one-way fingerprint plus the last four characters. It is never shown to other users.
        NIN and BVN can be checked automatically once a provider is connected; other documents are reviewed by our compliance team.
      </p>
      <div className="grid-2">
        <Select label="Document type" value={form.idType} onChange={(e) => setForm({ ...form, idType: e.target.value, idNumber: '' })} options={ID_TYPES} />
        <Input
          label="Document number"
          hint={type.hint}
          inputMode={type.digits ? 'numeric' : 'text'}
          autoComplete="off"
          maxLength={type.maxLength}
          value={form.idNumber}
          onChange={(e) => setForm({ ...form, idNumber: type.digits ? e.target.value.replace(/\D/g, '') : e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
          error={fe.idNumber}
        />
        <Input label="First name (as on ID)" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} error={fe.firstName} />
        <Input label="Last name (as on ID)" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} error={fe.lastName} />
        <Input label="Date of birth" type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} error={fe.dateOfBirth} />
        {!type.digits && <Input label="Issue date (optional)" type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} error={fe.issueDate} />}
        {type.expiry && <Input label="Expiry date" type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} error={fe.expiryDate} />}
      </div>
      <div>
        <Button type="submit" loading={pending}>
          Submit for verification
        </Button>
      </div>
    </form>
  );
}

function UndertakingStep({ role, accepted, onDone }) {
  const toast = useToast();
  const text = useAsync(() => api.get('/verification/undertaking'), []);
  const [agree, setAgree] = useState(false);
  const [pending, setPending] = useState(false);
  if (accepted) return <p className="small">Accepted for {role === 'OSUSU_ADMIN' ? 'Osusu organiser' : 'collector'} activities.</p>;
  const accept = async () => {
    setPending(true);
    try {
      await api.post('/verification/undertaking', { role, accept: true });
      toast.success('Undertaking accepted');
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <AsyncContent loading={text.loading} error={text.error} onRetry={text.reload}>
      {text.data && (
        <div className="stack">
          <p className="xsmall muted">Version {text.data.version}</p>
          <ol className="undertaking-list">
            {text.data.clauses.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
          <Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)} label="I have read and accept this undertaking. I understand my acceptance, the time and my network address are recorded." />
          <div>
            <Button onClick={accept} disabled={!agree} loading={pending}>
              Accept undertaking
            </Button>
          </div>
        </div>
      )}
    </AsyncContent>
  );
}

function LivenessStep() {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const start = async () => {
    setPending(true);
    try {
      await api.post('/verification/liveness');
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="stack-sm">
      <Alert tone="info">
        Selfie and liveness checks need a licensed verification provider, which is not connected yet. This step (verification level 3) will open
        when it is available; nothing is simulated in the meantime.
      </Alert>
      <div>
        <Button size="sm" variant="secondary" icon={Camera} onClick={start} loading={pending}>
          Check availability
        </Button>
      </div>
    </div>
  );
}

export default function Onboarding() {
  const { refresh } = useAuth();
  const status = useAsync(() => api.get('/verification/status'), []);
  const reload = () => {
    status.reload();
    refresh();
  };
  const s = status.data;
  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <PageHeader title="Verification" subtitle="Verifying who you are protects every member's money. Organisers and collectors need level 2." />
      <AsyncContent loading={status.loading} error={status.error} onRetry={status.reload}>
        {s && (
          <>
            {s.kyc && (
              <Card title={`Verification level ${s.kyc.level} of 3`}>
                <div className="stack-sm">
                  <div className="progress" aria-hidden>
                    <span style={{ width: `${(s.kyc.level / 3) * 100}%` }} />
                  </div>
                  <p className="small">
                    Status: <StatusBadge status={s.kyc.restricted ? 'restricted' : s.kyc.status} />
                    {s.kyc.nextStep && <> · Next: {s.kyc.nextStep}.</>}
                  </p>
                  {s.kyc.level < 1 && (
                    <p className="small muted">
                      Level 1 also needs your legal name, date of birth, state, LGA and city. Complete them in <Link to="/app/profile">your profile</Link>.
                    </p>
                  )}
                </div>
              </Card>
            )}
            {s.operators.map((o) => (
              <Alert key={o.role} tone={o.active ? 'success' : 'warning'} icon={BadgeCheck}>
                {o.role === 'OSUSU_ADMIN' ? 'Osusu organiser' : 'Collector'}: {o.active ? 'active' : `verification incomplete (level ${o.kycLevelRequired} and the undertaking are required)`}
              </Alert>
            ))}
            <div className="onboarding-steps">
              <Step n={1} done={s.emailVerified} icon={CheckCircle2} title="Verify email">
                <p className="small muted">Completed at sign-up.</p>
              </Step>
              <Step n={2} done={s.phoneVerified} current={!s.phoneVerified} icon={Phone} title="Verify phone number">
                {s.phoneVerified ? <p className="small">Verified.</p> : <PhoneStep onDone={reload} />}
              </Step>
              <Step n={3} done={s.identity?.status === 'verified'} current={s.phoneVerified && s.identity?.status !== 'verified'} icon={BadgeCheck} title="Verify a government ID">
                <IdentityStep identity={s.identity} onDone={reload} />
              </Step>
              <Step n={4} done={s.identity?.liveness === 'passed'} icon={ShieldCheck} title="Selfie & liveness check">
                <LivenessStep />
              </Step>
              {s.operators.map((o, i) => (
                <Step key={o.role} n={5 + i} done={o.undertakingAccepted} current={!o.undertakingAccepted} icon={ScrollText} title={`Sign the ${o.role === 'OSUSU_ADMIN' ? 'organiser' : 'collector'} undertaking`}>
                  <UndertakingStep role={o.role} accepted={o.undertakingAccepted} onDone={reload} />
                </Step>
              ))}
            </div>
          </>
        )}
      </AsyncContent>
    </div>
  );
}
