import { useState } from 'react';
import PullToRefresh, { reloadAll } from '../../components/PullToRefresh.jsx';
import { Link } from 'react-router-dom';
import { CalendarClock, KeyRound, Plus, Search, Users, UsersRound } from 'lucide-react';
import { AsyncContent, Button, EmptyState, ErrorState, GroupAvatar, PageHeader, Pagination, ProgressBar, Skeleton, StatusBadge, Tabs } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { api } from '../../services/api.js';
import { FREQUENCY_LABEL, naira } from '../../utils/format.js';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'recruiting', label: 'Recruiting' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** One group's terms at a glance: contribution, frequency, capacity, cycle progress and the member's place. */
export function GroupCard({ g }) {
  const started = ['active', 'completed'].includes(g.status) && g.totalCycles > 0;
  const done = g.status === 'completed' ? g.totalCycles : Math.max(0, (g.currentCycle || 1) - 1);
  return (
    <Link to={`/app/osusu/${g.id}`} className="group-card">
      <div className="group-card-head">
        <GroupAvatar name={g.name} src={g.imageUrl} size="medium" />
        <div className="grow">
          <p className="group-card-name">{g.name}</p>
          <p className="xsmall muted truncate">{g.isAdmin ? 'You organise this group' : g.admin?.name ? `Organised by ${g.admin.name}` : 'Osusu group'}</p>
        </div>
        <StatusBadge status={g.status} />
      </div>
      <div className="group-card-terms">
        <div>
          <span className="eyebrow">Contribution</span>
          <p className="group-card-amount">{naira(g.contributionAmount)}</p>
          <span className="xsmall muted">{FREQUENCY_LABEL[g.frequency] || g.frequency}</span>
        </div>
        <div>
          <span className="eyebrow">Members</span>
          <p className="group-card-figure"><Users size={14} aria-hidden /> Up to {g.maxMembers}</p>
          {g.myPosition ? <span className="xsmall muted">Your payout position: {g.myPosition}</span> : <span className="xsmall muted">{g.status === 'recruiting' ? 'Payout order set at start' : ' '}</span>}
        </div>
      </div>
      {started ? (
        <div className="group-card-progress">
          <div className="row-between xsmall">
            <span className="muted">{g.status === 'completed' ? 'All cycles completed' : `Cycle ${g.currentCycle} of ${g.totalCycles}`}</span>
            <span className="muted">{done}/{g.totalCycles} paid out</span>
          </div>
          <ProgressBar value={done} max={g.totalCycles} label={`${g.name} cycle progress`} />
        </div>
      ) : (
        <p className="group-card-foot xsmall muted">
          <CalendarClock size={14} aria-hidden />
          {g.status === 'recruiting' ? 'Contributions begin when the organiser starts the group' : 'This group did not start'}
        </p>
      )}
      {g.myStatus === 'pending_approval' && <StatusBadge status="pending_approval" />}
    </Link>
  );
}

function GroupCardSkeleton() {
  return (
    <div className="group-grid" aria-busy="true" aria-label="Loading groups">
      {[0, 1, 2].map((i) => (
        <div key={i} className="group-card" style={{ pointerEvents: 'none' }}>
          <div className="row"><Skeleton width={44} height={44} style={{ borderRadius: '50%' }} /><div className="grow stack-sm"><Skeleton width="60%" height={14} /><Skeleton width="40%" height={10} /></div></div>
          <Skeleton height={48} />
          <Skeleton height={8} />
        </div>
      ))}
    </div>
  );
}

export default function GroupsList() {
  const { has } = useAuth();
  const [scope, setScope] = useState('mine');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounce(search);
  const groups = useAsync(() => api.get('/osusu/groups', { scope, status, search: q, page, pageSize: 20 }), [scope, status, q, page], { cacheKey: `groups:${scope}:${status}:${q}:${page}` });
  const filtered = Boolean(status || q);

  return (
    <PullToRefresh onRefresh={() => reloadAll(groups)}>
    <div className="stack-lg">
      <PageHeader
        title="Osusu groups"
        subtitle="Rotational savings: every member contributes each cycle and one member receives the pool, in a fixed order."
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
      <div className="toolbar">
        {has('OSUSU_ADMIN') && (
          <Tabs value={scope} onChange={(v) => { setScope(v); setPage(1); }} tabs={[{ value: 'mine', label: 'All my groups' }, { value: 'admin', label: 'Organised by me' }]} />
        )}
        <div className="toolbar-row">
          <label className="search-field">
            <Search size={16} aria-hidden />
            <input className="input" type="search" placeholder="Search groups" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search groups" />
          </label>
          <div className="segmented" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((f) => (
              <button key={f.value} type="button" aria-pressed={status === f.value} onClick={() => { setStatus(f.value); setPage(1); }}>{f.label}</button>
            ))}
          </div>
        </div>
      </div>
      {groups.error && !groups.data ? <div className="card"><ErrorState error={groups.error} onRetry={groups.reload} /></div> : (
        <AsyncContent
          loading={groups.loading}
          empty={!groups.data?.length}
          skeleton={<GroupCardSkeleton />}
          emptyState={
            <div className="card">
              {filtered ? (
                <EmptyState icon={Search} title="No groups match" message="Try a different search or status." action={<Button variant="secondary" onClick={() => { setSearch(''); setStatus(''); }}>Clear filters</Button>} />
              ) : (
                <EmptyState
                  icon={UsersRound}
                  title="No groups yet"
                  message={has('OSUSU_ADMIN') ? 'Create a group and invite members, or join one with a code.' : 'Ask your organiser for an invitation or a group code.'}
                  action={<Button to="/app/osusu/join" variant="secondary" icon={KeyRound}>Join with code</Button>}
                />
              )}
            </div>
          }
        >
          <div className="group-grid">
            {groups.data?.map((g) => <GroupCard key={g.id} g={g} />)}
          </div>
          {groups.meta?.totalPages > 1 && <div className="card"><Pagination meta={groups.meta} onPage={setPage} /></div>}
        </AsyncContent>
      )}
    </div>
    </PullToRefresh>
  );
}
