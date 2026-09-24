import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Eye, LogOut } from 'lucide-react';
import {
  Alert, Button, Card, ConfirmDialog, ErrorState, Input, KeyValue, Loader, PageHeader, Select, StatusBadge, Textarea,
} from '../../components/ui/index.js';
import ReasonDialog from '../../components/domain/ReasonDialog.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDateTime } from '../../utils/format.js';

const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'COMPLIANCE_ADMIN', 'FINANCE_ADMIN', 'DISPUTE_ADMIN', 'SECURITY_ADMIN', 'SUPPORT_ADMIN', 'AUDITOR', 'READ_ONLY_ADMIN'];
const MEMBER_ROLES = ['OSUSU_ADMIN', 'OSUSU_MEMBER', 'COLLECTOR', 'SAVER'];

function Sensitive({ userId }) {
  const [asking, setAsking] = useState(false);
  const [data, setData] = useState(null);
  if (!data) {
    return (
      <>
        <Button size="sm" variant="secondary" icon={Eye} onClick={() => setAsking(true)}>Reveal private details</Button>
        <ReasonDialog
          open={asking}
          title="Reveal private details"
          description="Contact details, date of birth and address are private. Your reason is written to the data access log before anything is shown."
          confirmLabel="Reveal"
          onClose={() => setAsking(false)}
          onSubmit={async (reason) => {
            const res = await api.get(`/admin/users/${userId}/sensitive`, { reason });
            setData(res.data);
            setAsking(false);
          }}
        />
      </>
    );
  }
  return (
    <KeyValue
      items={[
        ['Legal name', [data.firstName, data.middleName, data.lastName].filter(Boolean).join(' ') || '—'],
        ['Email', data.email],
        ['Phone', data.phone],
        ['Date of birth', data.dateOfBirth],
        ['Gender', data.gender?.replace(/_/g, ' ')],
        ['Nationality', data.nationality],
        ['Address', [data.addressUnit, data.address, data.city, data.lga, data.state, data.postalCode].filter(Boolean).join(', ') || '—'],
        ['Address verification', data.addressVerification],
      ]}
    />
  );
}

