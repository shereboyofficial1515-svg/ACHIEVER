import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Route as RouteIcon } from 'lucide-react';
import { Alert, Button, Card, Checkbox, DataTable, ErrorState, Input, KeyValue, Loader, Modal, PageHeader, Select, StatusBadge, Textarea } from '../components/ui/index.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { api } from '../services/api.js';
import { formatDateTime, naira } from '../utils/format.js';

const OUTCOMES = [
  { value: 'in_favour_of_complainant', label: 'In favour of the reporter' },
  { value: 'in_favour_of_respondent', label: 'In favour of the respondent' },
  { value: 'no_fault_found', label: 'No fault found' },
  { value: 'referred_externally', label: 'Referred externally' },
  { value: 'withdrawn', label: 'Withdrawn by the reporter' },
];

function StaffPanel({ ticket, onChange }) {
  const toast = useToast();
  const { can } = useAuth();
  const [resolution, setResolution] = useState(ticket.resolution || '');
  const [outcome, setOutcome] = useState(ticket.resolutionOutcome || '');
  const [txId, setTxId] = useState('');

  const update = async (patch, message = 'Case updated') => {
    try {
      await api.patch(`/admin/support/tickets/${ticket.id}`, patch);
      toast.success(message);
      onChange();
    } catch (err) {
      toast.error(err);
    }
  };
  const link = async () => {
    try {
      await api.post(`/admin/support/tickets/${ticket.id}/transactions`, { transactionId: txId.trim() });
      toast.success('Transaction linked');
      setTxId('');
      onChange();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Card title="Manage case">
      <div className="stack">
        <div className="grid-2">
          <Select label="Status" value={ticket.status} onChange={(e) => update({ status: e.target.value })} options={['open', 'in_progress', 'awaiting_user'].concat(['resolved', 'closed'].includes(ticket.status) ? [ticket.status] : []).map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} />
          <Select label="Priority" value={ticket.priority} onChange={(e) => update({ priority: e.target.value })} options={['low', 'normal', 'high', 'urgent'].map((s) => ({ value: s, label: s }))} />
        </div>
        <Textarea label="Resolution" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} hint="Required to resolve. Shared with the parties." />
        <Select label="Outcome" placeholder="Choose an outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} options={OUTCOMES} />
        <div className="row-wrap">
          <Button size="sm" disabled={resolution.trim().length < 5 || !outcome} onClick={() => update({ status: 'resolved', resolution, resolutionOutcome: outcome }, 'Case resolved')}>
            Resolve case
          </Button>
          {ticket.status === 'resolved' && <Button size="sm" variant="secondary" onClick={() => update({ status: 'closed' }, 'Case closed')}>Close case</Button>}
        </div>
        {can('disputes.manage') && (
          <div className="row-wrap" style={{ alignItems: 'flex-end' }}>
            <Input label="Link a transaction (ID)" value={txId} onChange={(e) => setTxId(e.target.value)} />
            <Button size="sm" variant="secondary" onClick={link} disabled={txId.trim().length !== 36}>Link</Button>
          </div>
        )}
        {can('trace.read', 'disputes.manage') && (
          <Button size="sm" variant="ghost" icon={RouteIcon} to={`/trace?case=${ticket.id}`}>
            Open trace view
          </Button>
        )}
      </div>
    </Card>
  );
}


/** Staff view of a support case / dispute: conversation, internal notes, evidence, timeline. */
export default function TicketView() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const t = useAsync(() => api.get(`/admin/support/tickets/${id}`), [id]);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [evidence, setEvidence] = useState(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    setPending(true);
    try {
      await api.post(`/admin/support/tickets/${id}/messages`, { body: reply, internal });
      setReply('');
      t.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  const openEvidence = async () => {
    try {
      const { data } = await api.get(`/admin/support/evidence/${evidence.id}/url`, { reason });
      window.open(data.url, '_blank', 'noopener,noreferrer');
      setEvidence(null);
      setReason('');
    } catch (err) {
      toast.error(err);
    }
  };

  if (t.loading && !t.data) return <Loader />;
  if (t.error) return <ErrorState error={t.error} onRetry={t.reload} />;
  const d = t.data;
  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/support', label: 'Support & disputes' }} title={`${d.caseNumber || d.reference}: ${d.subject}`} subtitle={d.user ? `${d.user.name} · ${d.user.email}` : undefined} />
      <div className="grid-2">
        <Card title="Case">
          <KeyValue items={[
            ['Status', <StatusBadge key="s" status={d.status} />],
            ['Priority', d.priority],
            ['Category', d.category.replace(/_/g, ' ')],
            d.amount != null && ['Amount', naira(d.amount)],
            d.relatedGroupId && ['Group', <Link key="g" to={`/groups/${d.relatedGroupId}`}>Open group</Link>],
            d.user && ['Complainant', <Link key="u" to={`/users/${d.user.id}`}>{d.user.name}</Link>],
            ['Opened', formatDateTime(d.createdAt)],
            d.resolutionOutcome && ['Outcome', OUTCOMES.find((o) => o.value === d.resolutionOutcome)?.label],
            d.resolution && ['Resolution', d.resolution],
          ]} />
          <p className="small" style={{ marginTop: 12 }}>{d.description}</p>
        </Card>
        <StaffPanel ticket={d} onChange={t.reload} />
        <Card title="Evidence">
          <DataTable rows={d.evidence || []} empty={<p className="muted small">No evidence.</p>} columns={[
            { key: 't', label: 'Type', render: (e) => e.type },
            { key: 'd', label: 'Description', render: (e) => <span className="small">{e.description}</span> },
            { key: 'b', label: 'By', render: (e) => e.uploadedBy || e.source },
            { key: 'o', label: '', render: (e) => (e.hasFile && can('disputes.evidence.view') ? <Button size="sm" variant="ghost" onClick={() => setEvidence(e)}>Open</Button> : null) },
          ]} />
        </Card>
      </div>
      <Card title="Conversation">
        <ul className="list">
          {d.messages.map((m) => (
            <li key={m.id} className="list-item" style={{ display: 'block' }}>
              <div className="small muted">{m.authorName || 'Unknown'} · {formatDateTime(m.createdAt)} {m.internal && <span className="pill degraded">internal note</span>}</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
            </li>
          ))}
        </ul>
        <form className="stack" onSubmit={send} style={{ marginTop: 12 }}>
          <Textarea label={internal ? 'Internal note (not visible to the user)' : 'Reply to the user'} rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
          <div className="row">
            <Checkbox label="Internal note" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            <span className="grow" />
            <Button type="submit" loading={pending} disabled={!reply.trim()}>{internal ? 'Add note' : 'Send reply'}</Button>
          </div>
        </form>
      </Card>
      {d.timeline?.length > 0 && (
        <Card title="Timeline">
          <ul className="list">{d.timeline.map((e) => <li key={e.id} className="list-item small">{formatDateTime(e.createdAt)} · {e.type.replace(/_/g, ' ')} · {e.actor || 'system'}</li>)}</ul>
        </Card>
      )}
      {evidence && (
        <Modal open onClose={() => setEvidence(null)} title="Open evidence"
          footer={<><Button variant="secondary" onClick={() => setEvidence(null)}>Cancel</Button><Button onClick={openEvidence} disabled={reason.trim().length < 5}>Open (logged)</Button></>}>
          <Alert tone="info">Opening evidence is recorded in the data-access log with your reason.</Alert>
          <Textarea label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Modal>
      )}
    </div>
  );
}
