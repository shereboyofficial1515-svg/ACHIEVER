import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, Checkbox, DataTable, Input, Modal, PageHeader, Pagination, StatusBadge, Textarea } from '../components/ui/index.js';
import { STAFF_ROLES, useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { api } from '../services/api.js';
import { formatDateTime } from '../utils/format.js';

const ROLE_HELP = {
  SUPER_ADMIN: 'Everything, including administrators and settings',
  ADMIN: 'Legacy operations role',
  COMPLIANCE_ADMIN: 'KYC, identity documents, collector approval',
  FINANCE_ADMIN: 'Ledger, payouts, reversals (two-person)',
  DISPUTE_ADMIN: 'Dispute cases and evidence',
  SECURITY_ADMIN: 'Security events, sessions, restrictions',
  SUPPORT_ADMIN: 'Support tickets only',
  CONTENT_ADMIN: 'Platform notices only',
  AUDITOR: 'Read-only: ledger, audit and access logs',
  READ_ONLY_ADMIN: 'Read-only overview',
};

function RolePicker({ value, onChange, canGrantSuper }) {
  return (
    <fieldset className="stack-sm">
      <legend className="small">Roles</legend>
      {STAFF_ROLES.filter((r) => r !== 'ADMIN').map((r) => (
        <Checkbox key={r} disabled={r === 'SUPER_ADMIN' && !canGrantSuper}
          label={<span><strong>{r}</strong> <span className="muted small">— {ROLE_HELP[r]}</span></span>}
          checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
      ))}
    </fieldset>
  );
}

/** Every change: confirmation + reason + authenticator code (asked by the API) + audit. */
function ActionDialog({ action, onClose, onDone }) {
  const toast = useToast();
  const { admin: me } = useAuth();
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState(action.target?.roles || []);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const canGrantSuper = me?.roles?.includes('SUPER_ADMIN');
  const t = action.target;
  const config = {
    create: { title: 'Add an administrator', button: 'Grant access', run: () => api.post('/admin/admins', { email, roles, reason }) },
    roles: { title: `Change roles: ${t?.name}`, button: 'Save roles', run: () => api.put(`/admin/admins/${t.id}/roles`, { roles, reason }) },
    disable: { title: `Disable ${t?.name}?`, button: 'Disable access', danger: true, run: () => api.post(`/admin/admins/${t.id}/status`, { status: 'disabled', reason }) },
    enable: { title: `Re-enable ${t?.name}?`, button: 'Re-enable', run: () => api.post(`/admin/admins/${t.id}/status`, { status: 'active', reason }) },
    mfa: { title: `Reset authenticator for ${t?.name}?`, button: 'Reset authenticator', danger: true, run: () => api.post(`/admin/admins/${t.id}/mfa-reset`, { reason }) },
  }[action.kind];
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await config.run();
      toast.success('Saved and recorded in the audit log');
      onDone();
    } catch (err) {
      setError(err.fields ? Object.values(err.fields)[0] : err.message);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open wide={action.kind === 'create' || action.kind === 'roles'} onClose={onClose} title={config.title}
      footer={<><Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
        <Button variant={config.danger ? 'danger' : 'primary'} onClick={submit} loading={pending}
          disabled={reason.trim().length < 5 || ((action.kind === 'create' || action.kind === 'roles') && !roles.length) || (action.kind === 'create' && !email)}>{config.button}</Button></>}>
      <div className="stack">
        {action.kind === 'create' && (
          <>
            <Alert tone="info">The person must already have a verified ACHIEVER account. They will set up an authenticator app at their first admin sign-in.</Alert>
            <Input label="Their account email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </>
        )}
        {(action.kind === 'create' || action.kind === 'roles') && <RolePicker value={roles} onChange={setRoles} canGrantSuper={canGrantSuper} />}
        {action.kind === 'disable' && <Alert tone="warning">Their admin sessions end immediately. Their member account is not affected.</Alert>}
        {action.kind === 'mfa' && <Alert tone="warning">Their authenticator and backup codes stop working and their admin sessions end. They set up a new authenticator at the next sign-in. Only do this after confirming their identity.</Alert>}
        <Textarea label="Reason (required, audited)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

export default function Admins() {
  const { can, admin: me } = useAuth();
  const [page, setPage] = useState(1);
  const list = useAsync(() => api.get('/admin/admins', { page, pageSize: 25 }), [page]);
  const [action, setAction] = useState(null);
  const manage = can('admins.manage');
  return (
    <div className="stack-lg">
      <PageHeader title="Administrators" subtitle="Who can sign in to the admin platform, with which roles"
        actions={manage && <Button icon={UserPlus} onClick={() => setAction({ kind: 'create' })}>Add administrator</Button>} />
      <Card flush>
        <AsyncContent loading={list.loading} error={list.error} onRetry={list.reload}>
          <DataTable rows={list.data || []}
            columns={[
              { key: 'n', label: 'Administrator', render: (a) => <div><strong>{a.name}</strong><div className="small muted">{a.email}</div></div> },
              { key: 'r', label: 'Roles', render: (a) => <span className="small">{a.roles.join(', ') || '—'}</span> },
              { key: 's', label: 'Status', render: (a) => <span><StatusBadge status={a.status} />{a.lockedUntil && <span className="pill danger">locked</span>}</span> },
              { key: 'm', label: 'Authenticator', render: (a) => (a.mfaEnrolled ? <span className="pill on">Set up</span> : <span className="pill degraded">Pending first sign-in</span>) },
              { key: 'l', label: 'Last sign-in', render: (a) => (a.lastLoginAt ? formatDateTime(a.lastLoginAt) : 'Never') },
              { key: 'x', label: 'Sessions', render: (a) => a.activeSessions },
              { key: 'a', label: '', render: (a) => (manage && a.id !== me?.id ? (
                <span className="row-wrap">
                  <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'roles', target: a })}>Roles</Button>
                  {a.status === 'active'
                    ? <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'disable', target: a })}>Disable</Button>
                    : <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'enable', target: a })}>Enable</Button>}
                  {a.mfaEnrolled && <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'mfa', target: a })}>Reset MFA</Button>}
                </span>
              ) : a.id === me?.id ? <span className="small muted">You</span> : null) },
            ]} />
          <Pagination meta={list.meta} onPage={setPage} />
        </AsyncContent>
      </Card>
      {action && <ActionDialog action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); list.reload(); }} />}
    </div>
  );
}