function Risk({ userId }) {
  const toast = useToast();
  const risk = useAsync(() => api.get(`/admin/risk-profiles/${userId}`), [userId]);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  if (risk.loading) return <Loader />;
  if (risk.error) return <ErrorState error={risk.error} onRetry={risk.reload} />;
  const r = risk.data;
  const save = async () => {
    setPending(true);
    try {
      await api.put(`/admin/risk-profiles/${userId}`, { status, reason });
      toast.success('Risk status updated');
      setStatus('');
      setReason('');
      risk.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Card title="Risk review">
      <div className="stack">
        <div className="row-between">
          <StatusBadge status={r.riskStatus} />
          {r.lastReviewedAt && <span className="xsmall muted">Reviewed {formatDateTime(r.lastReviewedAt)}</span>}
        </div>
        {r.restrictionReason && <p className="small">Reason: {r.restrictionReason}</p>}
        <strong className="small">Factors</strong>
        {r.factors.length ? (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {r.factors.map((f) => <li key={f.code}>{f.label}</li>)}
          </ul>
        ) : <p className="small muted">No risk factors present.</p>}
        {r.riskStatus === 'restricted' ? (
          <Alert tone="info">Lifting a restriction needs a second authorised person. Create an “Lift an account restriction” request in Approvals.</Alert>
        ) : (
          <div className="stack-sm">
            <Select placeholder="Change status" value={status} onChange={(e) => setStatus(e.target.value)} options={['normal', 'review_required', 'restricted'].filter((s) => s !== r.riskStatus).map((s) => ({ value: s, label: s.replace('_', ' ') }))} aria-label="Risk status" />
            <Textarea label="Reason (shared neutrally with the user if restricted)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div>
              <Button size="sm" onClick={save} loading={pending} disabled={!status || reason.trim().length < 10}>Save</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function SecurityPanel({ userId }) {
  const toast = useToast();
  const { can } = useAuth();
  const sec = useAsync(() => api.get(`/admin/users/${userId}/security`), [userId]);
  const [revoking, setRevoking] = useState(false);
  if (sec.loading) return <Loader />;
  if (sec.error) return <ErrorState error={sec.error} onRetry={sec.reload} />;
  const s = sec.data;
  return (
    <Card title="Sessions & account changes" actions={can('security.events.manage') && <Button size="sm" variant="danger" icon={LogOut} onClick={() => setRevoking(true)}>Sign out everywhere</Button>}>
      <div className="stack">
        <strong className="small">Active sessions ({s.sessions.length})</strong>
        <ul className="list">
          {s.sessions.map((x) => (
            <li key={x.id} className="list-item small">{x.device} · {x.approximateIp || 'IP unknown'} · last active {formatDateTime(x.lastActiveAt)}</li>
          ))}
        </ul>
        <strong className="small">Account change history</strong>
        <ul className="list">
          {s.accountChanges.slice(0, 20).map((c) => (
            <li key={c.id} className="list-item small">
              {formatDateTime(c.created_at)} · {c.event_type.replace(/_/g, ' ')}{c.new_ref ? ` → ${c.new_ref}` : ''}{c.reason ? ` (${c.reason})` : ''}
            </li>
          ))}
          {!s.accountChanges.length && <li className="list-item small muted">No changes recorded.</li>}
        </ul>
        <strong className="small">Security events</strong>
        <ul className="list">
          {s.securityEvents.slice(0, 20).map((e) => (
            <li key={e.id} className="list-item small">{formatDateTime(e.created_at)} · {e.description} · <StatusBadge status={e.status} /></li>
          ))}
          {!s.securityEvents.length && <li className="list-item small muted">None.</li>}
        </ul>
      </div>
      <ReasonDialog
        open={revoking}
        title="Sign this user out everywhere"
        description="All of this user's sessions end immediately. The user is notified via their security activity."
        confirmLabel="Sign out"
        onClose={() => setRevoking(false)}
        onSubmit={async (reason) => {
          const { data } = await api.post(`/admin/users/${userId}/sessions/revoke`, { reason });
          toast.success(`${data.revoked} session(s) signed out`);
          setRevoking(false);
          sec.reload();
        }}
      />
    </Card>
  );
}

export default function AdminUserDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const user = useAsync(() => api.get(`/admin/users/${id}`), [id]);
  const [statusAction, setStatusAction] = useState(null);
  const [reason, setReason] = useState('');
  const [role, setRole] = useState('');
  const [pending, setPending] = useState(false);

  const changeStatus = async () => {
    setPending(true);
    try {
      await api.patch(`/admin/users/${id}/status`, { status: statusAction, reason });
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
  const manageRoles = can('users.manage_status', 'roles.manage');
  const grantable = [...MEMBER_ROLES, ...(can('roles.manage') ? STAFF_ROLES : [])].filter((r) => !u.roles.includes(r));
  const removable = (r) => (STAFF_ROLES.includes(r) ? can('roles.manage') : manageRoles);
  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/app/admin/users', label: 'Users' }} title={u.fullName} subtitle={u.email} />
      <div className="grid-2">
        <Card title="Account">
          <KeyValue
            items={[
              ['Status', <StatusBadge key="s" status={u.status} />],
              u.statusReason && ['Status reason', u.statusReason],
              u.deactivatedAt && ['Deactivated', formatDateTime(u.deactivatedAt)],
              ['Phone', u.phone],
              ['Email verified', u.emailVerified ? 'Yes' : 'No'],
              ['Phone verified', u.phoneVerified ? 'Yes' : 'No'],
              ['KYC', <span key="k">Level {u.kyc.level} · <StatusBadge status={u.kyc.restricted ? 'restricted' : u.kyc.status} /></span>],
              ['Identity', u.identity ? <span key="i">{u.identity.idType.replace('_', ' ')} ••{u.identity.last4} · <StatusBadge status={u.identity.status} /></span> : 'Not submitted'],
              ['Risk status', <StatusBadge key="r" status={u.riskStatus} />],
              ['Group memberships', u.groupMemberships],
              ['Savings plans', u.savingsPlans],
              ['Open review cases', u.openRiskFlags.length],
              ['Last sign-in', formatDateTime(u.lastLoginAt)],
              ['Joined', formatDateTime(u.createdAt)],
            ]}
          />
          {can('users.manage_status') && (
            <div className="row-wrap" style={{ marginTop: 16 }}>
              {u.status !== 'suspended' && <Button variant="danger" size="sm" onClick={() => setStatusAction('suspended')}>Suspend</Button>}
              {u.status !== 'active' && <Button variant="success" size="sm" onClick={() => setStatusAction('active')}>Reactivate</Button>}
              {u.status !== 'closed' && <Button variant="ghost" size="sm" onClick={() => setStatusAction('closed')}>Close account</Button>}
            </div>
          )}
        </Card>
        <div className="stack">
          {u.canViewSensitive && (
            <Card title="Private details">
              <Sensitive userId={id} />
            </Card>
          )}
          <Card title="Roles">
            <div className="stack">
              <ul className="list">
                {u.roles.map((r) => (
                  <li key={r} className="list-item" style={{ padding: '8px 0' }}>
                    <span className="grow">{r}</span>
                    {removable(r) && <Button size="sm" variant="ghost" onClick={() => revoke(r)}>Remove</Button>}
                  </li>
                ))}
              </ul>
              {manageRoles && grantable.length > 0 && (
                <div className="row-wrap">
                  <Select className="grow" placeholder="Grant a role" value={role} onChange={(e) => setRole(e.target.value)} options={grantable.map((r) => ({ value: r, label: r }))} aria-label="Role" />
                  <Button onClick={grant} disabled={!role} style={{ alignSelf: 'flex-end' }}>Grant</Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
      <div className="grid-2">
        {can('risk.review') && <Risk userId={id} />}
        {can('security.events.read') && <SecurityPanel userId={id} />}
      </div>
      <ConfirmDialog
        open={Boolean(statusAction)}
        onClose={() => setStatusAction(null)}
        onConfirm={changeStatus}
        pending={pending}
        tone={statusAction === 'active' ? 'success' : 'danger'}
        title={`Set account to ${statusAction}?`}
        message={statusAction !== 'active' ? 'All of this user’s sessions will be signed out immediately. Financial records are kept. This action is audited.' : 'The user will be able to sign in again.'}
      >
        <Input label="Reason (required, recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
