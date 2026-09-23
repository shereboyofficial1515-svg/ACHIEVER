import { useState } from 'react';
import { CalendarDays, CalendarPlus, Video } from 'lucide-react';
import {
  AsyncContent, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, Modal, PageHeader, Select, SkeletonList, StatusBadge, Textarea, fieldErrors,
} from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useCalls } from '../../contexts/CallContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDateTime } from '../../utils/format.js';

export function ScheduleMeetingModal({ open, onClose, groups, defaultGroupId, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ groupId: defaultGroupId || '', title: '', description: '', startsAt: '', durationMinutes: 60, callEnabled: true });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post('/meetings', { ...form, startsAt: new Date(form.startsAt).toISOString(), durationMinutes: Number(form.durationMinutes) });
      toast.success('Meeting scheduled. Members have been notified.');
      onCreated();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };
  const fe = fieldErrors(error);
  return (
    <Modal open={open} onClose={onClose} title="Schedule a meeting">
      <form className="stack" onSubmit={submit}>
        {error && !Object.keys(fe).length && <p className="error small" style={{ color: 'var(--red-600)' }}>{error.message}</p>}
        {!defaultGroupId && (
          <Select label="Group" placeholder="Select a group" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })} options={groups.map((g) => ({ value: g.id, label: g.name }))} error={fe.groupId} />
        )}
        <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={fe.title} />
        <Textarea label="Agenda (optional)" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} error={fe.description} />
        <div className="grid-2">
          <Input label="Date and time" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} error={fe.startsAt} />
          <Select label="Duration" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} options={[30, 45, 60, 90, 120].map((m) => ({ value: m, label: `${m} minutes` }))} />
        </div>
        <Checkbox label="Hold this meeting as a group video/voice call on ACHIEVER" checked={form.callEnabled} onChange={(e) => setForm({ ...form, callEnabled: e.target.checked })} />
        <Button type="submit" loading={pending} disabled={!form.groupId || !form.title || !form.startsAt}>
          Schedule meeting
        </Button>
      </form>
    </Modal>
  );
}

export function MeetingList({ meetings, onChange }) {
  const calls = useCalls();
  const toast = useToast();
  const [cancel, setCancel] = useState(null);
  const [pending, setPending] = useState(false);
  const doCancel = async () => {
    setPending(true);
    try {
      await api.post(`/meetings/${cancel.id}/cancel`);
      toast.info('Meeting cancelled');
      setCancel(null);
      onChange();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <ul className="list">
        {meetings.map((m) => (
          <li key={m.id} className="list-item">
            <span className="list-icon">
              <CalendarDays size={18} />
            </span>
            <div className="grow">
              <p style={{ fontWeight: 500 }}>{m.title}</p>
              <p className="xsmall muted">
                {m.groupName} · {formatDateTime(m.startsAt)} · {m.durationMinutes} min
              </p>
              {m.description && <p className="small muted">{m.description}</p>}
            </div>
            <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>
              <StatusBadge status={m.status} />
              {m.callEnabled && m.isOrganizer && ['scheduled', 'in_progress'].includes(m.status) && (
                <Button size="sm" icon={Video} onClick={() => calls.startMeeting(m.id, 'video').then(onChange)} disabled={calls.busy || calls.inCall}>
                  {m.status === 'in_progress' ? 'Rejoin' : 'Start'}
                </Button>
              )}
              {m.callEnabled && !m.isOrganizer && m.status === 'in_progress' && (
                <Button size="sm" icon={Video} onClick={() => calls.joinMeeting(m.id)} disabled={calls.busy || calls.inCall}>
                  Join
                </Button>
              )}
              {m.isOrganizer && m.status === 'scheduled' && (
                <Button size="sm" variant="ghost" onClick={() => setCancel(m)}>
                  Cancel
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog open={Boolean(cancel)} onClose={() => setCancel(null)} onConfirm={doCancel} pending={pending} tone="danger" confirmLabel="Cancel meeting" title="Cancel this meeting?" message="Members will be notified that the meeting has been cancelled." />
    </>
  );
}

export default function Meetings() {
  const { has } = useAuth();
  const [open, setOpen] = useState(false);
  const meetings = useAsync(() => api.get('/meetings', { upcomingOnly: 'true' }), []);
  const groups = useAsync(() => (has('OSUSU_ADMIN') ? api.get('/osusu/groups', { scope: 'admin', pageSize: 100 }) : Promise.resolve({ data: [] })), []);
  const myGroups = (groups.data || []).filter((g) => ['recruiting', 'active'].includes(g.status));
  return (
    <div className="stack-lg" style={{ maxWidth: 900 }}>
      <PageHeader
        title="Meetings"
        subtitle="Upcoming group meetings and calls"
        actions={myGroups.length > 0 && <Button icon={CalendarPlus} onClick={() => setOpen(true)}>Schedule meeting</Button>}
      />
      <Card flush>
        <AsyncContent
          loading={meetings.loading}
          error={meetings.error}
          onRetry={meetings.reload}
          empty={!meetings.data?.length}
          skeleton={<SkeletonList rows={3} />}
          emptyState={<EmptyState icon={CalendarDays} title="No upcoming meetings" message="Meetings scheduled by your group organisers will appear here." />}
        >
          <MeetingList meetings={meetings.data || []} onChange={meetings.reload} />
        </AsyncContent>
      </Card>
      {open && <ScheduleMeetingModal open={open} onClose={() => setOpen(false)} groups={myGroups} onCreated={meetings.reload} />}
    </div>
  );
}
