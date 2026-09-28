import { useParams } from 'react-router-dom';
import { AsyncContent, Card, DataTable, ErrorState, KeyValue, Loader, PageHeader, StatusBadge } from '../components/ui/index.js';
import { useAsync } from '../hooks/useAsync.js';
import { api } from '../services/api.js';
import { formatDate, formatDateTime, naira } from '../utils/format.js';

/** Read-only oversight of an Osusu group. Staff never act inside a group from here. */
export default function GroupView() {
  const { groupId } = useParams();
  const g = useAsync(() => api.get(`/admin/osusu/groups/${groupId}`), [groupId]);
  const members = useAsync(() => api.get(`/admin/osusu/groups/${groupId}/members`), [groupId]);
  const cycles = useAsync(() => api.get(`/admin/osusu/groups/${groupId}/cycles`), [groupId]);
  const payouts = useAsync(() => api.get(`/admin/osusu/groups/${groupId}/payouts`), [groupId]);
  if (g.loading && !g.data) return <Loader />;
  if (g.error) return <ErrorState error={g.error} onRetry={g.reload} />;
  const d = g.data;
  return (
    <div className="stack-lg">
      <PageHeader back={{ to: '/groups', label: 'Osusu groups' }} title={d.name} subtitle={`Organiser: ${d.admin?.name || '—'} · read-only view`} />
      <div className="grid-2">
        <Card title="Group">
          <KeyValue items={[
            ['Status', <StatusBadge key="s" status={d.status} />],
            ['Contribution', `${naira(d.contributionAmount)} ${d.frequency}`],
            ['Members (max)', d.maxMembers],
            ['Cycle', `${d.currentCycle ?? 0} of ${d.totalCycles ?? '—'}`],
            ['Payout order', d.payoutOrderMethod],
            ['Grace period', `${d.gracePeriodDays} day(s)`],
            ['Start date', formatDate(d.startDate)],
            ['Created', formatDateTime(d.createdAt)],
          ]} />
        </Card>
        {d.summary && (
          <Card title="Money summary">
            <KeyValue items={Object.entries(d.summary).map(([k, v]) => [k.replace(/_/g, ' '), typeof v === 'number' && /amount|total|kobo|paid|collected/i.test(k) ? naira(v) : String(v ?? '—')])} />
          </Card>
        )}
      </div>
      <Card flush title="Members">
        <AsyncContent loading={members.loading} error={members.error} onRetry={members.reload}>
          <DataTable rows={members.data || []} columns={[
            { key: 'n', label: 'Member', render: (m) => m.name },
            { key: 's', label: 'Status', render: (m) => <StatusBadge status={m.status} /> },
            { key: 'p', label: 'Payout position', render: (m) => m.payoutPosition ?? '—' },
            { key: 'r', label: 'Received payout', render: (m) => (m.hasReceivedPayout ? `Yes (cycle ${m.payoutReceivedCycle})` : 'No') },
            { key: 'k', label: 'Risk', render: (m) => (m.riskStatus ? <StatusBadge status={m.riskStatus} /> : '—') },
            { key: 'j', label: 'Joined', render: (m) => formatDate(m.joinedAt) },
          ]} />
        </AsyncContent>
      </Card>
      <div className="grid-2">
        <Card flush title="Cycles">
          <AsyncContent loading={cycles.loading} error={cycles.error} onRetry={cycles.reload}>
            <DataTable rows={cycles.data || []} empty={<p className="card-body muted">No cycles yet.</p>} columns={[
              { key: 'c', label: 'Cycle', render: (c) => c.cycleNumber ?? c.number },
              { key: 'd', label: 'Due', render: (c) => formatDate(c.dueDate) },
              { key: 's', label: 'Status', render: (c) => <StatusBadge status={c.status} /> },
            ]} />
          </AsyncContent>
        </Card>
        <Card flush title="Payouts">
          <AsyncContent loading={payouts.loading} error={payouts.error} onRetry={payouts.reload}>
            <DataTable rows={payouts.data || []} empty={<p className="card-body muted">No payouts yet.</p>} columns={[
              { key: 'c', label: 'Cycle', render: (p) => p.cycleNumber ?? '—' },
              { key: 'r', label: 'Recipient', render: (p) => p.recipient?.name || p.recipientName || '—' },
              { key: 'a', label: 'Amount', render: (p) => naira(p.amount) },
              { key: 's', label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
            ]} />
          </AsyncContent>
        </Card>
      </div>
    </div>
  );
}
