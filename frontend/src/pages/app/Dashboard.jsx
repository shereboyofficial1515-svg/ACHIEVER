import { useState } from 'react';
import PullToRefresh, { reloadAll } from '../../components/PullToRefresh.jsx';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeftRight, ArrowRight, BadgeCheck, CalendarClock, CheckCircle2, Eye, EyeOff, HandCoins, LogIn, PiggyBank, Plus,
  RefreshCw, ShieldAlert, TrendingUp, Users, UsersRound, Wallet, Zap,
} from 'lucide-react';
import { Alert, AsyncContent, Button, Card, EmptyState, Skeleton, StatCard, StatusBadge } from '../../components/ui/index.js';
import { TransactionList } from '../../components/domain/TransactionList.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { usePaymentReview } from '../../components/domain/usePaymentReview.js';
import { daysUntil, formatDate, naira } from '../../utils/format.js';
import { useReveal } from '../../hooks/useMotion.js';
import { balanceHidden, setBalanceHidden } from '../wallet/walletShared.js';

function dueLabel(date) {
  const d = daysUntil(date);
  if (d === null) return '';
  if (d < 0) return `${Math.abs(d)} day${d === -1 ? '' : 's'} overdue`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  return `Due in ${d} days`;
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-NG', { hour: 'numeric', hour12: false, timeZone: 'Africa/Lagos' }).format(new Date()));
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Wallet balance from GET /wallet (server-authoritative, never cached). Hidden with the same switch as the Wallet page. */
function WalletPanel({ wallet }) {
  const [hidden, setHidden] = useState(balanceHidden());
  const w = wallet.data;
  const toggle = () => { setBalanceHidden(!hidden); setHidden(!hidden); };
  const canTransfer = w && w.status === 'active' && w.enabled && (w.transfersEnabled || w.bankTransfersEnabled);
  return (
    <section className="balance-card" aria-label="ACHIEVER Wallet balance">
      <div className="balance-card-top">
        <span className="balance-card-label"><Wallet size={15} aria-hidden /> ACHIEVER Wallet</span>
        {w && (
          <button type="button" className="balance-eye" onClick={toggle} aria-label={hidden ? 'Show balance' : 'Hide balance'} aria-pressed={hidden}>
            {hidden ? <Eye size={17} aria-hidden /> : <EyeOff size={17} aria-hidden />}
          </button>
        )}
      </div>
      {wallet.loading && !w && (
        <div className="stack-sm" aria-busy="true" aria-label="Loading balance">
          <Skeleton width="30%" height={12} style={{ opacity: 0.35 }} />
          <Skeleton width="55%" height={34} style={{ opacity: 0.35 }} />
        </div>
      )}
      {wallet.error && !w && (
        <div className="balance-card-error" role="alert">
          <p>We could not load your wallet balance.</p>
          <button type="button" className="balance-chip" onClick={() => wallet.reload()}><RefreshCw size={14} aria-hidden /> Try again</button>
        </div>
      )}
      {w && (
        <>
          <div>
            <span className="balance-card-caption">Available balance</span>
            <p className="balance-card-amount" aria-live="polite">{hidden ? '₦ ••••••' : naira(w.available)}</p>
            {w.held > 0 && !hidden && <span className="balance-card-caption">{naira(w.held)} on hold for a transfer under review</span>}
          </div>
          {w.status !== 'active' && <p className="balance-card-note"><ShieldAlert size={14} aria-hidden /> {w.statusReason}</p>}
          {!w.enabled && <p className="balance-card-note">ACHIEVER Wallet is temporarily unavailable. Your balance is safe.</p>}
          <div className="balance-card-actions">
            <Link to="/app/wallet/add" className="balance-btn is-primary"><Plus size={17} aria-hidden /> Add money</Link>
            {canTransfer
              ? <Link to="/app/wallet/transfer" className="balance-btn"><ArrowLeftRight size={17} aria-hidden /> Transfer</Link>
              : <span className="balance-btn" aria-disabled="true"><ArrowLeftRight size={17} aria-hidden /> Transfer</span>}
            <Link to="/app/wallet" className="balance-btn is-icon" aria-label="Open wallet"><ArrowRight size={17} aria-hidden /></Link>
          </div>
          <span className="balance-card-id">Wallet ID <span className="mono">{w.walletId}</span></span>
        </>
      )}
    </section>
  );
}

/** The member's next required action: the earliest open contribution, or what comes next when nothing is due. */
function NextAction({ d, pay, paying, osusu }) {
  const due = d.member.nextDue;
  if (due) {
    const overdue = due.status === 'overdue';
    return (
      <section className={`next-card ${overdue ? 'is-overdue' : ''}`} aria-label="Next contribution">
        <div className="next-card-head">
          <span className="next-card-icon">{overdue ? <AlertTriangle size={18} aria-hidden /> : <CalendarClock size={18} aria-hidden />}</span>
          <div className="grow">
            <p className="eyebrow">{overdue ? 'Overdue contribution' : 'Next contribution'}</p>
            <Link to={`/app/osusu/${due.groupId}`} className="next-card-title">{due.groupName || 'Osusu group'}</Link>
          </div>
          <StatusBadge status={due.status} />
        </div>
        <p className="next-card-amount">{naira(due.amount)}</p>
        <p className="small muted">Cycle {due.cycleNumber} · {dueLabel(due.dueDate)} · {formatDate(due.dueDate)}</p>
        <Button block variant={overdue ? 'danger' : 'primary'} onClick={() => pay({ ...due, id: due.contributionId })} loading={paying === due.contributionId} loadingText="Opening secure checkout...">
          Pay contribution
        </Button>
      </section>
    );
  }
  const payout = d.member.upcomingPayout;
  return (
    <section className="next-card is-clear" aria-label="Contributions">
      <div className="next-card-head">
        <span className="next-card-icon is-ok"><CheckCircle2 size={18} aria-hidden /></span>
        <div className="grow">
          <p className="eyebrow">Contributions</p>
          <p className="next-card-title">You are all caught up</p>
        </div>
      </div>
      {payout ? (
        <>
          <p className="small muted">Your next scheduled payout</p>
          <p className="next-card-amount">{naira(payout.amount)}</p>
          <p className="small muted">{payout.groupName} · cycle {payout.cycleNumber}{payout.dueDate ? ` · expected ${formatDate(payout.dueDate)}` : ''}</p>
          <Button block variant="secondary" to={`/app/osusu/${payout.groupId}`}>View group</Button>
        </>
      ) : (
        <>
          <p className="small muted">No contribution is due right now. Payments you owe will appear here with their due dates.</p>
          {osusu && <Button block variant="secondary" to="/app/osusu" icon={UsersRound}>Browse your groups</Button>}
        </>
      )}
    </section>
  );
}

function QuickActions({ has, wallet }) {
  const w = wallet.data;
  const transferOff = w && !(w.status === 'active' && w.enabled && (w.transfersEnabled || w.bankTransfersEnabled));
  const osusu = has('OSUSU_MEMBER', 'OSUSU_ADMIN');
  const actions = [
    { to: '/app/wallet/add', label: 'Add money', icon: Plus },
    !transferOff && { to: '/app/wallet/transfer', label: 'Transfer', icon: ArrowLeftRight },
    { to: '/app/bills', label: 'Pay bills', icon: Zap },
    osusu && { to: '/app/osusu/join', label: 'Join a group', icon: LogIn },
    has('OSUSU_ADMIN') && { to: '/app/osusu/new', label: 'Create group', icon: UsersRound },
    has('COLLECTOR') && { to: '/app/collector', label: 'Collector desk', icon: HandCoins },
    has('SAVER') && { to: '/app/savings', label: 'My savings', icon: PiggyBank },
  ].filter(Boolean).slice(0, 6);
  return (
    <nav className="quick-actions" aria-label="Quick actions">
      {actions.map((a) => (
        <Link key={a.to} to={a.to} className="quick-action">
          <span className="quick-action-icon"><a.icon size={20} aria-hidden /></span>
          <span>{a.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export default function Dashboard() {
  const { user, has } = useAuth();
  const { review, activeId: paying } = usePaymentReview();
  const dash = useAsync(() => api.get('/users/me/dashboard'), [], { cacheKey: 'dashboard' });
  const wallet = useAsync(() => api.get('/wallet'), []);
  const cardsRef = useReveal({ children: true, deps: [Boolean(dash.data)] });

  const pay = (c) => review(
    { id: c.id, recipient: `${c.groupName || 'Your Osusu group'} (group pool)`, purpose: `Osusu contribution${c.cycleNumber ? `, cycle ${c.cycleNumber}` : ''}`, amount: c.amount },
    (idempotencyKey) => api.post(`/osusu/contributions/${c.id}/pay`, undefined, { idempotencyKey }),
  );

  const d = dash.data;
  const pendingOperator = d?.onboarding?.operators?.filter((o) => !o.active) || [];
  const osusu = has('OSUSU_MEMBER', 'OSUSU_ADMIN');
  const today = new Intl.DateTimeFormat('en-NG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Lagos' }).format(new Date());

  return (
    <PullToRefresh onRefresh={() => reloadAll(dash, wallet)}>
    <div className="stack-lg dashboard">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <p className="eyebrow">{today}</p>
          <h1 style={{ marginTop: 4 }}>{greeting()}, {user.fullName.split(' ')[0]}</h1>
          <p className="subtitle">Your savings, contributions and wallet at a glance.</p>
        </div>
        {has('OSUSU_ADMIN') && (
          <div className="row-wrap">
            <Button to="/app/osusu/new" icon={Plus} size="sm">New group</Button>
          </div>
        )}
      </div>

      {pendingOperator.length > 0 && (
        <Alert tone="warning" icon={BadgeCheck}>
          <strong>Finish operator verification.</strong> Verify your phone and identity and accept the undertaking before you can{' '}
          {pendingOperator.map((o) => (o.role === 'OSUSU_ADMIN' ? 'create Osusu groups' : 'accept savers')).join(' or ')}.{' '}
          <Link to="/app/onboarding">Continue verification</Link>
        </Alert>
      )}

      <div className="dash-hero">
        <WalletPanel wallet={wallet} />
        {d ? <NextAction d={d} pay={pay} paying={paying} osusu={osusu} /> : (
          <section className="next-card" aria-busy={dash.loading} aria-label="Next contribution">
            {dash.error ? <p className="small muted">Your contributions could not be loaded. Pull down or use “Try again” below.</p> : (
              <div className="stack-sm"><Skeleton width="40%" height={12} /><Skeleton width="65%" height={28} /><Skeleton width="80%" height={12} /><Skeleton height={44} /></div>
            )}
          </section>
        )}
      </div>

      <QuickActions has={has} wallet={wallet} />

      <AsyncContent loading={dash.loading && !d} error={dash.error} onRetry={dash.reload} skeleton={<Skeleton height={112} />}>
        {d && (
          <>
            <section className="card overview" aria-labelledby="overview-title">
              <header className="card-header">
                <h2 id="overview-title">Savings overview</h2>
                <span className="xsmall muted">Verified payments only</span>
              </header>
              <div className="overview-grid" ref={cardsRef}>
                <div className="overview-cell">
                  <span className="overview-label"><TrendingUp size={15} aria-hidden /> Total contributed</span>
                  <span className="overview-value">{naira(d.member.totalContributed)}</span>
                  <span className="overview-sub">Osusu contributions and collector savings</span>
                </div>
                <div className="overview-cell">
                  <span className="overview-label"><Wallet size={15} aria-hidden /> Received</span>
                  <span className="overview-value">{naira(d.member.totalReceived)}</span>
                  <span className="overview-sub">Payouts and returns paid to you</span>
                </div>
                <div className="overview-cell">
                  <span className="overview-label"><CalendarClock size={15} aria-hidden /> Next payout</span>
                  <span className="overview-value">{d.member.upcomingPayout ? naira(d.member.upcomingPayout.amount) : '—'}</span>
                  <span className="overview-sub">
                    {d.member.upcomingPayout
                      ? `${d.member.upcomingPayout.groupName} · cycle ${d.member.upcomingPayout.cycleNumber}${d.member.upcomingPayout.dueDate ? ` · ${formatDate(d.member.upcomingPayout.dueDate)}` : ''}`
                      : 'No payout scheduled'}
                  </span>
                </div>
                {osusu && (
                  <div className="overview-cell">
                    <span className="overview-label"><UsersRound size={15} aria-hidden /> Active groups</span>
                    <span className="overview-value">{d.member.activeGroups}</span>
                    <span className={`overview-sub ${d.member.overdueCount ? 'text-red' : ''}`}>
                      {d.member.overdueCount ? `${d.member.overdueCount} overdue contribution${d.member.overdueCount === 1 ? '' : 's'}` : 'All contributions up to date'}
                    </span>
                  </div>
                )}
                {has('SAVER') && (
                  <div className="overview-cell">
                    <span className="overview-label"><PiggyBank size={15} aria-hidden /> Savings balance</span>
                    <span className="overview-value">{naira(d.member.savingsBalance)}</span>
                    <span className="overview-sub">Held with your collectors</span>
                  </div>
                )}
              </div>
            </section>

            <div className="grid-2 dash-columns">
              <Card title="Open contributions" actions={osusu && <Button to="/app/osusu" variant="ghost" size="sm">My groups</Button>} flush>
                {d.member.openContributions.length === 0 ? (
                  <EmptyState icon={CheckCircle2} title="You are all caught up" message="No contributions are due right now." />
                ) : (
                  <ul className="list">
                    {d.member.openContributions.map((c) => (
                      <li key={c.id} className="contribution-card">
                        <span className={`list-icon ${c.status === 'overdue' ? 'is-danger' : ''}`}><CalendarClock size={18} aria-hidden /></span>
                        <div className="grow">
                          <Link to={`/app/osusu/${c.groupId}`} className="contribution-title">{c.groupName}</Link>
                          <p className={`xsmall ${c.status === 'overdue' ? 'text-red' : 'muted'}`}>
                            Cycle {c.cycleNumber} · {dueLabel(c.dueDate)}
                          </p>
                        </div>
                        <span className="money">{naira(c.amount)}</span>
                        <Button size="sm" variant={c.status === 'overdue' ? 'danger' : 'primary'} onClick={() => pay(c)} loading={paying === c.id}>
                          Pay
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Recent activity" actions={<Button to="/app/transactions" variant="ghost" size="sm">View all</Button>} flush>
                {d.recentTransactions.length === 0 ? (
                  <EmptyState title="No transactions yet" message="Verified payments, payouts and bill purchases will appear here." />
                ) : (
                  <TransactionList items={d.recentTransactions} />
                )}
              </Card>
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
                      <li key={g.id}>
                        <Link to={`/app/osusu/${g.id}`} className="list-item clickable list-link">
                          <span className="list-icon"><UsersRound size={18} aria-hidden /></span>
                          <div className="grow">
                            <p style={{ fontWeight: 600 }}>{g.name}</p>
                            <p className="xsmall muted">
                              {g.currentCycle
                                ? `Cycle ${g.currentCycle.cycle_number}: ${g.currentCycle.paid_count} paid, ${g.currentCycle.unpaid_count} unpaid · pays ${g.currentCycle.recipient_name}`
                                : 'Between cycles'}
                              {g.nextCycle ? ` · next: ${g.nextCycle.recipient_name}` : ''}
                            </p>
                          </div>
                          {g.overdue > 0 && <StatusBadge status="overdue" label={`${g.overdue} overdue`} />}
                        </Link>
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

            {d.member.plans.length > 0 && (
              <Card title="Savings plans" actions={<Button to="/app/savings" variant="ghost" size="sm">View all</Button>} flush>
                <ul className="list">
                  {d.member.plans.map((p) => (
                    <li key={p.id}>
                      <Link to={`/app/collector/plans/${p.id}`} className="list-item clickable list-link">
                        <span className="list-icon"><PiggyBank size={18} aria-hidden /></span>
                        <div className="grow">
                          <p style={{ fontWeight: 600 }}>{p.planName}</p>
                          <p className="xsmall muted">
                            {p.businessName}{p.status === 'active' ? ` · ${p.daysRemaining} days remaining` : ''}
                          </p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <p className="money">{naira(p.balance)}</p>
                          <StatusBadge status={p.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </AsyncContent>
    </div>
    </PullToRefresh>
  );
}
