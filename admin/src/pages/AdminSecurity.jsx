import { useState } from 'react';
import { AsyncContent, Button, Card, DataTable, PageHeader, Pagination, Select, StatusBadge, Tabs } from '../components/ui/index.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useConfirm } from '../components/ui/ConfirmProvider.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { api } from '../services/api.js';
import { formatDateTime } from '../utils/format.js';

const FILTERS = [
  { value: '', label: 'All admin activity' },
  { value: 'admin.auth.login', label: 'Sign-ins (success and failure)' },
  { value: 'admin.auth.step_up', label: 'Authenticator confirmations' },
  { value: 'admin.admins.created,admin.admins.roles_changed,admin.admins.disabled,admin.admins.enabled,admin.admins.mfa_reset,admin.admins.bootstrap', label: 'Role and permission changes' },
  { value: 'admin.settings.changed,admin.sms.verification_enabled,admin.sms.verification_disabled,admin.sms.notifications_enabled,admin.sms.notifications_disabled,admin.maintenance.enabled,admin.maintenance.disabled', label: 'Configuration changes' },
  { value: 'admin.user.sensitive_view,admin.verification.document_view,admin.kyc.document_view', label: 'Sensitive data access' },
  { value: 'admin.payout.confirm,admin.payout.fail,admin.payout.retry,approval.execute,approval.decide', label: 'Financial overrides' },
];

function Activity() {
  const [page, setPage] = useState(1);
  const [actions, setActions] = useState('');
  const feed = useAsync(() => api.get('/admin/security/admin-activity', { page, pageSize: 50, actions: actions || undefined }), [page, actions]);
  return (
    <Card flush title="Administrator activity" actions={<Select aria-label="Filter" value={actions} onChange={(e) => { setPage(1); setActions(e.target.value); }} options={FILTERS} />}>
      <AsyncContent loading={feed.loading} error={feed.error} onRetry={feed.reload}>
        <DataTable rows={feed.data || []} empty={<p className="card-body muted">No matching activity.</p>}
          columns={[
            { key: 't', label: 'When', render: (r) => formatDateTime(r.created_at) },
            { key: 'a', label: 'Admin', render: (r) => r.actor?.full_name || '—' },
            { key: 'x', label: 'Action', render: (r) => <span className="mono small">{r.action}</span> },
            { key: 'res', label: 'Result', render: (r) => <StatusBadge status={r.result} /> },
            { key: 'o', label: 'Target', render: (r) => <span className="small">{r.resource_type}{r.resource_id ? ` · ${String(r.resource_id).slice(0, 12)}` : ''}</span> },
            { key: 'why', label: 'Reason / detail', render: (r) => <span className="small">{r.reason || r.metadata?.reason || r.metadata?.method || ''}</span> },
            { key: 'rid', label: 'Request', render: (r) => <span className="mono small">{r.request_id?.slice(0, 8) || ''}</span> },
          ]} />
        <Pagination meta={feed.meta} onPage={setPage} />
      </AsyncContent>
    </Card>
  );
}

function Sessions() {
  const { can } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const list = useAsync(() => api.get('/admin/admin-sessions', { page, pageSize: 50 }), [page]);
  const confirmAction = useConfirm();
  const end = async (id) => {
    if (!(await confirmAction({ type: 'end_admin_session' }))) return;
    try {
      await api.del(`/admin/admin-sessions/${id}`);
      toast.success('Session signed out');
      list.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Card flush title="Active admin sessions">
      <AsyncContent loading={list.loading} error={list.error} onRetry={list.reload}>
        <DataTable rows={list.data || []} empty={<p className="card-body muted">No active sessions.</p>}
          columns={[
            { key: 'a', label: 'Admin', render: (s) => s.admin?.name || '—' },
            { key: 'd', label: 'Device', render: (s) => s.device },
            { key: 'ip', label: 'Network', render: (s) => s.approximateIp || '—' },
            { key: 'm', label: 'Second factor', render: (s) => s.mfaMethod.replace('_', ' ') },
            { key: 's', label: 'Signed in', render: (s) => formatDateTime(s.createdAt) },
            { key: 'l', label: 'Last active', render: (s) => formatDateTime(s.lastActiveAt) },
            { key: 'e', label: 'Expires', render: (s) => formatDateTime(s.expiresAt) },
            { key: 'x', label: '', render: (s) => (can('admins.manage') ? <Button size="sm" variant="ghost" onClick={() => end(s.id)}>Sign out</Button> : null) },
          ]} />
        <Pagination meta={list.meta} onPage={setPage} />
      </AsyncContent>
    </Card>
  );
}

export default function AdminSecurity() {
  const { can } = useAuth();
  const tabs = [
    can('security.events.read', 'audit.read') && { value: 'activity', label: 'Activity' },
    can('admins.read') && { value: 'sessions', label: 'Sessions' },
  ].filter(Boolean);
  const [tab, setTab] = useState(tabs[0]?.value);
  return (
    <div className="stack-lg">
      <PageHeader title="Admin security" subtitle="Administrator sign-ins, sessions, permission changes, configuration changes and sensitive access" />
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}
      {tab === 'activity' && <Activity />}
      {tab === 'sessions' && <Sessions />}
    </div>
  );
}
