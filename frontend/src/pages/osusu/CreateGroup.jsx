import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BadgeCheck, Check, Lock } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, Checkbox, Input, KeyValue, MoneyInput, PageHeader, Select, Textarea, fieldErrors } from '../../components/ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { FREQUENCY_LABEL, formatDate, naira, parseNairaToKobo, todayLagos } from '../../utils/format.js';

const STEPS = [
  { id: 'details', label: 'Details', fields: ['name', 'description', 'meetingSchedule'] },
  { id: 'money', label: 'Contributions', fields: ['contributionAmount', 'frequency', 'maxMembers', 'startDate', 'gracePeriodDays', 'payoutOrderMethod'] },
  { id: 'members', label: 'Membership', fields: ['requiresApproval', 'adminParticipates'] },
  { id: 'review', label: 'Review', fields: [] },
];
const ORDER_LABEL = { join_order: 'Order members joined', random: 'Random draw at start', manual: 'Set manually before start' };

/** Client checks mirror the server rules (osusuValidators.createGroup); the server still validates everything. */
function validate(step, form, kobo) {
  const e = {};
  if (step === 'details') {
    if (form.name.trim().length < 3) e.name = 'Enter a group name of at least 3 characters';
    if (form.name.trim().length > 80) e.name = 'Keep the name under 80 characters';
  }
  if (step === 'money') {
    if (!kobo || kobo < 10000) e.contributionAmount = 'Enter at least ₦100';
    const m = Number(form.maxMembers);
    if (!Number.isInteger(m) || m < 2 || m > 100) e.maxMembers = 'Between 2 and 100 members';
    if (!form.startDate || form.startDate < todayLagos()) e.startDate = 'Choose today or a later date';
  }
  return e;
}

