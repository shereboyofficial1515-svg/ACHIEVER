import { useState } from 'react';
import { Megaphone } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, DataTable, Input, PageHeader, Select, Textarea } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDateTime } from '../../utils/format.js';

function SettingRow({ s, canEdit, onSaved }) {
  const toast = useToast();
  const [value, setValue] = useState(typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value));
  const [pending, setPending] = useState(false);
  const parse = () => {
    if (typeof s.value === 'boolean') return value === 'true';
    if (typeof s.value === 'number') return Number(value);
    if (s.value && typeof s.value === 'object') return JSON.parse(value);
    return value;
  };
  const save = async () => {
    setPending(true);
    try {
      let parsed;
      try {
        parsed = parse();
      } catch {
        throw new Error('Enter valid JSON, e.g. {"contribute":1,"receive_payout":2}');
      }
      await api.put(`/admin/settings/${s.key}`, { value: parsed });
      toast.success('Setting saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  if (!canEdit) return <span className="mono">{typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value)}</span>;
  return (
    <span className="row">
      {typeof s.value === 'boolean' ? (
        <select className="select" value={value} onChange={(e) => setValue(e.target.value)} aria-label={s.key} style={{ minHeight: 36 }}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : s.key === 'payouts.execution_mode' ? (
        <select className="select" value={value} onChange={(e) => setValue(e.target.value)} aria-label={s.key} style={{ minHeight: 36 }}>
          <option value="manual">manual</option>
          <option value="paystack_transfer">paystack_transfer</option>
        </select>
      ) : (
        <input className="input" value={value} onChange={(e) => setValue(e.target.value)} aria-label={s.key} style={{ minHeight: 36 }} />
      )}
      <Button size="sm" onClick={save} loading={pending}>
        Save
      </Button>
    </span>
  );
}

function Broadcast() {
  const toast = useToast();
  const [form, setForm] = useState({ title: '', body: '', role: '' });
  const [pending, setPending] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    setPending(true);
    try {
      const { data } = await api.post('/admin/notifications/broadcast', { title: form.title, body: form.body, role: form.role || undefined });
      toast.success(`Notice sent to ${data.recipients} user(s)`);
      setForm({ title: '', body: '', role: '' });
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Card title="Platform notice">
      <form className="stack" onSubmit={send}>
        <p className="small muted">In-app notice (no email or SMS) for maintenance windows or policy updates.</p>
        <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Textarea label="Message" rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        <Select label="Audience" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={[{ value: '', label: 'All active users' }, ...['OSUSU_ADMIN', 'OSUSU_MEMBER', 'COLLECTOR', 'SAVER'].map((r) => ({ value: r, label: r }))]} />
        <div>
          <Button type="submit" icon={Megaphone} loading={pending} disabled={form.title.length < 3 || form.body.length < 3}>
            Send notice
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function AdminSettings() {
  const { can } = useAuth();
  const settings = useAsync(() => api.get('/admin/settings'), []);
  const superAdmin = can('settings.manage');
  return (
    <div className="stack-lg">
      <PageHeader title="Application settings" />
      {!superAdmin && <Alert tone="info">Only a super admin can change settings. Changes require confirming your password.</Alert>}
      <Card flush>
        <AsyncContent loading={settings.loading} error={settings.error} onRetry={settings.reload}>
          <DataTable
            rowKey="key"
            rows={settings.data || []}
            columns={[
              { key: 'k', label: 'Setting', render: (s) => <span className="mono xsmall">{s.key}</span> },
              { key: 'd', label: 'Description', render: (s) => <span className="small">{s.description}</span> },
              { key: 'v', label: 'Value', render: (s) => <SettingRow key={`${s.key}-${s.updated_at}`} s={s} canEdit={superAdmin} onSaved={settings.reload} /> },
              { key: 'u', label: 'Updated', render: (s) => formatDateTime(s.updated_at) },
            ]}
          />
        </AsyncContent>
      </Card>
      {can('notifications.broadcast') && <Broadcast />}
    </div>
  );
}
