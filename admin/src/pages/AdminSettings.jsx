import { useMemo, useState } from 'react';
import { History, MessageSquareText } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, DataTable, Modal, PageHeader, Textarea } from '../components/ui/index.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { api } from '../services/api.js';
import { formatDateTime } from '../utils/format.js';

const CATEGORY_LABELS = {
  authentication: 'Authentication', verification: 'Verification codes', sms: 'SMS', email: 'Email', payments: 'Payments',
  notifications: 'Notifications', security: 'Security', maintenance: 'Maintenance', support: 'Support', registration: 'Registration',
  kyc: 'KYC', collector_onboarding: 'Collector onboarding', transaction_limits: 'Transaction limits', admin: 'Admin sessions', general: 'General',
  bills: 'Bills & Services (VTpass)', referrals: 'Referral programme',
};
const show = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Action → confirmation → reason → (authenticator code, asked by the API) → audit → saved. */
function ChangeDialog({ setting, onClose, onSaved }) {
  const toast = useToast();
  const [value, setValue] = useState(show(setting.value));
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const parsed = () => {
    if (setting.value_type === 'boolean') return value === 'true';
    if (setting.value_type === 'integer') return Number(value);
    if (setting.value_type === 'object') return JSON.parse(value);
    return value;
  };
  let preview = null;
  try {
    const next = parsed();
    preview = setting.warnings?.[String(next)] ?? setting.warnings?.any ?? null;
  } catch {
    preview = null;
  }
  const save = async () => {
    setPending(true);
    setError(null);
    try {
      let next;
      try {
        next = parsed();
      } catch {
        throw new Error('Enter valid JSON, e.g. {"contribute":1,"receive_payout":2,"withdraw":2,"operator":2}');
      }
      await api.put(`/admin/settings/${setting.key}`, { value: next, reason });
      toast.success('Setting saved and recorded');
      onSaved();
    } catch (err) {
      setError(err.fields?.reason || err.message);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Change: ${setting.label || setting.key}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
        <Button variant={setting.critical ? 'danger' : 'primary'} onClick={save} loading={pending} disabled={reason.trim().length < 5 || value === show(setting.value)}>Save change</Button></>}>
      <div className="stack">
        <p className="small muted">{setting.description}</p>
        <dl className="kv-inline"><dt>Current value</dt><dd className="mono">{show(setting.value)}</dd></dl>
        {setting.value_type === 'boolean' ? (
          <select className="select" value={value} onChange={(e) => setValue(e.target.value)} aria-label="New value">
            <option value="true">On</option>
            <option value="false">Off</option>
          </select>
        ) : setting.value_type === 'enum' ? (
          <select className="select" value={value} onChange={(e) => setValue(e.target.value)} aria-label="New value">
            {(setting.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} aria-label="New value"
            inputMode={setting.value_type === 'integer' ? 'numeric' : undefined} />
        )}
        {setting.value_type === 'integer' && (setting.min_value != null || setting.max_value != null) && (
          <span className="setting-meta">Allowed range: {setting.min_value ?? '—'} to {setting.max_value ?? '—'}</span>
        )}
        {preview && <Alert tone="warning">{preview}</Alert>}
        {setting.critical && <Alert tone="info">Security-critical setting: you will be asked for an authenticator code.</Alert>}
        <Textarea label="Reason (required, kept in the setting history and audit log)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

function HistoryDialog({ setting, onClose }) {
  const h = useAsync(() => api.get(`/admin/settings/${setting.key}/history`), [setting.key]);
  return (
    <Modal open wide onClose={onClose} title={`History: ${setting.label || setting.key}`}>
      <AsyncContent loading={h.loading} error={h.error} onRetry={h.reload}>
        <DataTable rows={h.data || []} empty={<p className="muted">No changes recorded yet.</p>}
          columns={[
            { key: 'w', label: 'When', render: (r) => formatDateTime(r.created_at) },
            { key: 'by', label: 'By', render: (r) => r.actor?.full_name || '—' },
            { key: 'p', label: 'From', render: (r) => <span className="mono">{show(r.previous_value)}</span> },
            { key: 'n', label: 'To', render: (r) => <span className="mono">{show(r.new_value)}</span> },
            { key: 'r', label: 'Reason', render: (r) => r.reason },
          ]} />
      </AsyncContent>
    </Modal>
  );
}

function SmsPanel() {
  const { can } = useAuth();
  const toast = useToast();
  const sms = useAsync(() => api.get('/admin/sms'), []);
  const [change, setChange] = useState(null); // { field, value }
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const s = sms.data;
  const save = async () => {
    setPending(true);
    try {
      await api.put('/admin/sms', { [change.field]: change.value, reason });
      toast.success('SMS settings saved and recorded');
      setChange(null);
      setReason('');
      sms.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  const statusLabel = { operational: 'Operational', degraded: 'Degraded', unavailable: 'Unavailable', not_configured: 'Configuration required' };
  const canEdit = can('sms.configure');
  return (
    <Card title={<span className="row"><MessageSquareText size={16} aria-hidden="true" /> SMS verification (Termii)</span>}>
      <AsyncContent loading={sms.loading} error={sms.error} onRetry={sms.reload}>
        {s && (
          <div className="stack">
            <div className="toggle-row">
              <div className="grow">
                <strong>SMS verification</strong>
                <div className="setting-meta">Phone verification codes by SMS. When off, the verified email is used instead and phones are verified later.</div>
              </div>
              <span className={`pill ${s.verificationEnabled ? 'on' : 'off'}`}>{s.verificationEnabled ? 'ON' : 'OFF'}</span>
              {canEdit && <Button size="sm" variant={s.verificationEnabled ? 'danger' : 'primary'} onClick={() => setChange({ field: 'verificationEnabled', value: !s.verificationEnabled })}>{s.verificationEnabled ? 'Turn off' : 'Turn on'}</Button>}
            </div>
            <div className="toggle-row">
              <div className="grow">
                <strong>SMS notifications</strong>
                <div className="setting-meta">Non-security notices by SMS (email and in-app notices continue either way).</div>
              </div>
              <span className={`pill ${s.notificationsEnabled ? 'on' : 'off'}`}>{s.notificationsEnabled ? 'ON' : 'OFF'}</span>
              {canEdit && <Button size="sm" variant="secondary" onClick={() => setChange({ field: 'notificationsEnabled', value: !s.notificationsEnabled })}>{s.notificationsEnabled ? 'Turn off' : 'Turn on'}</Button>}
            </div>
            <dl className="kv-inline">
              <dt>Provider</dt><dd>{s.provider}</dd>
              <dt>Status</dt><dd><span className={`pill ${s.providerStatus}`}>{statusLabel[s.providerStatus]}</span></dd>
              <dt>Verification path now</dt><dd className="mono">{s.state}</dd>
              <dt>Sender ID</dt><dd>{s.senderId || 'Not configured'}</dd>
              <dt>Last successful SMS</dt><dd>{s.lastSuccessAt ? formatDateTime(s.lastSuccessAt) : '—'}</dd>
              <dt>Last failed SMS</dt><dd>{s.lastFailureAt ? `${formatDateTime(s.lastFailureAt)} (${s.lastErrorCode})` : '—'}</dd>
              <dt>Failures (total / in a row)</dt><dd>{s.failureCount} / {s.consecutiveFailures}</dd>
              <dt>Last response time</dt><dd>{s.lastLatencyMs != null ? `${s.lastLatencyMs} ms` : '—'}</dd>
              {s.retryAfter && (<><dt>Paused until</dt><dd>{formatDateTime(s.retryAfter)}</dd></>)}
            </dl>
            {!s.configured && <Alert tone="info">Termii credentials are not set on the server (TERMII_API_KEY, TERMII_SENDER_ID), so SMS cannot be turned on. API keys are never shown here.</Alert>}
          </div>
        )}
      </AsyncContent>
      {change && (
        <Modal open onClose={() => setChange(null)} title="Confirm SMS change"
          footer={<><Button variant="secondary" onClick={() => setChange(null)} disabled={pending}>Cancel</Button>
            <Button variant="danger" onClick={save} loading={pending} disabled={reason.trim().length < 5}>Continue</Button></>}>
          <div className="stack">
            {change.field === 'verificationEnabled' && !change.value && (
              <Alert tone="warning">SMS verification will be disabled for applicable account verification flows. Users will use the configured fallback verification method. Continue?</Alert>
            )}
            {change.field === 'verificationEnabled' && change.value && (
              <Alert tone="info">Users will be asked to verify phones by SMS again. Accounts verified with the email fallback keep their access.</Alert>
            )}
            {change.field === 'notificationsEnabled' && <p className="small">SMS notifications will be turned {change.value ? 'on' : 'off'}.</p>}
            <Textarea label="Reason (required, audited)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="small muted">You will be asked for an authenticator code.</p>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function SecurityMethods() {
  return (
    <Card title="Sign-in & verification methods">
      <dl className="kv-inline">
        <dt>Email verification</dt><dd><span className="pill on">Always on</span> Required for every member account; also the fallback when SMS is off.</dd>
        <dt>Authenticator app (TOTP)</dt><dd><span className="pill on">Required for administrators</span> Not yet offered to members.</dd>
        <dt>Passkeys / security keys</dt><dd><span className="pill off">Not available</span> Planned.</dd>
        <dt>SMS for admin sign-in</dt><dd><span className="pill off">Never used</span></dd>
      </dl>
    </Card>
  );
}

export default function AdminSettings() {
  const { can } = useAuth();
  const settings = useAsync(() => (can('settings.read') ? api.get('/admin/settings') : Promise.resolve({ data: [] })), []);
  const [editing, setEditing] = useState(null);
  const [history, setHistory] = useState(null);
  const canEdit = can('settings.manage');
  const groups = useMemo(() => {
    const out = {};
    for (const s of settings.data || []) {
      if (s.category === 'sms') continue; // managed in the SMS panel
      (out[s.category] ||= []).push(s);
    }
    return out;
  }, [settings.data]);
  return (
    <div className="stack-lg">
      <PageHeader title="Platform settings" subtitle="Typed settings. Every change needs a reason and is kept in the history." />
      {!canEdit && <Alert tone="info">You can view settings. Changing them needs the settings permission.</Alert>}
      {can('sms.read') && <SmsPanel />}
      <SecurityMethods />
      <AsyncContent loading={settings.loading} error={settings.error} onRetry={settings.reload}>
        {Object.entries(groups).map(([category, rows]) => (
          <Card key={category} title={CATEGORY_LABELS[category] || category} flush>
            <DataTable rowKey="key" rows={rows}
              columns={[
                { key: 'l', label: 'Setting', render: (s) => <div><strong className="small">{s.label || s.key}</strong><div className="setting-meta mono">{s.key}</div></div> },
                { key: 'v', label: 'Value', render: (s) => <span className="mono">{s.value_type === 'boolean' ? (s.value ? 'On' : 'Off') : show(s.value)}</span> },
                { key: 'u', label: 'Last changed', render: (s) => <span className="small">{formatDateTime(s.updated_at)}{s.updater ? ` · ${s.updater.full_name}` : ''}</span> },
                { key: 'a', label: '', render: (s) => (
                  <span className="row">
                    <Button size="sm" variant="ghost" icon={History} onClick={() => setHistory(s)}>History</Button>
                    {canEdit && <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>Change</Button>}
                  </span>
                ) },
              ]} />
          </Card>
        ))}
      </AsyncContent>
      {editing && <ChangeDialog setting={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); settings.reload(); }} />}
      {history && <HistoryDialog setting={history} onClose={() => setHistory(null)} />}
    </div>
  );
}
