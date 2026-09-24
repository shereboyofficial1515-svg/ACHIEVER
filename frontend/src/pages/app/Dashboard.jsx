import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, BadgeCheck, CalendarClock, HandCoins, PiggyBank, Plus, ShieldAlert, TrendingUp, Users, UsersRound, Wallet,
} from 'lucide-react';
import { Alert, AsyncContent, Button, Card, EmptyState, SkeletonCards, StatCard, StatusBadge } from '../../components/ui/index.js';
import { TransactionList } from '../../components/domain/TransactionList.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { daysUntil, formatDate, naira } from '../../utils/format.js';
import { useReveal } from '../../hooks/useMotion.js';

function dueLabel(date) {
  const d = daysUntil(date);
  if (d === null) return '';
  if (d < 0) return `${Math.abs(d)} day${d === -1 ? '' : 's'} overdue`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  return `Due in ${d} days`;
}

export default function Dashboard() {
  const { user, has, isStaff } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [paying, setPaying] = useState(null);
  const dash = useAsync(() => api.get('/users/me/dashboard'), []);
  const cardsRef = useReveal({ children: true, deps: [Boolean(dash.data)] });

  const pay = async (contributionId) => {
    setPaying(contributionId);
    try {
      const { data } = await api.post(`/osusu/contributions/${contributionId}/pay`);
      window.location.assign(data.authorizationUrl);
    } catch (err) {
      toast.error(err);
      setPaying(null);
    }
  };

  const d = dash.data;
  const pendingOperator = d?.onboarding?.operators?.filter((o) => !o.active) || [];

  return (
    <div className="stack-lg">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1>Hello, {user.fullName.split(' ')[0]}</h1>
          <p className="subtitle">Here is where your money stands today.</p>
        </div>
        <div className="row-wrap">
          {has('OSUSU_ADMIN') && (
            <Button to="/app/osusu/new" icon={Plus} size="sm">
              New group
            </Button>
          )}
          {isStaff && (
            <Button to="/app/admin" variant="secondary" size="sm">
              Admin console
            </Button>
          )}
        </div>
      </div>

      {pendingOperator.length > 0 && (
        <Alert tone="warning" icon={BadgeCheck}>
          <strong>Finish operator verification.</strong> Verify your phone and identity and accept the undertaking before you can{' '}
          {pendingOperator.map((o) => (o.role === 'OSUSU_ADMIN' ? 'create Osusu groups' : 'accept savers')).join(' or ')}.{' '}
          <Link to="/app/onboarding">Continue verification</Link>
        </Alert>
      )}

      <AsyncContent loading={dash.loading} error={dash.error} onRetry={dash.reload} skeleton={<SkeletonCards count={4} />}>
        {d && (
          <>
            {d.member.nextDue && (
              <div className={`due-card ${d.member.nextDue.status === 'overdue' ? 'overdue' : ''}`}>
                <div className="stack-sm">
                  <span className="row small muted">
                    {d.member.nextDue.status === 'overdue' ? <AlertTriangle size={16} color="var(--red-600)" /> : <CalendarClock size={16} />}
                    {d.member.nextDue.groupName} · Cycle {d.member.nextDue.cycleNumber}
                  </span>
                  <span className="amount">{naira(d.member.nextDue.amount)}</span>
                  <span className="row-wrap">
                    <StatusBadge status={d.member.nextDue.status} />
                    <span className="small muted">
                      {dueLabel(d.member.nextDue.dueDate)} · {formatDate(d.member.nextDue.dueDate)}
                    </span>
                  </span>
                </div>
                <Button variant="gold" onClick={() => pay(d.member.nextDue.contributionId)} loading={paying === d.member.nextDue.contributionId} loadingText="Opening secure checkout...">
                  Pay contribution
                </Button>
              </div>
            )}

            <div className="grid-4" ref={cardsRef}>
              <StatCard accent icon={TrendingUp} label="Total contributed" value={naira(d.member.totalContributed)} sub="All verified contributions and savings" />
              {has('SAVER') && <StatCard icon={PiggyBank} label="Savings balance" value={naira(d.member.savingsBalance)} sub="Held with collectors" />}
              <StatCard icon={Wallet} label="Received" value={naira(d.member.totalReceived)} sub="Payouts and returns paid to you" />
              <StatCard
                icon={CalendarClock}
                label="Upcoming payout"
                value={d.member.upcomingPayout ? naira(d.member.upcomingPayout.amount) : '—'}
                sub={d.member.upcomingPayout ? `${d.member.upcomingPayout.groupName} · cycle ${d.member.upcomingPayout.cycleNumber} · ${formatDate(d.member.upcomingPayout.dueDate)}` : 'No payout scheduled'}
              />
              {has('OSUSU_MEMBER') && <StatCard icon={UsersRound} label="Active groups" value={d.member.activeGroups} sub={d.member.overdueCount ? `${d.member.overdueCount} overdue contribution(s)` : 'All contributions up to date'} />}
            </div>

            {d.organiser && (
              <Card title="Groups you organise" actions={<Button to="/app/osusu" variant="ghost" size="sm">View all</Button>} flush>
                <div className="card-body">
                  <div className="grid-4">
                    <StatCard icon={Users} label="Members" value={d.organiser.totalMembers} />
                    <StatCard icon={Wallet} label="Expected this cycle" value={naira(d.organiser.expected)} />
                    <StatCard icon={TrendingUp} label="Collected" value={naira(d.organiser.collected)} />
                    <StatCard icon={ShieldAlert} label="Outstanding" value={naira(d.organiser.outstanding)} sub={`${d.organiser.membersUnderReview} member(s) under review`} />
                  </div>
                </div>
                {d.organiser.groupsSummary.length > 0 && (
                  <ul className="list">
                    {d.organiser.groupsSummary.map((g) => (
                      <li key={g.id} className="list-item clickable" onClick={() => navigate(`/app/osusu/${g.id}`)}>
                        <span className="list-icon">
                          <UsersRound size={18} />
                        </span>
                        <div className="grow">
                          <p style={{ fontWeight: 500 }}>{g.name}</p>
                          <p className="xsmall muted">
                            {g.currentCycle
                              ? `Cycle ${g.currentCycle.cycle_number}: ${g.currentCycle.paid_count} paid, ${g.currentCycle.unpaid_count} unpaid · pays ${g.currentCycle.recipient_name}`
                              : 'Between cycles'}
                            {g.nextCycle ? ` · next: ${g.nextCycle.recipient_name}` : ''}
                          </p>
                        </div>
                        {g.overdue > 0 && <StatusBadge status="overdue" label={`${g.overdue} overdue`} />}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            {d.collector && d.collector.account && (
              <Card title="Collector desk" actions={<Button to="/app/collector" variant="ghost" size="sm">Open</Button>}>
                <div className="grid-4">
                  <StatCard icon={Users} label="Savers" value={d.collector.totalSavers} />
                  <StatCard icon={HandCoins} label="Total held" value={naira(d.collector.totalHeld)} />
                  <StatCard icon={CalendarClock} label="Maturing (14 days)" value={d.collector.maturingSoon} sub={`${d.collector.matured} matured`} />
                  <StatCard icon={TrendingUp} label="Commission earned" value={naira(d.collector.commissionEarned)} sub={`${d.collector.pendingReturns} pending return(s)`} />
                </div>
              </Card>
            )}
            {d.collector && !d.collector.account && (
              <Alert tone="info" icon={HandCoins}>
                Set up your collector account to start inviting savers. <Link to="/app/collector">Open collector desk</Link>
              </Alert>
            )}

            <div className="grid-2">
              <Card title="Open contributions" flush>
                {d.member.openContributions.length === 0 ? (
                  <EmptyState title="You are all caught up" message="No contributions are due right now." />
                ) : (
                  <ul className="list">
                    {d.member.openContributions.map((c) => (
                      <li key={c.id} className="contribution-card">
                        <div className="grow">
                          <Link to={`/app/osusu/${c.groupId}`} style={{ fontWeight: 500 }}>
                            {c.groupName}
                          </Link>
                          <p className="xsmall muted">
                            Cycle {c.cycleNumber} · {dueLabel(c.dueDate)}
                          </p>
                        </div>
                        <span className="money">{naira(c.amount)}</span>
                        <Button size="sm" variant={c.status === 'overdue' ? 'danger' : 'primary'} onClick={() => pay(c.id)} loading={paying === c.id}>
                          Pay
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Recent transactions" actions={<Button to="/app/transactions" variant="ghost" size="sm">View all</Button>} flush>
                {d.recentTransactions.length === 0 ? (
                  <EmptyState title="No transactions yet" message="Verified payments, payouts and bill purchases will appear here." />
                ) : (
                  <TransactionList items={d.recentTransactions} />
                )}
              </Card>
            </div>

            {d.member.plans.length > 0 && (
              <Card title="Savings plans" actions={<Button to="/app/savings" variant="ghost" size="sm">View all</Button>} flush>
                <ul className="list">
                  {d.member.plans.map((p) => (
                    <li key={p.id} className="list-item clickable" onClick={() => navigate(`/app/collector/plans/${p.id}`)}>
                      <span className="list-icon">
                        <PiggyBank size={18} />
                      </span>
                      <div className="grow">
                        <p style={{ fontWeight: 500 }}>{p.planName}</p>
                        <p className="xsmall muted">
                          {p.businessName} · {p.status === 'active' ? `${p.daysRemaining} days remaining` : ''}
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p className="money">{naira(p.balance)}</p>
                        <StatusBadge status={p.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </AsyncContent>
    </div>
  );
}
