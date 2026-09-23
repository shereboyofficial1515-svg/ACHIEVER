import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, ConfirmDialog, ErrorState, Input, KeyValue, Loader, PageHeader, Select, StatusBadge } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDateTime } from '../../utils/format.js';

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN', 'OSUSU_ADMIN', 'OSUSU_MEMBER', 'COLLECTOR', 'SAVER'];

export default function AdminUserDetail() {
  const { id } = useParams();
  const { isFinanceStaff, has } = useAuth();
  const toast = useToast();
  const user = useAsync(() => api.get(`/admin/users/${id}`), [id]);
  const [statusAction, setStatusAction] = useState(null);
  const [reason, setReason] = useState('');
  const [role, setRole] = useState('');
  const [pending, setPending] = useState(false);

  const changeStatus = async () => {
    setPending(true);
    try {
      await api.patch(`/admin/users/${id}/status`, { status: statusAction, reason: reason || null });
      toast.success('Status updated');
      setStatusAction(null);
      setReason('');
      user.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  const grant = async () => {
    try {
      await api.post(`/admin/users/${id}/roles`, { role });
      toast.success('Role granted');
      setRole('');
      user.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  const revoke = async (r) => {
    try {
      await api.del(`/admin/users/${id}/roles/${r}`);
      toast.success('Role removed');
      user.reload();
    } catch (err) {
      toast.error(err);
    }
  };

  if (user.loading && !user.data) return <Loader />;
  if (user.error) return <ErrorState error={user.error} onRetry={user.reload} />;
  const u = user.data;
  const grantable = ROLES.filter((r) => !u.roles.includes(r) && (has('SUPER_ADMIN') || !['SUPER_ADMIN', 'ADMIN', 'SUPPORT_ADMIN'].includes(r)));
  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/admin/users', label: 'Users' }} title={u.fullName} subtitle={u.email} />
      <div className="grid-2">
        <Card title="Account">
          <KeyValue
            items={[
              ['Status', <StatusBadge key="s" status={u.status} />],
              u.statusReason && ['Status reason', u.statusReason],
              ['Phone', u.phone],
              ['Email verified', u.emailVerified ? 'Yes' : 'No'],
              ['Phone verified', u.phoneVerified ? 'Yes' : 'No'],
              ['Identity', u.identity ? <span key="i">{u.identity.idType.toUpperCase()} ••{u.identity.last4} · <StatusBadge status={u.identity.status} /></span> : 'Not submitted'],
              ['Group memberships', u.groupMemberships],
              ['Savings plans', u.savingsPlans],
              ['Open review cases', u.openRiskFlags.length],
              ['Last sign-in', formatDateTime(u.lastLoginAt)],
              ['Joined', formatDateTime(u.createdAt)],
            ]}
          />
          {isFinanceStaff && (
            <div className="row-wrap" style={{ marginTop: 16 }}>
              {u.status !== 'suspended' && <Button variant="danger" size="sm" onClick={() => setStatusAction('suspended')}>Suspend</Button>}
              {u.status !== 'active' && <Button variant="success" size="sm" onClick={() => setStatusAction('active')}>Reactivate</Button>}
              {u.status !== 'closed' && <Button variant="ghost" size="sm" onClick={() => setStatusAction('closed')}>Close account</Button>}
            </div>
          )}
        </Card>
        <Card title="Roles">
          <div className="stack">
            <ul className="list">
              {u.roles.map((r) => (
                <li key={r} className="list-item" style={{ padding: '8px 0' }}>
                  <span className="grow">{r}</span>
                  {isFinanceStaff && (
                    <Button size="sm" variant="ghost" onClick={() => revoke(r)}>
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {isFinanceStaff && grantable.length > 0 && (
              <div className="row-wrap">
                <Select className="grow" placeholder="Grant a role" value={role} onChange={(e) => setRole(e.target.value)} options={grantable.map((r) => ({ value: r, label: r }))} aria-label="Role" />
                <Button onClick={grant} disabled={!role} style={{ alignSelf: 'flex-end' }}>
                  Grant
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>
      <ConfirmDialog
        open={Boolean(statusAction)}
        onClose={() => setStatusAction(null)}
        onConfirm={changeStatus}
        pending={pending}
        tone={statusAction === 'active' ? 'success' : 'danger'}
        title={`Set account to ${statusAction}?`}
        message={statusAction !== 'active' ? 'All of this user’s sessions will be signed out immediately. This action is audited.' : 'The user will be able to sign in again.'}
      >
        <Input label="Reason (recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
