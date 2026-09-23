import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, Checkbox, ErrorState, KeyValue, Loader, PageHeader, Select, StatusBadge, Textarea } from '../../components/ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDateTime } from '../../utils/format.js';
import { TICKET_CATEGORIES } from './Support.jsx';

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

  const update = async (patch) => {
    try {
      await api.patch(`/admin/support/tickets/${id}`, patch);
      toast.success('Case updated');
      ticket.reload();
    } catch (err) {
      toast.error(err);
    }
  };

  if (ticket.loading && !ticket.data) return <Loader />;
  if (ticket.error) return <ErrorState error={ticket.error} onRetry={ticket.reload} />;
  const t = ticket.data;
  return (
    <div className="stack-lg" style={{ maxWidth: 900 }}>
      <PageHeader back={{ to: staffView ? '/app/admin/support' : '/app/support', label: 'Support cases' }} title={t.subject} subtitle={<span className="mono">{t.reference}</span>} />
      <div className="grid-2">
        <Card title="Case">
          <KeyValue
            items={[
              ['Status', <StatusBadge key="s" status={t.status} />],
              ['Category', TICKET_CATEGORIES.find((c) => c.value === t.category)?.label],
              ['Priority', t.priority],
              staffView && t.user && ['Opened by', `${t.user.name} (${t.user.email})`],
              staffView && ['Assigned to', t.assignee || 'Unassigned'],
              ['Opened', formatDateTime(t.createdAt)],
              t.relatedTransactionId && ['Transaction', <span key="tx" className="mono">{t.relatedTransactionId.slice(0, 8)}</span>],
            ]}
          />
        </Card>
        {staffView && (
          <Card title="Manage">
            <div className="stack">
              <Select label="Status" value={t.status} onChange={(e) => update({ status: e.target.value })} options={['open', 'in_progress', 'awaiting_user', 'resolved', 'closed'].map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} />
              <Select label="Priority" value={t.priority} onChange={(e) => update({ priority: e.target.value })} options={['low', 'normal', 'high', 'urgent'].map((s) => ({ value: s, label: s }))} />
            </div>
          </Card>
        )}
      </div>
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
                  {m.fromStaff ? `ACHIEVER support${staffView ? ` · ${m.authorName}` : ''}` : m.authorName} · {formatDateTime(m.createdAt)}
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
            {staffView && <Checkbox label="Internal note (not visible to the customer)" checked={internal} onChange={(e) => setInternal(e.target.checked)} />}
            <div>
              <Button type="submit" loading={pending} disabled={!body.trim()}>
                Send
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
