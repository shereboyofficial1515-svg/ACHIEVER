import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileUp, Paperclip, Route as RouteIcon } from 'lucide-react';
import {
  Alert, Button, Card, Checkbox, ErrorState, Input, KeyValue, Loader, PageHeader, Select, StatusBadge, Textarea,
} from '../../components/ui/index.js';
import ReasonDialog from '../../components/domain/ReasonDialog.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { fileSize, formatDateTime, naira } from '../../utils/format.js';
import { TICKET_CATEGORIES } from './Support.jsx';

const EVIDENCE_TYPES = [
  { value: 'payment_receipt', label: 'Payment receipt' },
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'message', label: 'Message / chat' },
  { value: 'document', label: 'Other document' },
];
const OUTCOMES = [
  { value: 'in_favour_of_complainant', label: 'In favour of the reporter' },
  { value: 'in_favour_of_respondent', label: 'In favour of the respondent' },
  { value: 'no_fault_found', label: 'No fault found' },
  { value: 'referred_externally', label: 'Referred externally' },
  { value: 'withdrawn', label: 'Withdrawn by the reporter' },
];

function Evidence({ ticket, staffView, onChange }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [type, setType] = useState('payment_receipt');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [viewing, setViewing] = useState(null);

  const upload = async () => {
    setPending(true);
    try {
      const { data } = await api.upload(`/support/tickets/${ticket.id}/evidence`, file, { evidenceType: type, description });
      toast.success(`Evidence added (fingerprint ${data.sha256.slice(0, 12)}…)`);
      setFile(null);
      setDescription('');
      onChange();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };

  const open = async (e, reason) => {
    const { data } = await api.get(`/support/evidence/${e.id}/url`, reason ? { reason } : undefined);
    window.open(data.url, '_blank', 'noopener');
  };

  return (
    <Card title="Evidence">
      <div className="stack">
        {ticket.evidence.length === 0 && <p className="small muted">No evidence yet.</p>}
        <ul className="list">
          {ticket.evidence.map((e) => (
            <li key={e.id} className="list-item">
              <span className="list-icon"><Paperclip size={16} /></span>
              <div className="grow">
                <strong className="small">
                  {EVIDENCE_TYPES.find((t) => t.value === e.type)?.label || e.type.replace(/_/g, ' ')} · {e.source}
                  {e.supersedesId && ' · replaces earlier evidence'}
                </strong>
                <div className="xsmall muted">
                  {formatDateTime(e.createdAt)}{e.uploadedBy ? ` · ${e.uploadedBy}` : ''}{e.sizeBytes ? ` · ${fileSize(e.sizeBytes)}` : ''}
                  {e.linkedRecordType && ` · linked ${e.linkedRecordType} ${String(e.linkedRecordId).slice(0, 8)}`}
                </div>
                {e.description && <div className="small">{e.description}</div>}
                {e.sha256 && <div className="xsmall muted mono">SHA-256 {e.sha256.slice(0, 16)}…</div>}
              </div>
              {e.hasFile && (
                <Button size="sm" variant="ghost" onClick={() => (staffView ? setViewing(e) : open(e).catch(toast.error))}>
                  Open
                </Button>
              )}
            </li>
          ))}
        </ul>
        {ticket.status !== 'closed' && (
          <div className="stack-sm" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <p className="small muted">Evidence cannot be edited or deleted once added. To correct something, upload a new file.</p>
            <div className="grid-2">
              <Select label="Type" value={type} onChange={(e) => setType(e.target.value)} options={EVIDENCE_TYPES} />
              <Input label="Short description" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="row-wrap">
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <Button size="sm" icon={FileUp} onClick={upload} loading={pending} disabled={!file}>
                Add evidence
              </Button>
            </div>
          </div>
        )}
      </div>
      <ReasonDialog
        open={Boolean(viewing)}
        title="Open evidence"
        description="Access to evidence is logged. Say why you need to see this file."
        onClose={() => setViewing(null)}
        onSubmit={async (reason) => {
          await open(viewing, reason);
          setViewing(null);
        }}
      />
    </Card>
  );
}

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
          <Button size="sm" variant="ghost" icon={RouteIcon} to={`/app/admin/trace?case=${ticket.id}`}>
            Open trace view
          </Button>
        )}
      </div>
    </Card>
  );
}

