import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HandCoins, UsersRound } from 'lucide-react';
import { Alert, Button, ErrorState, KeyValue, Loader } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { commissionLabel, FREQUENCY_LABEL, formatDate, naira } from '../../utils/format.js';

export default function InviteLanding() {
  const { token } = useParams();
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [pending, setPending] = useState(null);
  const signedIn = status === 'authenticated' && user?.emailVerified;
  const invite = useAsync(() => (signedIn ? api.get(`/invites/${token}`) : Promise.resolve(null)), [token, signedIn]);

  if (status === 'loading') return <Loader />;
  if (!signedIn) {
    const next = `/invite/${token}`;
    return (
      <div className="stack">
        <h1>You have been invited</h1>
        <p className="muted">Sign in or create a free account to review this invitation. Use the email or phone number the invitation was sent to.</p>
        <Button to="/login" state={{ from: { pathname: next } }} block>
          Sign in to continue
        </Button>
        <Button to="/register" state={{ next }} variant="secondary" block>
          Create an account
        </Button>
      </div>
    );
  }
  if (invite.loading) return <Loader label="Loading invitation..." />;
  if (invite.error) return <ErrorState error={invite.error} title="This invitation cannot be used" />;

  const data = invite.data;
  const act = async (action) => {
    setPending(action);
    try {
      const { data: result } = await api.post(`/invites/${token}/${action}`);
      if (action === 'accept') {
        toast.success(result.status === 'pending_approval' ? 'Request sent to the organiser' : 'Invitation accepted');
        navigate(result.kind === 'osusu_group' ? `/app/osusu/${result.groupId}` : `/app/collector/plans/${result.planId}`, { replace: true });
      } else {
        toast.info('Invitation declined');
        navigate('/app', { replace: true });
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="stack">
      {data.kind === 'osusu_group' ? (
        <>
          <div className="row">
            <UsersRound /> <h1>Join {data.group.name}</h1>
          </div>
          <p className="muted">{data.group.organiser} invited you to this Osusu group.</p>
          <KeyValue
            items={[
              ['Contribution', naira(data.group.contributionAmount)],
              ['Frequency', FREQUENCY_LABEL[data.group.frequency]],
              ['Group size', `Up to ${data.group.maxMembers} members`],
              ['Starts', formatDate(data.group.startDate)],
            ]}
          />
          <Alert tone="info">
            By joining you agree to contribute every cycle until every member has received their payout — including after you receive
            yours.
          </Alert>
        </>
      ) : (
        <>
          <div className="row">
            <HandCoins /> <h1>Save with {data.collector.businessName}</h1>
          </div>
          <p className="muted">{data.collector.name} invited you to a savings plan.</p>
          <KeyValue
            items={[
              ['Plan', data.terms.planName],
              ['Frequency', FREQUENCY_LABEL[data.terms.frequency]],
              data.terms.expectedAmount && ['Suggested amount', naira(data.terms.expectedAmount)],
              ['Term', `${formatDate(data.terms.startDate)} – ${formatDate(data.terms.endDate)}`],
              ['Collector commission', commissionLabel(data.terms.commissionType, data.terms.commissionValue)],
            ]}
          />
          <Alert tone="info">Your savings are due back to you at the end of the term, minus the commission shown above.</Alert>
        </>
      )}
      <p className="xsmall muted">Invitation expires {formatDate(data.expiresAt)}.</p>
      <div className="row">
        <Button variant="secondary" onClick={() => act('decline')} loading={pending === 'decline'} disabled={Boolean(pending)}>
          Decline
        </Button>
        <Button className="grow" onClick={() => act('accept')} loading={pending === 'accept'} disabled={Boolean(pending)}>
          Accept invitation
        </Button>
      </div>
      <Link to="/app" className="small">
        Go to dashboard
      </Link>
    </div>
  );
}
