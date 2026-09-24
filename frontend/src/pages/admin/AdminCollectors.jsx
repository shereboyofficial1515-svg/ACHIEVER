import { useState } from 'react';
import { Button, KeyValue, Loader, Modal, PageHeader, StatusBadge } from '../../components/ui/index.js';
import ReasonDialog from '../../components/domain/ReasonDialog.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { commissionLabel, formatDate, formatDateTime, naira } from '../../utils/format.js';
import { AdminTable } from './adminShared.jsx';

const STATUSES = ['pending_review', 'verified', 'active', 'restricted', 'suspended', 'revoked', 'rejected'];

// Allowed next steps per status; revocation goes through the two-person Approvals queue.
const TRANSITIONS = {
  pending_review: [['verified', 'Mark verified', 'collectors.review'], ['active', 'Approve', 'collectors.review'], ['rejected', 'Reject', 'collectors.review']],
  verified: [['active', 'Approve', 'collectors.review'], ['rejected', 'Reject', 'collectors.review']],
  active: [['restricted', 'Restrict', 'collectors.status'], ['suspended', 'Suspend', 'collectors.status']],
  restricted: [['active', 'Reinstate', 'collectors.status'], ['suspended', 'Suspend', 'collectors.status']],
  suspended: [['active', 'Reinstate', 'collectors.status']],
};

function TrustDetail({ id, onClose }) {
  const trust = useAsync(() => api.get(`/admin/collectors/${id}`), [id]);
  const t = trust.data;
  return (
    <Modal open onClose={onClose} title="Collector trust profile" wide>
      {trust.loading ? <Loader /> : t && (
        <div className="stack">
          <KeyValue
            items={[
              ['Business', t.businessName],
              ['Status', <StatusBadge key="s" status={t.status} />],
              ['Applied', formatDate(t.applicationDate)],
              ['Approved', formatDate(t.approvedAt)],
              ['Savers managed', t.membersManaged],
              ['Plans (all time)', t.plansTotal],
              ['Total collected', naira(t.totalProcessed)],
              ['Total settled to savers', naira(t.totalSettled)],
              ['Outstanding (held for savers)', naira(t.outstandingSettlements)],
              ['Overdue settlements', t.overdueSettlements],
              ['Complaints (all time)', t.complaints],
              ['Open disputes', t.openDisputes],
              ['Times restricted/suspended', t.suspensions],
            ]}
          />
          <strong className="small">Status history</strong>
          <ul className="list">
            {(t.statusHistory || []).map((h, i) => (
              <li key={i} className="list-item small">
                {formatDateTime(h.at)} · {h.from ? `${h.from.replace('_', ' ')} → ` : ''}{h.to.replace('_', ' ')} · {h.by || 'System'} · {h.reason}
              </li>
            ))}
            {!t.statusHistory?.length && <li className="list-item small muted">No changes yet.</li>}
          </ul>
        </div>
      )}
    </Modal>
  );
}

export default function AdminCollectors() {
  const { can } = useAuth();
  const toast = useToast();
  const [change, setChange] = useState(null); // { account, status, label, reload }
  const [detail, setDetail] = useState(null);

  return (
    <div className="stack-lg">
      <PageHeader title="Collectors" subtitle="Applications, approval and status. Collectors can accept savers only once approved and active." />
      <AdminTable
        endpoint="/admin/collectors"
        filters={[
          { name: 'search', label: 'Search business name' },
          { name: 'status', label: 'All statuses', initial: can('collectors.review') ? 'pending_review' : '', options: STATUSES },
        ]}
        onRowClick={can('collectors.review', 'collectors.status') ? (a) => setDetail(a.id) : undefined}
        columns={(reload) => [
          { key: 'b', label: 'Business', render: (a) => a.businessName },
          { key: 'c', label: 'Collector', render: (a) => `${a.collector?.name} · ${a.collector?.email}` },
          { key: 'a', label: 'Area', render: (a) => a.operatingArea || '—' },
          { key: 'm', label: 'Default commission', render: (a) => commissionLabel(a.defaultCommissionType, a.defaultCommissionValue) },
          { key: 's', label: 'Status', render: (a) => <StatusBadge status={a.status} /> },
          { key: 'd', label: 'Applied', render: (a) => formatDate(a.createdAt) },
          {
            key: 'x',
            label: '',
            render: (a) => (
              <div className="row-wrap" onClick={(e) => e.stopPropagation()}>
                {(TRANSITIONS[a.status] || []).filter(([, , perm]) => can(perm)).map(([status, label]) => (
                  <Button key={status} size="sm" variant={['rejected', 'suspended', 'restricted'].includes(status) ? 'ghost' : 'secondary'} onClick={() => setChange({ account: a, status, label, reload })}>
                    {label}
                  </Button>
                ))}
              </div>
            ),
          },
        ]}
      />
      <ReasonDialog
        open={Boolean(change)}
        title={change ? `${change.label}: ${change.account.businessName}` : ''}
        description="The reason is shown to the collector, recorded in the collector's status history and the audit log."
        confirmLabel={change?.label}
        onClose={() => setChange(null)}
        onSubmit={async (reason) => {
          await api.patch(`/admin/collectors/${change.account.id}/status`, { status: change.status, reason });
          toast.success('Collector status updated');
          change.reload();
          setChange(null);
        }}
      />
      {detail && <TrustDetail id={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
