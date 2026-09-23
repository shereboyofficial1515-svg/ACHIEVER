import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Plus, UsersRound } from 'lucide-react';
import { AsyncContent, Button, Card, EmptyState, PageHeader, Pagination, SkeletonList, StatusBadge, Tabs } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { api } from '../../services/api.js';
import { FREQUENCY_LABEL, naira } from '../../utils/format.js';

export default function GroupsList() {
  const { has } = useAuth();
  const navigate = useNavigate();
  const [scope, setScope] = useState('mine');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounce(search);
  const groups = useAsync(() => api.get('/osusu/groups', { scope, status, search: q, page, pageSize: 20 }), [scope, status, q, page]);

  return (
    <div className="stack-lg">
      <PageHeader
        title="Osusu groups"
        subtitle="Rotational savings groups you belong to or organise"
        actions={
          <>
            <Button to="/app/osusu/join" variant="secondary" icon={KeyRound}>
              Join with code
            </Button>
            {has('OSUSU_ADMIN') && (
              <Button to="/app/osusu/new" icon={Plus}>
                Create group
              </Button>
            )}
          </>
        }
      />
      <Card flush>
        {has('OSUSU_ADMIN') && (
          <div style={{ padding: '0 16px' }}>
            <Tabs value={scope} onChange={(v) => { setScope(v); setPage(1); }} tabs={[{ value: 'mine', label: 'All my groups' }, { value: 'admin', label: 'Organised by me' }]} />
          </div>
        )}
        <div className="filters">
          <input className="input" type="search" placeholder="Search groups" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search groups" />
          <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            <option value="">All statuses</option>
            <option value="recruiting">Recruiting</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <AsyncContent
          loading={groups.loading}
          error={groups.error}
          onRetry={groups.reload}
          empty={!groups.data?.length}
          skeleton={<SkeletonList />}
          emptyState={
            <EmptyState
              icon={UsersRound}
              title="No groups yet"
              message={has('OSUSU_ADMIN') ? 'Create a group and invite members, or join one with a code.' : 'Ask your organiser for an invitation or a group code.'}
              action={<Button to="/app/osusu/join" variant="secondary">Join with code</Button>}
            />
          }
        >
          <ul className="list">
            {groups.data?.map((g) => (
              <li key={g.id} className="list-item clickable" onClick={() => navigate(`/app/osusu/${g.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/app/osusu/${g.id}`)}>
                <span className="list-icon">
                  {g.imageUrl ? <img src={g.imageUrl} alt="" style={{ width: 38, height: 38, borderRadius: 10, objectFit: 'cover' }} /> : <UsersRound size={18} />}
                </span>
                <div className="grow">
                  <p style={{ fontWeight: 600 }} className="truncate">
                    {g.name}
                  </p>
                  <p className="xsmall muted">
                    {naira(g.contributionAmount)} · {FREQUENCY_LABEL[g.frequency]}
                    {g.status === 'active' ? ` · cycle ${g.currentCycle} of ${g.totalCycles}` : ''}
                    {g.myPosition ? ` · your position ${g.myPosition}` : ''}
                  </p>
                </div>
                <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
                  <StatusBadge status={g.status} />
                  {g.isAdmin ? <span className="chip">Organiser</span> : g.myStatus === 'pending_approval' ? <StatusBadge status="pending_approval" /> : null}
                </div>
              </li>
            ))}
          </ul>
          <Pagination meta={groups.meta} onPage={setPage} />
        </AsyncContent>
      </Card>
    </div>
  );
}
