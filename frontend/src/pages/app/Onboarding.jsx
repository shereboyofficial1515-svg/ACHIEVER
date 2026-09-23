import { useState } from 'react';
import { BadgeCheck, CheckCircle2, FileUp, Phone, ScrollText } from 'lucide-react';
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

function IdentityStep({ identity, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({ idType: 'nin', idNumber: '', firstName: '', lastName: '', dateOfBirth: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post('/verification/identity', form);
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
    return <p className="small">{identity.idType.toUpperCase()} ending {identity.last4} verified.</p>;
  }
  if (identity && ['pending', 'manual_review'].includes(identity.status)) {
    return (
      <div className="stack-sm">
        <p className="small">
          {identity.idType.toUpperCase()} ending {identity.last4} · <StatusBadge status={identity.status} />
        </p>
        {!identity.documentUploaded ? (
          <>
            <p className="small muted">Upload a clear photo or PDF of your NIN slip, national ID card, or BVN-linked document. Max 5 MB.</p>
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
  return (
    <form className="stack" onSubmit={submit}>
      {identity?.status === 'failed' && <Alert tone="danger">Previous attempt unsuccessful: {identity.failureReason}</Alert>}
      {error && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
      <p className="small muted">
        Your number is checked and then stored only as a one-way fingerprint plus the last four digits. It is never shown to other users.
      </p>
      <div className="grid-2">
        <Select label="ID type" value={form.idType} onChange={(e) => setForm({ ...form, idType: e.target.value })} options={[{ value: 'nin', label: 'NIN' }, { value: 'bvn', label: 'BVN' }]} />
        <Input label={`${form.idType.toUpperCase()} (11 digits)`} inputMode="numeric" autoComplete="off" maxLength={11} value={form.idNumber} onChange={(e) => setForm({ ...form, idNumber: e.target.value.replace(/\D/g, '') })} error={fe.idNumber} />
        <Input label="First name (as on ID)" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} error={fe.firstName} />
        <Input label="Last name (as on ID)" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} error={fe.lastName} />
        <Input label="Date of birth" type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} error={fe.dateOfBirth} />
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
      <PageHeader title="Operator verification" subtitle="Organisers and collectors handle other people's money. These steps protect members and savers." />
      <AsyncContent loading={status.loading} error={status.error} onRetry={status.reload}>
        {s && (
          <>
            {s.operators.length === 0 && <Alert tone="info">You do not have an organiser or collector role. Add one from your profile if you need it.</Alert>}
            {s.operators.map((o) => (
              <Alert key={o.role} tone={o.active ? 'success' : 'warning'} icon={BadgeCheck}>
                {o.role === 'OSUSU_ADMIN' ? 'Osusu organiser' : 'Collector'}: {o.active ? 'active' : 'verification incomplete'}
              </Alert>
            ))}
            <div className="onboarding-steps">
              <Step n={1} done={s.emailVerified} icon={CheckCircle2} title="Verify email">
                <p className="small muted">Completed at sign-up.</p>
              </Step>
              <Step n={2} done={s.phoneVerified} current={!s.phoneVerified} icon={Phone} title="Verify phone number">
                {s.phoneVerified ? <p className="small">Verified.</p> : <PhoneStep onDone={reload} />}
              </Step>
              <Step n={3} done={s.identity?.status === 'verified'} current={s.phoneVerified && s.identity?.status !== 'verified'} icon={BadgeCheck} title="Verify identity (BVN or NIN)">
                <IdentityStep identity={s.identity} onDone={reload} />
              </Step>
              {s.operators.map((o, i) => (
                <Step key={o.role} n={4 + i} done={o.undertakingAccepted} current={!o.undertakingAccepted} icon={ScrollText} title={`Sign the ${o.role === 'OSUSU_ADMIN' ? 'organiser' : 'collector'} undertaking`}>
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
