import { Link } from 'react-router-dom';
import { Copy, Gift, RefreshCw, Share2, UserCheck, Users } from 'lucide-react';
import { Alert, AsyncContent, Button, Card, EmptyState, PageHeader, ProgressBar, StatCard } from '../../components/ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useSingleFlight } from '../../hooks/useSingleFlight.js';
import { api } from '../../services/api.js';
import { shareContent } from '../../platform/index.js';
import { formatDate, naira } from '../../utils/format.js';

const REFERRAL_STATUS = {
  REGISTERED: ['Joined — verification pending', 'neutral'],
  QUALIFYING: ['Qualifying', 'info'],
  QUALIFIED: ['Qualified', 'success'],
  DISQUALIFIED: ['Not eligible', 'neutral'],
};
const REWARD_STATUS = {
  ELIGIBLE: ['Ready for review', 'info'], UNDER_REVIEW: ['Under review', 'info'], APPROVED: ['Approved', 'success'],
  PAID: ['Paid', 'success'], REJECTED: ['Not approved', 'neutral'], REVERSED: ['Reversed', 'warning'],
  WAITING_FOR_BATCH: ['Counts toward your next reward', 'info'], NOT_QUALIFIED: ['Pending', 'neutral'],
};
const Badge = ({ map, value }) => {
  const [label, tone] = map[value] || [value, 'neutral'];
  return <span className={`badge badge-${tone}`}>{label}</span>;
};

/** Refer & Earn: code, sharing, progress and rewards. Nothing here is decided by the app; the server computes it. */
export default function Referrals() {
  const toast = useToast();
  const d = useAsync(() => api.get('/referrals/me'), []);
  const [run, refreshing] = useSingleFlight();
  const data = d.data;

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error('Could not copy');
    }
  };
  const share = async () => {
    const how = await shareContent({ title: 'Join me on ACHIEVER', text: `Save with your Ajo/Osusu group on ACHIEVER. Use my referral code ${data.code} when you sign up:`, url: data.link });
    if (how === 'copied') toast.success('Invitation copied');
  };
  const refresh = () => run(async () => {
    try {
      d.setData((await api.post('/referrals/me/refresh')).data);
    } catch (err) {
      toast.error(err);
    }
  });

  return (
    <div className="stack-lg">
      <PageHeader title="Refer & Earn" subtitle="Invite people you know. Earn a reward when your referrals become active ACHIEVER savers." />
      <AsyncContent loading={d.loading} error={d.error} onRetry={d.reload}>
        {data && (
          <>
            {!data.programme.enabled && <Alert tone="info">The referral programme is paused. Existing referrals still count under the terms that applied when they joined.</Alert>}
            <Card className="referral-hero">
              <div className="stack">
                <p className="small muted">Your referral code</p>
                <p className="referral-code mono">{data.code}</p>
                <div className="row-wrap">
                  <Button icon={Copy} variant="secondary" onClick={() => copy(data.code, 'Code')}>Copy code</Button>
                  <Button icon={Share2} onClick={share}>Share invitation link</Button>
                </div>
                <div className="stack-sm">
                  <ProgressBar value={data.stats.progressToNextReward} max={data.programme.requiredReferrals}
                    label={`${data.stats.progressToNextReward} of ${data.programme.requiredReferrals} qualifying referrals toward your next ${naira(data.programme.rewardAmount)} reward`} />
                  <p className="xsmall muted">
                    A referral qualifies after they verify their account{data.programme.osusuRequired ? ', join an Osusu group' : ''},
                    stay active for {Math.round(data.programme.qualificationDays / 7)} weeks and complete {data.programme.minActivities} qualifying activit{data.programme.minActivities === 1 ? 'y' : 'ies'}.
                    Registration alone does not qualify. <Link to="/referral-terms">Read the full terms</Link>.
                  </p>
                </div>
              </div>
            </Card>

            <div className="grid-4">
              <StatCard label="Registered" value={data.stats.registered} icon={Users} />
              <StatCard label="Verified" value={data.stats.verified} icon={UserCheck} />
              <StatCard label="Qualified" value={data.stats.qualified} icon={Gift} />
              <StatCard label="Still qualifying" value={data.stats.pending} />
            </div>
            <div className="grid-3">
              <StatCard label="Rewards awaiting review" value={naira(data.stats.pendingRewards)} />
              <StatCard label="Approved rewards" value={naira(data.stats.approvedRewards)} />
              <StatCard label="Paid rewards" value={naira(data.stats.paidRewards)} />
            </div>

            <Card title="People you referred" actions={<Button variant="ghost" icon={RefreshCw} onClick={refresh} loading={refreshing}>Update progress</Button>}>
              {data.referrals.length === 0 ? (
                <EmptyState icon={Users} title="No referrals yet" message="Share your code. You will see each person here as they progress." />
              ) : (
                <ul className="referral-list">
                  {data.referrals.map((r) => (
                    <li key={r.id} className="referral-item">
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <strong>{r.name}</strong>
                        <Badge map={REFERRAL_STATUS} value={r.status} />
                      </div>
                      <p className="xsmall muted">Joined {formatDate(r.joinedAt)} · {r.accountActive ? 'Account active' : 'Account not active'} · Osusu: {r.osusuActive ? 'Active' : 'Not yet'}</p>
                      <p className="xsmall">
                        Qualification: {Math.min(r.daysActive, r.requiredDays)}/{r.requiredDays} days · activities {Math.min(r.activities, r.requiredActivities)}/{r.requiredActivities}
                        {r.verified ? ' · verified' : ' · not yet verified'}
                      </p>
                      {r.underReview && <p className="xsmall muted">This referral is being reviewed before it can count. No action is needed from you.</p>}
                      {r.statusReason && !r.underReview && <p className="xsmall muted">{r.statusReason}</p>}
                      <p className="xsmall">Reward: <Badge map={REWARD_STATUS} value={r.rewardStatus} /></p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {data.rewards.length > 0 && (
              <Card title="Your rewards">
                <ul className="referral-list">
                  {data.rewards.map((w) => (
                    <li key={w.id} className="referral-item row" style={{ justifyContent: 'space-between' }}>
                      <span><strong>{naira(w.amount)}</strong> <span className="xsmall muted">· {formatDate(w.createdAt)}</span></span>
                      <Badge map={REWARD_STATUS} value={w.status} />
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