export default function CreateGroup() {
  const navigate = useNavigate();
  const toast = useToast();
  const onboarding = useAsync(() => api.get('/verification/status'), []);
  const [form, setForm] = useState({
    name: '', description: '', amount: '', frequency: 'weekly', maxMembers: 10, startDate: todayLagos(),
    gracePeriodDays: 1, payoutOrderMethod: 'join_order', requiresApproval: true, adminParticipates: true, meetingSchedule: '',
  });
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [local, setLocal] = useState({});
  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); setLocal((l) => ({ ...l, [k === 'amount' ? 'contributionAmount' : k]: undefined })); };

  const kobo = parseNairaToKobo(form.amount);
  const members = Number(form.maxMembers) || 0;
  const current = STEPS[step].id;

  const next = () => {
    const errs = validate(current, form, kobo);
    setLocal(errs);
    if (Object.keys(errs).length) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* not available */ }
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  const submit = async (e) => {
    e.preventDefault();
    if (current !== 'review') { next(); return; }
    setPending(true);
    setError(null);
    try {
      const { data } = await api.post('/osusu/groups', {
        name: form.name.trim(),
        description: form.description || null,
        contributionAmount: kobo,
        frequency: form.frequency,
        maxMembers: members,
        startDate: form.startDate,
        gracePeriodDays: Number(form.gracePeriodDays),
        payoutOrderMethod: form.payoutOrderMethod,
        requiresApproval: form.requiresApproval,
        adminParticipates: form.adminParticipates,
        meetingSchedule: form.meetingSchedule || null,
      });
      toast.success('Group created. Invite members to get started.');
      navigate(`/app/osusu/${data.id}`, { replace: true });
    } catch (err) {
      setError(err);
      // Send the organiser back to the step holding the first rejected field.
      const bad = Object.keys(fieldErrors(err));
      const at = STEPS.findIndex((s) => s.fields.some((f) => bad.includes(f)));
      if (at >= 0) setStep(at);
    } finally {
      setPending(false);
    }
  };

  const organiser = onboarding.data?.operators?.find((o) => o.role === 'OSUSU_ADMIN');
  const fe = { ...fieldErrors(error), ...Object.fromEntries(Object.entries(local).filter(([, v]) => v)) };

  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <PageHeader title="Create an Osusu group" subtitle="Set the terms members will agree to. They lock when you start the group." back={{ to: '/app/osusu', label: 'Groups' }} />
      <AsyncContent loading={onboarding.loading} error={onboarding.error} onRetry={onboarding.reload}>
        {organiser && !organiser.active ? (
          <Alert tone="warning" icon={BadgeCheck}>
            You need to finish organiser verification (phone, identity and undertaking) before creating a group.{' '}
            <Link to="/app/onboarding">Complete verification</Link>
          </Alert>
        ) : (
          <form className="stack-lg" onSubmit={submit} noValidate>
            <ol className="stepper" aria-label="Steps">
              {STEPS.map((s, i) => (
                <li key={s.id} className={i < step ? 'is-done' : i === step ? 'is-current' : ''} aria-current={i === step ? 'step' : undefined}>
                  <span className="stepper-dot">{i < step ? <Check size={14} aria-hidden /> : i + 1}</span>
                  <span className="stepper-label">{s.label}</span>
                </li>
              ))}
            </ol>
            {error?.message && <Alert tone="danger">{error.message}</Alert>}

            {current === 'details' && (
              <Card title="Group details">
                <div className="stack">
                  <Input label="Group name" value={form.name} onChange={set('name')} error={fe.name} placeholder="e.g. Balogun Market Traders" autoFocus />
                  <Textarea label="Description (optional)" rows={3} value={form.description} onChange={set('description')} error={fe.description} hint="What the group is for and who it is for" />
                  <Input label="Meeting schedule (optional)" value={form.meetingSchedule} onChange={set('meetingSchedule')} placeholder="e.g. First Saturday of the month, 4pm" error={fe.meetingSchedule} />
                </div>
              </Card>
            )}

            {current === 'money' && (
              <Card title="Contributions and schedule">
                <div className="stack">
                  <div className="grid-2">
                    <MoneyInput label="Contribution per member" value={form.amount} onChange={set('amount')} error={fe.contributionAmount} placeholder="20,000" hint="Minimum ₦100" />
                    <Select label="Frequency" value={form.frequency} onChange={set('frequency')} options={['daily', 'weekly', 'biweekly', 'monthly'].map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }))} />
                    <Input label="Number of members" type="number" inputMode="numeric" min={2} max={100} value={form.maxMembers} onChange={set('maxMembers')} error={fe.maxMembers} hint="Also the number of cycles" />
                    <Input label="Start date (first due date)" type="date" min={todayLagos()} value={form.startDate} onChange={set('startDate')} error={fe.startDate} />
                    <Select label="Grace period" value={form.gracePeriodDays} onChange={set('gracePeriodDays')} options={[0, 1, 2, 3, 5, 7].map((d) => ({ value: d, label: d === 0 ? 'None' : `${d} day${d > 1 ? 's' : ''}` }))} hint="Days after the due date before a contribution is marked overdue" />
                    <Select label="Payout order" value={form.payoutOrderMethod} onChange={set('payoutOrderMethod')} options={Object.entries(ORDER_LABEL).map(([value, label]) => ({ value, label }))} />
                  </div>
                  {kobo > 0 && members >= 2 && (
                    <Alert tone="info">
                      Each cycle pools <strong>{naira(kobo * members)}</strong> ({members} × {naira(kobo)}), paid to one member. The group runs for {members} cycles, and every
                      member keeps contributing until all {members} have been paid.
                    </Alert>
                  )}
                </div>
              </Card>
            )}

            {current === 'members' && (
              <Card title="Membership">
                <div className="stack">
                  <Checkbox label="I will also participate as a member (contribute and receive a payout)" checked={form.adminParticipates} onChange={set('adminParticipates')} />
                  <Checkbox label="Members who join with the group code need my approval" checked={form.requiresApproval} onChange={set('requiresApproval')} />
                </div>
              </Card>
            )}

            {current === 'review' && (
              <>
                <Card title="Review your group">
                  <div className="stack">
                    <div className="review-hero">
                      <span className="eyebrow">Pool per cycle</span>
                      <p className="review-hero-amount">{naira(kobo * members)}</p>
                      <span className="small muted">{members} members × {naira(kobo)} · {FREQUENCY_LABEL[form.frequency].toLowerCase()} · {members} cycles</span>
                    </div>
                    <KeyValue
                      items={[
                        ['Group name', form.name.trim()],
                        form.description && ['Description', form.description],
                        ['Contribution', `${naira(kobo)} · ${FREQUENCY_LABEL[form.frequency]}`],
                        ['Members and cycles', members],
                        ['First due date', formatDate(form.startDate)],
                        ['Grace period', Number(form.gracePeriodDays) ? `${form.gracePeriodDays} day(s)` : 'None'],
                        ['Payout order', ORDER_LABEL[form.payoutOrderMethod]],
                        ['You participate', form.adminParticipates ? 'Yes, you contribute and receive a payout' : 'No, you organise only'],
                        ['Join approval', form.requiresApproval ? 'Required' : 'Not required'],
                        form.meetingSchedule && ['Meetings', form.meetingSchedule],
                      ]}
                    />
                  </div>
                </Card>
                <Alert tone="info" icon={Lock}>
                  Once you start the group, these terms are locked, the payout order is fixed and members cannot leave. Until then you can cancel the group.
                </Alert>
              </>
            )}

            <div className="form-actions">
              {step === 0
                ? <Button to="/app/osusu" variant="secondary">Cancel</Button>
                : <Button variant="secondary" icon={ArrowLeft} onClick={back} disabled={pending}>Back</Button>}
              {current === 'review'
                ? <Button type="submit" loading={pending} loadingText="Creating group...">Create group</Button>
                : <Button type="submit">Continue <ArrowRight size={16} aria-hidden /></Button>}
            </div>
          </form>
        )}
      </AsyncContent>
    </div>
  );
}
