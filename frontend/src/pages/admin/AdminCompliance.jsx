import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BadgeCheck, Banknote, Eye, FileWarning, HandCoins, KeyRound, LifeBuoy, ShieldAlert, Stamp, UserX } from 'lucide-react';
import { AsyncContent, Button, Modal, PageHeader, Select, SkeletonCards, StatCard, StatusBadge, Tabs, Textarea } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDateTime } from '../../utils/format.js';
import { AdminTable } from './adminShared.jsx';

const EVENT_STATUSES = ['flagged', 'review_required', 'suspicious_activity', 'account_security_review', 'resolved', 'dismissed'];

function EventReview({ event, onClose, onSaved }) {
  const toast = useToast();
  const [status, setStatus] = useState(event.status);
  const [resolution, setResolution] = useState(event.resolution || '');
  const [pending, setPending] = useState(false);
  const save = async () => {
    setPending(true);
    try {
      await api.patch(`/admin/security/events/${event.id}`, { status, resolution: resolution || undefined });
      toast.success('Security event updated');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Review security event" footer={<Button onClick={save} loading={pending}>Save</Button>}>
      <div className="stack">
        <p className="small"><strong>{event.event_type.replace(/_/g, ' ')}</strong> · {formatDateTime(event.created_at)}</p>
        <p className="small">{event.description}</p>
        <p className="xsmall muted">The observation itself cannot be changed; only its investigation status and notes.</p>
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={EVENT_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} />
        <Textarea label="Investigation notes" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} />
      </div>
    </Modal>
  );
}

export default function AdminCompliance() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const overview = useAsync(() => api.get('/admin/compliance/overview'), []);
  const tabs = [
    can('security.events.read') && { value: 'events', label: 'Security events' },
    can('kyc.review') && { value: 'kyc', label: 'KYC' },
    can('risk.review') && { value: 'risk', label: 'Risk reviews' },
  ].filter(Boolean);
  const [tab, setTab] = useState(tabs[0]?.value);
  const [reviewing, setReviewing] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const d = overview.data;

  return (
    <div className="stack-lg">
      <PageHeader title="Security & compliance" subtitle="Verification, security signals, reviews and sensitive-action queues. Wording stays neutral: flags are prompts for review, not findings." />
      <AsyncContent loading={overview.loading} error={overview.error} onRetry={overview.reload} skeleton={<SkeletonCards count={8} />}>
        {d && (
          <div className="grid-4">
            <StatCard icon={BadgeCheck} label="KYC awaiting review" value={d.kyc_pending} sub={`${d.kyc_failed} failed · ${d.kyc_expired} expired`} />
            <StatCard accent icon={ShieldAlert} label="Open security events" value={d.security_events_open} sub={`${d.security_events_high} high/critical`} />
            <StatCard icon={KeyRound} label="Account takeover alerts" value={d.account_takeover_alerts} />
            <StatCard icon={UserX} label="Accounts under review" value={d.risk_reviews} sub={`${d.risk_flags_open} open review cases`} />
            <StatCard icon={LifeBuoy} label="Open disputes" value={d.disputes_open} />
            <StatCard icon={HandCoins} label="Collector applications" value={d.collector_applications} />
            <StatCard icon={FileWarning} label="Payout account changes (7d)" value={d.payment_account_changes_7d} />
            <StatCard icon={Banknote} label="Held disbursements" value={d.held_disbursements} />
            <StatCard icon={Stamp} label="Approvals pending" value={<Link to="/app/admin/approvals">{d.approvals_pending}</Link>} />
            <StatCard icon={Eye} label="Sensitive data views (24h)" value={d.data_access_24h} />
          </div>
        )}
      </AsyncContent>

      {tabs.length > 0 && <Tabs value={tab} onChange={setTab} tabs={tabs} />}

      {tab === 'events' && (
        <AdminTable
          endpoint="/admin/security/events"
          reloadKey={reloadKey}
          filters={[
            { name: 'status', label: 'Any status', options: EVENT_STATUSES },
            { name: 'severity', label: 'Any severity', options: ['low', 'medium', 'high', 'critical'] },
          ]}
          onRowClick={can('security.events.manage') ? (e) => setReviewing(e) : undefined}
          columns={[
            { key: 't', label: 'Time', render: (e) => formatDateTime(e.created_at) },
            { key: 'u', label: 'User', render: (e) => (e.user ? <Link to={`/app/admin/users/${e.user.id}`} onClick={(ev) => ev.stopPropagation()}>{e.user.full_name}</Link> : '—') },
            { key: 'ty', label: 'Event', render: (e) => e.event_type.replace(/_/g, ' ') },
            { key: 'd', label: 'Description', render: (e) => <span className="small">{e.description}</span> },
            { key: 'sv', label: 'Severity', render: (e) => <StatusBadge status={e.severity} /> },
            { key: 'st', label: 'Status', render: (e) => <StatusBadge status={e.status} /> },
          ]}
        />
      )}

      {tab === 'kyc' && (
        <AdminTable
          endpoint="/admin/kyc"
          filters={[
            { name: 'status', label: 'Any status', options: ['not_started', 'pending', 'in_review', 'verified', 'failed', 'expired', 'requires_update', 'restricted'] },
            { name: 'level', label: 'Any level', options: [{ value: '0', label: 'Level 0' }, { value: '1', label: 'Level 1' }, { value: '2', label: 'Level 2' }, { value: '3', label: 'Level 3' }] },
          ]}
          onRowClick={(k) => navigate(`/app/admin/users/${k.user_id}`)}
          columns={[
            { key: 'u', label: 'User', render: (k) => k.user?.full_name },
            { key: 'l', label: 'Level', render: (k) => k.level },
            { key: 's', label: 'Status', render: (k) => <StatusBadge status={k.restricted ? 'restricted' : k.status} /> },
            { key: 'p', label: 'Provider', render: (k) => k.provider || '—' },
            { key: 'a', label: 'Attempts', render: (k) => k.attempt_count },
            { key: 'e', label: 'ID expires', render: (k) => k.expires_at || '—' },
            { key: 'up', label: 'Updated', render: (k) => formatDateTime(k.updated_at) },
          ]}
        />
      )}

      {tab === 'risk' && (
        <AdminTable
          endpoint="/admin/risk-profiles"
          filters={[{ name: 'riskStatus', label: 'Under review or restricted', options: ['review_required', 'restricted'] }]}
          onRowClick={(r) => navigate(`/app/admin/users/${r.user_id}`)}
          columns={[
            { key: 'u', label: 'User', render: (r) => r.user?.full_name },
            { key: 's', label: 'Status', render: (r) => <StatusBadge status={r.risk_status} /> },
            { key: 'r', label: 'Reason', render: (r) => <span className="small">{r.restriction_reason || r.review_notes || '—'}</span> },
            { key: 't', label: 'Reviewed', render: (r) => formatDateTime(r.last_reviewed_at) },
          ]}
        />
      )}

      {reviewing && (
        <EventReview
          event={reviewing}
          onClose={() => setReviewing(null)}
          onSaved={() => {
            setReviewing(null);
            setReloadKey((k) => k + 1);
            overview.reload();
          }}
        />
      )}
    </div>
  );
}
