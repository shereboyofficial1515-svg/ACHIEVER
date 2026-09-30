import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, DataTable, KeyValue, Modal, PageHeader, Tabs, Textarea } from '../components/ui/index.js';
import { useConfirm } from '../components/ui/ConfirmProvider.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { api } from '../services/api.js';
import { formatDateTime, naira } from '../utils/format.js';
import { AdminTable } from './adminShared.jsx';

const STATUS_TONE = { SUCCESS: 'success', PROCESSING: 'info', PENDING: 'warning', UNKNOWN: 'info', FAILED: 'danger', REVERSED: 'warning', REFUNDED: 'neutral', CANCELLED: 'neutral' };
const HEALTH_TONE = { operational: 'success', degraded: 'warning', unavailable: 'danger', not_configured: 'neutral' };
const Status = ({ s }) => <span className={`badge badge-${STATUS_TONE[s] || 'neutral'}`}>{s}</span>;

function ProviderStatus() {
  const s = useAsync(() => api.get('/admin/bills/provider-status'), []);
  const d = s.data;
  return (
    <Card title="VTpass status" actions={<Button variant="ghost" icon={RefreshCw} onClick={s.reload}>Refresh</Button>}>
      <AsyncContent loading={s.loading} error={s.error} onRetry={s.reload}>
        {d && (
          <div className="stack">
            <p><span className={`badge badge-${HEALTH_TONE[d.status] || 'neutral'}`}>{String(d.status).replace('_', ' ').toUpperCase()}</span>{d.sandbox && <span className="badge badge-warning" style={{ marginLeft: 8 }}>SANDBOX</span>}</p>
            {!d.configured && <Alert tone="info">VTpass is not configured (BILL_PROVIDER and VTPASS_* keys on the API). Members see “temporarily unavailable”; nobody is charged.</Alert>}
            {d.configured && !d.webhookConfigured && <Alert tone="warning">VTPASS_WEBHOOK_TOKEN is not set: status updates rely on requery only.</Alert>}
            <KeyValue items={[
              ['Last successful request', formatDateTime(d.lastSuccessAt) || '—'],
              ['Last failed request', formatDateTime(d.lastFailureAt) || '—'],
              ['Consecutive failures', d.consecutiveFailures ?? 0],
              ['Last error', d.lastErrorCode || '—'],
              ['Last successful transaction', formatDateTime(d.lastTransactionAt) || '—'],
              ['Last webhook', formatDateTime(d.lastWebhookAt) || '—'],
              ['Last requery', formatDateTime(d.lastRequeryAt) || '—'],
              ['Latency (last)', d.lastLatencyMs != null ? `${d.lastLatencyMs} ms` : '—'],
            ]} />
            <p className="xsmall muted">Credentials are never shown here.</p>
          </div>
        )}
      </AsyncContent>
    </Card>
  );
}

