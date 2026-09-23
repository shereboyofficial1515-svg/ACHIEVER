import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BadgeCheck } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, Checkbox, Input, MoneyInput, PageHeader, Select, Textarea, fieldErrors } from '../../components/ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { FREQUENCY_LABEL, naira, parseNairaToKobo, todayLagos } from '../../utils/format.js';

export default function CreateGroup() {
  const navigate = useNavigate();
  const toast = useToast();
  const onboarding = useAsync(() => api.get('/verification/status'), []);
  const [form, setForm] = useState({
    name: '', description: '', amount: '', frequency: 'weekly', maxMembers: 10, startDate: todayLagos(),
    gracePeriodDays: 1, payoutOrderMethod: 'join_order', requiresApproval: true, adminParticipates: true, meetingSchedule: '',
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const kobo = parseNairaToKobo(form.amount);
  const members = Number(form.maxMembers) || 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!kobo) {
      setError({ fields: { contributionAmount: 'Enter a valid amount' } });
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { data } = await api.post('/osusu/groups', {
        name: form.name,
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
    } finally {
      setPending(false);
    }
  };

  const organiser = onboarding.data?.operators?.find((o) => o.role === 'OSUSU_ADMIN');
  const fe = fieldErrors(error);

  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      <PageHeader title="Create an Osusu group" back={{ to: '/app/osusu', label: 'Groups' }} />
      <AsyncContent loading={onboarding.loading} error={onboarding.error} onRetry={onboarding.reload}>
        {organiser && !organiser.active ? (
          <Alert tone="warning" icon={BadgeCheck}>
            You need to finish organiser verification (phone, identity and undertaking) before creating a group.{' '}
            <Link to="/app/onboarding">Complete verification</Link>
          </Alert>
        ) : (
          <form className="stack-lg" onSubmit={submit} noValidate>
            {error?.message && !Object.keys(fe).length && <Alert tone="danger">{error.message}</Alert>}
            <Card title="Group details">
              <div className="stack">
                <Input label="Group name" value={form.name} onChange={set('name')} error={fe.name} placeholder="e.g. Balogun Market Traders" />
                <Textarea label="Description (optional)" rows={3} value={form.description} onChange={set('description')} error={fe.description} />
                <Input label="Meeting schedule (optional)" value={form.meetingSchedule} onChange={set('meetingSchedule')} placeholder="e.g. First Saturday of the month, 4pm" error={fe.meetingSchedule} />
              </div>
            </Card>
            <Card title="Contributions">
              <div className="stack">
                <div className="grid-2">
                  <MoneyInput label="Contribution per member" value={form.amount} onChange={set('amount')} error={fe.contributionAmount} placeholder="20,000" hint="Minimum ₦100" />
                  <Select label="Frequency" value={form.frequency} onChange={set('frequency')} options={['daily', 'weekly', 'biweekly', 'monthly'].map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }))} />
                  <Input label="Number of members" type="number" min={2} max={100} value={form.maxMembers} onChange={set('maxMembers')} error={fe.maxMembers} hint="Also the number of cycles" />
                  <Input label="Start date (first due date)" type="date" min={todayLagos()} value={form.startDate} onChange={set('startDate')} error={fe.startDate} />
                  <Select label="Grace period" value={form.gracePeriodDays} onChange={set('gracePeriodDays')} options={[0, 1, 2, 3, 5, 7].map((d) => ({ value: d, label: d === 0 ? 'None' : `${d} day${d > 1 ? 's' : ''}` }))} hint="Days after the due date before a contribution is marked overdue" />
                  <Select
                    label="Payout order"
                    value={form.payoutOrderMethod}
                    onChange={set('payoutOrderMethod')}
                    options={[
                      { value: 'join_order', label: 'Order members joined' },
                      { value: 'random', label: 'Random draw at start' },
                      { value: 'manual', label: 'Set manually before start' },
                    ]}
                  />
                </div>
                {kobo > 0 && members >= 2 && (
                  <Alert tone="info">
                    Each cycle pools <strong>{naira(kobo * members)}</strong> ({members} × {naira(kobo)}), paid to one member. The group runs for {members} cycles, and every
                    member keeps contributing until all {members} have been paid.
                  </Alert>
                )}
              </div>
            </Card>
            <Card title="Membership">
              <div className="stack">
                <Checkbox label="I will also participate as a member (contribute and receive a payout)" checked={form.adminParticipates} onChange={set('adminParticipates')} />
                <Checkbox label="Members who join with the group code need my approval" checked={form.requiresApproval} onChange={set('requiresApproval')} />
              </div>
            </Card>
            <div className="row">
              <Button to="/app/osusu" variant="secondary">
                Cancel
              </Button>
              <Button type="submit" loading={pending} loadingText="Creating group...">
                Create group
              </Button>
            </div>
          </form>
        )}
      </AsyncContent>
    </div>
  );
}
