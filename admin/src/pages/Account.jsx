import { useState } from 'react';
import { Alert, AsyncContent, Button, Card, DataTable, Input, PageHeader } from '../components/ui/index.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useConfirm } from '../components/ui/ConfirmProvider.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { api } from '../services/api.js';
import { formatDateTime } from '../utils/format.js';

function Password() {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '', code: '' });
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setError('The new passwords do not match');
    setPending(true);
    setError(null);
    try {
      const { data } = await api.post('/admin/auth/password', { currentPassword: form.currentPassword, newPassword: form.newPassword, code: form.code });
      toast.success(`Password changed. ${data.otherSessionsEnded} other admin session(s) signed out.`);
      setForm({ currentPassword: '', newPassword: '', confirm: '', code: '' });
    } catch (err) {
      setError(err.fields ? Object.values(err.fields)[0] : err.message);
    } finally {
      setPending(false);
    }
    return undefined;
  };
  return (
    <Card title="Change password">
      <form className="stack" onSubmit={submit} style={{ maxWidth: 420 }}>
        <p className="small muted">Also signs out your other admin and member sessions. You will get a security email.</p>
        {error && <Alert tone="danger">{error}</Alert>}
        <Input label="Current password" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        <Input label="New password" type="password" autoComplete="new-password" hint="At least 10 characters with upper and lower case letters and a number." value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        <Input label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        <Input label="Authenticator code" inputMode="numeric" maxLength={6} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, '') })} />
        <div><Button type="submit" loading={pending} disabled={!form.currentPassword || !form.newPassword || form.code.length !== 6}>Change password</Button></div>
      </form>
    </Card>
  );
}

function TwoStep() {
  const mfa = useAsync(() => api.get('/admin/auth/mfa'), []);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const regenerate = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { data } = await api.post('/admin/auth/mfa/backup-codes', { code });
      setCodes(data.backupCodes);
      setCode('');
      mfa.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };
  return (
    <Card title="Two-step verification">
      <AsyncContent loading={mfa.loading} error={mfa.error} onRetry={mfa.reload}>
        {mfa.data && (
          <div className="stack">
            <dl className="kv-inline">
              <dt>Authenticator app</dt><dd>{mfa.data.authenticator ? `Set up ${formatDateTime(mfa.data.enrolledAt)}` : 'Not set up'}</dd>
              <dt>Unused backup codes</dt><dd>{mfa.data.backupCodesLeft}</dd>
            </dl>
            {mfa.data.backupCodesLeft < 4 && <Alert tone="warning">You are running low on backup codes. Create new ones.</Alert>}
            {codes ? (
              <>
                <ol className="backup-codes mono">{codes.map((c) => <li key={c}>{c}</li>)}</ol>
                <Alert tone="warning">Save these now; they are not shown again. Your previous codes no longer work.</Alert>
              </>
            ) : (
              <form className="row-wrap" onSubmit={regenerate}>
                <Input label="Authenticator code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                <Button type="submit" variant="secondary" loading={pending} disabled={code.length !== 6} style={{ alignSelf: 'flex-end' }}>Create new backup codes</Button>
              </form>
            )}
            {error && <Alert tone="danger">{error}</Alert>}
          </div>
        )}
      </AsyncContent>
    </Card>
  );
}

function Sessions() {
  const toast = useToast();
  const { logout } = useAuth();
  const list = useAsync(() => api.get('/admin/auth/sessions'), []);
  const confirmAction = useConfirm();
  const revoke = async (id) => {
    if (!(await confirmAction({ type: 'end_own_session' }))) return;
    try {
      await api.del(`/admin/auth/sessions/${id}`);
      toast.success('Session signed out');
      list.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  const all = async () => {
    if (!(await confirmAction({ type: 'logout_all' }))) return;
    await api.post('/admin/auth/logout-all').catch(() => {});
    await logout();
  };
  return (
    <Card flush title="My admin sessions" actions={<Button size="sm" variant="danger" onClick={all}>Sign out everywhere</Button>}>
      <AsyncContent loading={list.loading} error={list.error} onRetry={list.reload}>
        <DataTable rows={list.data || []}
          columns={[
            { key: 'd', label: 'Device', render: (s) => <span>{s.device}{s.current && <span className="pill on" style={{ marginLeft: 6 }}>This device</span>}</span> },
            { key: 'ip', label: 'Network', render: (s) => s.approximateIp || '—' },
            { key: 's', label: 'Signed in', render: (s) => formatDateTime(s.createdAt) },
            { key: 'l', label: 'Last active', render: (s) => formatDateTime(s.lastActiveAt) },
            { key: 'e', label: 'Ends at the latest', render: (s) => `${formatDateTime(s.expiresAt)} (or ${s.idleMinutes} min idle)` },
            { key: 'x', label: '', render: (s) => (!s.current ? <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}>Sign out</Button> : null) },
          ]} />
      </AsyncContent>
    </Card>
  );
}

export default function Account() {
  const { admin } = useAuth();
  return (
    <div className="stack-lg">
      <PageHeader title="My admin account" subtitle={`${admin?.email} · ${admin?.roles?.join(', ')}`} />
      <div className="grid-2">
        <Password />
        <TwoStep />
      </div>
      <Sessions />
    </div>
  );
}