function BillDetail({ id, onClose, onChanged }) {
  const { can } = useAuth();
  const toast = useToast();
  const confirmAction = useConfirm();
  const d = useAsync(() => api.get(`/admin/bills/${id}`), [id]);
  const [pending, setPending] = useState(false);
  const reconcile = async () => {
    if (!(await confirmAction({ type: 'bill_reconcile' }))) return;
    setPending(true);
    try {
      const { data } = await api.post(`/admin/bills/${id}/reconcile`, {});
      toast.success(`Result: ${data.outcome}${data.note ? ` — ${data.note}` : ''}`);
      d.reload();
      onChanged?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  const b = d.data;
  return (
    <Modal open onClose={onClose} title="Bill transaction" wide
      footer={can('bills.manage') && b?.paymentReference ? <Button icon={RefreshCw} onClick={reconcile} loading={pending}>Requery / reconcile</Button> : null}>
      <AsyncContent loading={d.loading} error={d.error} onRetry={d.reload}>
        {b && (
          <div className="stack">
            <KeyValue items={[
              ['ACHIEVER reference', <span key="1" className="mono">{b.reference}</span>],
              ['VTpass request ID', <span key="2" className="mono">{b.requestId}</span>],
              ['VTpass transaction ID', <span key="3" className="mono">{b.providerTransactionId || '—'}</span>],
              ['Payment reference', <span key="4" className="mono">{b.paymentReference || '—'}</span>],
              ['User', b.user ? `${b.user.name} (${b.user.email})` : '—'],
              ['Service', `${b.categoryLabel} · ${b.service}`],
              ['Recipient', b.recipient],
              ['Amount / fee / total', `${naira(b.amount)} / ${naira(b.fee)} / ${naira(b.total)}`],
              ['Status', <span key="5"><Status s={b.status} /> <span className="xsmall muted">({b.internalStatus})</span></span>],
              ['Attempts', b.attempts],
              b.lastProviderCode && ['Last provider code', b.lastProviderCode],
              b.lastError && ['Last error', b.lastError],
              ['Approved with', b.authMethod || '—'],
              ['Created', formatDateTime(b.createdAt)],
              b.completedAt && ['Completed', formatDateTime(b.completedAt)],
            ].filter(Boolean)} />
            <h3 className="small">Status history</h3>
            <DataTable rows={b.history || []} columns={[
              { key: 't', label: 'When', render: (h) => formatDateTime(h.created_at) },
              { key: 's', label: 'Change', render: (h) => `${h.from_status || '—'} → ${h.to_status}` },
              { key: 'src', label: 'Source', render: (h) => h.source },
              { key: 'c', label: 'Code', render: (h) => h.provider_code || '' },
            ]} />
            <h3 className="small">Provider responses (redacted)</h3>
            <DataTable rows={b.providerResponses || []} columns={[
              { key: 't', label: 'When', render: (r) => formatDateTime(r.created_at) },
              { key: 'k', label: 'Kind', render: (r) => r.kind },
              { key: 'c', label: 'Code / status', render: (r) => `${r.code || '—'} / ${r.status || '—'}` },
              { key: 'h', label: 'HTTP', render: (r) => r.http_status ?? '' },
            ]} />
          </div>
        )}
      </AsyncContent>
    </Modal>
  );
}

function Services() {
  const { can } = useAuth();
  const toast = useToast();
  const confirmAction = useConfirm();
  const list = useAsync(() => api.get('/admin/bills/services'), []);
  const [editing, setEditing] = useState(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const save = async () => {
    if (!(await confirmAction({ type: 'bill_service_toggle' }))) return;
    setPending(true);
    try {
      await api.patch(`/admin/bills/services/${editing.serviceId}`, { enabled: !editing.enabled, reason });
      toast.success('Service updated');
      setEditing(null);
      setReason('');
      list.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  const refresh = async () => {
    try {
      const { data } = await api.post('/admin/bills/services/refresh', {});
      toast.success(`Catalogue refreshed: ${(data.categories || []).join(', ') || 'no categories'}`);
      list.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Card title="Services" flush actions={can('bills.manage') && <Button variant="secondary" icon={RefreshCw} onClick={refresh}>Refresh from VTpass</Button>}>
      <AsyncContent loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.data?.length}>
        <DataTable rows={list.data || []} rowKey="serviceId" columns={[
          { key: 'c', label: 'Category', render: (s) => s.category },
          { key: 'n', label: 'Service', render: (s) => <span>{s.name}<br /><span className="xsmall muted mono">{s.serviceId}</span></span> },
          { key: 'a', label: 'Offered by VTpass', render: (s) => (s.available ? 'Yes' : 'No') },
          { key: 'e', label: 'Enabled', render: (s) => (s.enabled ? <span className="badge badge-success">On</span> : <span className="badge badge-neutral" title={s.disabledReason || ''}>Off</span>) },
          { key: 'x', label: '', render: (s) => can('bills.manage') && <Button variant="ghost" onClick={() => { setEditing(s); setReason(''); }}>{s.enabled ? 'Switch off' : 'Switch on'}</Button> },
        ]} />
      </AsyncContent>
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={`${editing.enabled ? 'Switch off' : 'Switch on'} ${editing.name}`}
          footer={<Button onClick={save} loading={pending} disabled={reason.trim().length < 5}>Continue</Button>}>
          <Textarea label="Reason (recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Modal>
      )}
    </Card>
  );
}

function Reconciliation() {
  const { can } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState('true');
  const list = useAsync(() => api.get('/admin/bills/reconciliation', { open, pageSize: 50 }), [open]);
  const [resolving, setResolving] = useState(null);
  const [note, setNote] = useState('');
  const resolve = async () => {
    try {
      await api.post(`/admin/bills/reconciliation/${resolving.id}/resolve`, { note });
      toast.success('Marked as resolved');
      setResolving(null);
      list.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Card title="Reconciliation" flush actions={<Tabs value={open} onChange={setOpen} tabs={[{ value: 'true', label: 'Open' }, { value: 'false', label: 'All' }]} />}>
      <AsyncContent loading={list.loading} error={list.error} onRetry={list.reload} empty={!list.data?.length}>
        <DataTable rows={list.data || []} columns={[
          { key: 'd', label: 'When', render: (r) => formatDateTime(r.created_at) },
          { key: 'b', label: 'Bill', render: (r) => <span className="mono xsmall">{r.bill?.reference}</span> },
          { key: 'o', label: 'Outcome', render: (r) => r.outcome },
          { key: 's', label: 'Ours / VTpass', render: (r) => `${r.local_status} / ${r.provider_status || '—'}` },
          { key: 'n', label: 'Note', render: (r) => <span className="xsmall">{r.note}{r.resolution_note ? ` — resolved: ${r.resolution_note}` : ''}</span> },
          { key: 'x', label: '', render: (r) => can('bills.manage') && !r.resolved_at && ['mismatch', 'unresolved'].includes(r.outcome) && <Button variant="ghost" onClick={() => { setResolving(r); setNote(''); }}>Resolve</Button> },
        ]} />
      </AsyncContent>
      {resolving && (
        <Modal open onClose={() => setResolving(null)} title="Resolve reconciliation item" footer={<Button onClick={resolve} disabled={note.trim().length < 5}>Mark resolved</Button>}>
          <p className="small muted">Describe what was checked and done (e.g. refund issued manually, VTpass support ticket number). The bill record itself is not edited.</p>
          <Textarea label="Resolution note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Modal>
      )}
    </Card>
  );
}

export default function AdminBills() {
  const [tab, setTab] = useState('transactions');
  const [detail, setDetail] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div className="stack-lg">
      <PageHeader title="Bills & Services" subtitle="VTpass purchases, provider health, services and reconciliation. Unknown outcomes are requeried automatically." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'transactions', label: 'Transactions' }, { value: 'status', label: 'VTpass status' },
        { value: 'services', label: 'Services' }, { value: 'reconciliation', label: 'Reconciliation' },
      ]} />
      {tab === 'transactions' && (
        <AdminTable
          endpoint="/admin/bills"
          reloadKey={reloadKey}
          onRowClick={(b) => setDetail(b.id)}
          filters={[
            { name: 'search', label: 'ACHIEVER ref / request ID / VTpass ID' },
            { name: 'status', label: 'All statuses', options: ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED', 'REFUNDED', 'CANCELLED'] },
            { name: 'category', label: 'All services', options: ['airtime', 'data', 'electricity', 'tv', 'education', 'betting', 'recharge_pin'] },
            { name: 'userId', label: 'User ID' },
          ]}
          columns={[
            { key: 'r', label: 'Reference', render: (b) => <span className="mono xsmall">{b.reference}<br />{b.requestId}</span> },
            { key: 'u', label: 'User', render: (b) => b.user?.name },
            { key: 'c', label: 'Service', render: (b) => `${b.categoryLabel} · ${b.service}` },
            { key: 't', label: 'Total', align: 'right', render: (b) => <span className="money">{naira(b.total)}</span> },
            { key: 's', label: 'Status', render: (b) => <span className="stack-sm"><Status s={b.status} />{b.lastError && <span className="xsmall muted">{b.lastError}</span>}</span> },
            { key: 'a', label: 'Attempts', render: (b) => b.attempts },
            { key: 'd', label: 'Created', render: (b) => formatDateTime(b.createdAt) },
          ]}
        />
      )}
      {tab === 'status' && <ProviderStatus />}
      {tab === 'services' && <Services />}
      {tab === 'reconciliation' && <Reconciliation />}
      {detail && <BillDetail id={detail} onClose={() => setDetail(null)} onChanged={() => setReloadKey((k) => k + 1)} />}
    </div>
  );
}