export default function TicketDetail({ staffView = false }) {
  const { id } = useParams();
  const toast = useToast();
  const ticket = useAsync(() => api.get(`/support/tickets/${id}`), [id]);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [pending, setPending] = useState(false);

  const reply = async (e) => {
    e.preventDefault();
    setPending(true);
    try {
      await api.post(`/support/tickets/${id}/messages`, { body, internal: staffView ? internal : undefined });
      setBody('');
      ticket.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };

  if (ticket.loading && !ticket.data) return <Loader />;
  if (ticket.error) return <ErrorState error={ticket.error} onRetry={ticket.reload} />;
  const t = ticket.data;
  const isStaffView = staffView && t.viewerRole === 'staff';
  return (
    <div className="stack-lg" style={{ maxWidth: 960 }}>
      <PageHeader back={{ to: staffView ? '/app/admin/support' : '/app/support', label: 'Cases' }} title={t.subject} subtitle={<span className="mono">{t.caseNumber || t.reference}</span>} />
      {t.viewerRole === 'respondent' && (
        <Alert tone="info">
          This case was opened by another member about a group or savings plan you are part of. No finding has been made. Add your response and any
          evidence below; ACHIEVER will review both sides.
        </Alert>
      )}
      <div className="grid-2">
        <Card title="Case">
          <KeyValue
            items={[
              ['Status', <StatusBadge key="s" status={t.status} />],
              ['Category', TICKET_CATEGORIES.find((c) => c.value === t.category)?.label || t.category],
              ['Priority', t.priority],
              t.amount && ['Amount involved', naira(t.amount)],
              isStaffView && t.user && ['Opened by', `${t.user.name} (${t.user.email})`],
              isStaffView && ['Assigned to', t.assignee || 'Unassigned'],
              ['Opened', formatDateTime(t.createdAt)],
              t.relatedTransactionId && ['Transaction', <span key="tx" className="mono">{t.relatedTransactionId.slice(0, 8)}</span>],
              t.resolutionOutcome && ['Outcome', OUTCOMES.find((o) => o.value === t.resolutionOutcome)?.label],
              t.resolution && ['Resolution', t.resolution],
            ]}
          />
        </Card>
        {isStaffView ? <StaffPanel ticket={t} onChange={ticket.reload} /> : <Evidence ticket={t} staffView={false} onChange={ticket.reload} />}
      </div>
      {isStaffView && (
        <div className="grid-2">
          <Evidence ticket={t} staffView onChange={ticket.reload} />
          <Card title="Timeline">
            <ul className="list">
              {(t.timeline || []).map((e) => (
                <li key={e.id} className="list-item">
                  <div className="grow">
                    <strong className="small">{e.type.replace(/_/g, ' ')}</strong>
                    <div className="xsmall muted">{formatDateTime(e.createdAt)}{e.actor ? ` · ${e.actor}` : ''}</div>
                  </div>
                </li>
              ))}
            </ul>
            {t.linkedTransactions?.length > 0 && (
              <div className="stack-sm" style={{ marginTop: 12 }}>
                <strong className="small">Linked transactions</strong>
                {t.linkedTransactions.map((tx) => (
                  <Link key={tx.id} className="small mono" to={`/app/admin/trace?transaction=${tx.id}`}>
                    {tx.reference} · {naira(tx.amount)} · {tx.status}
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
      <Card title="Conversation" flush>
        <ul className="list">
          <li className="list-item" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <p className="xsmall muted">{formatDateTime(t.createdAt)} · original report</p>
              <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{t.description}</p>
            </div>
          </li>
          {t.messages.map((m) => (
            <li key={m.id} className="list-item" style={{ alignItems: 'flex-start', background: m.internal ? 'var(--amber-100)' : m.fromStaff ? 'var(--navy-50)' : undefined }}>
              <div className="grow">
                <p className="xsmall muted">
                  {m.fromStaff ? `ACHIEVER support${isStaffView ? ` · ${m.authorName}` : ''}` : m.authorName} · {formatDateTime(m.createdAt)}
                  {m.internal ? ' · internal note' : ''}
                </p>
                <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
              </div>
            </li>
          ))}
        </ul>
        {t.status !== 'closed' && (
          <form className="card-body stack" onSubmit={reply} style={{ borderTop: '1px solid var(--border)' }}>
            <Textarea label="Reply" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
            {isStaffView && <Checkbox label="Internal note (not visible to the parties)" checked={internal} onChange={(e) => setInternal(e.target.checked)} />}
            <div>
              <Button type="submit" loading={pending} disabled={!body.trim()}>Send</Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
