import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Ban, Flag, MessageSquare, Phone, ShieldCheck, Video } from 'lucide-react';
import { Button, ErrorState, GroupAvatar, Loader, UserAvatar } from '../../components/ui/index.js';
import { ProfileListItem, ProfileSection, VerifiedBadge } from '../../components/domain/ProfileParts.jsx';
import { useConfirm } from '../../components/ui/ConfirmProvider.jsx';
import { useCalls } from '../../contexts/CallContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDate, relativeTime } from '../../utils/format.js';

const CHECKS = [['email', 'Email'], ['phone', 'Phone'], ['identity', 'ID'], ['paymentAccount', 'Payment account']];

/** Someone's public profile, opened from a chat header or a member list. Public fields only. */
export default function PersonProfile() {
  const { userId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const calls = useCalls();
  const confirmAction = useConfirm();
  const person = useAsync(() => api.get(`/messages/people/${userId}`), [userId], { cacheKey: `person:${userId}` });
  const chatFromUrl = params.get('chat');

  if (person.loading && !person.data) return <Loader label="Loading profile..." />;
  if (person.error) return <ErrorState error={person.error} onRetry={person.reload} />;
  const p = person.data;
  if (!p) return null;

  const openChat = async () => {
    try {
      const id = p.directConversationId || (await api.post('/messages/conversations/direct', { userId })).data.id;
      navigate(`/app/messages/${id}`);
    } catch (err) {
      toast.error(err);
    }
  };
  const call = async (type) => {
    try {
      const id = p.directConversationId || (await api.post('/messages/conversations/direct', { userId })).data.id;
      calls.startCall(id, type);
    } catch (err) {
      toast.error(err);
    }
  };
  const toggleBlock = async () => {
    const blocking = !p.blockedByMe;
    if (!(await confirmAction({
      severity: blocking ? 'danger' : 'warning',
      title: blocking ? `Block ${p.fullName}?` : `Unblock ${p.fullName}?`,
      message: blocking ? 'They will not be able to message or call you in a direct chat. Group chats are not affected.' : 'You will be able to message each other again.',
      confirmLabel: blocking ? 'Block' : 'Unblock',
    }))) return;
    try {
      await api.put(`/messages/people/${userId}/block`, { blocked: blocking });
      person.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  const report = async () => {
    const conv = chatFromUrl || p.directConversationId;
    if (!conv) { toast.error('Open a chat with this person to report them.'); return; }
    if (!(await confirmAction({ severity: 'warning', title: `Report ${p.fullName}?`, message: 'ACHIEVER support will review it. They are not told who reported them.', confirmLabel: 'Report' }))) return;
    try {
      const { data } = await api.post(`/messages/conversations/${conv}/report`, { reason: `Reported ${p.fullName} from their profile.` });
      toast.success(`Report sent (${data.reference})`);
    } catch (err) {
      toast.error(err);
    }
  };

  const status = p.online ? 'Online' : p.lastSeenAt ? `Last seen ${relativeTime(p.lastSeenAt)}` : '';
  const checks = CHECKS.filter(([k]) => p.verification?.[k]);
  return (
    <div className="stack-lg info-page">
      <header className="info-topbar">
        <button type="button" className="icon-button" onClick={() => (chatFromUrl ? navigate(`/app/messages/${chatFromUrl}`) : navigate(-1))} aria-label="Back"><ArrowLeft size={20} /></button>
        <h1 className="grow info-topbar-title">Profile</h1>
      </header>
      <section className="identity-card" aria-labelledby="person-name">
        <UserAvatar name={p.fullName} src={p.avatarUrl} online={p.online ?? undefined} size={104} eager label={`${p.fullName} profile photo`} />
        <div className="identity-text">
          <h2 id="person-name" className="identity-name">{p.fullName} <VerifiedBadge verified={Boolean(p.verification?.identity && p.verification?.email)} /></h2>
          {status && <p className="identity-meta">{status}</p>}
          <div className="identity-badges">
            {checks.map(([k, label]) => <span key={k} className="badge badge-success"><ShieldCheck size={12} aria-hidden /> {label} verified</span>)}
            {!p.active && <span className="badge badge-warning">Account inactive</span>}
          </div>
        </div>
        <div className="row-wrap profile-actions">
          <Button icon={MessageSquare} onClick={openChat} disabled={p.blockedByMe}>Message</Button>
          <Button variant="secondary" icon={Phone} onClick={() => call('voice')} disabled={p.blockedByMe || calls.inCall || calls.busy} aria-label="Voice call">Call</Button>
          <Button variant="secondary" icon={Video} onClick={() => call('video')} disabled={p.blockedByMe || calls.inCall || calls.busy} aria-label="Video call">Video</Button>
        </div>
      </section>

      <ProfileSection title="About">
        <dl className="fact-grid">
          <div><dt>Member since</dt><dd>{formatDate(p.memberSince)}</dd></div>
          <div><dt>Location</dt><dd>{p.location || 'Hidden'}</dd></div>
          <div><dt>Completed OSUSU groups</dt><dd>{p.completedGroups}</dd></div>
          <div><dt>Paid on time</dt><dd>{p.onTimeRate === null || p.onTimeRate === undefined ? '—' : `${p.onTimeRate}%`}</dd></div>
        </dl>
      </ProfileSection>

      {p.mutualGroups?.length > 0 && (
        <ProfileSection title={`Groups in common (${p.mutualGroups.length})`}>
          {p.mutualGroups.map((g) => (
            <Link key={g.id} to={`/app/osusu/${g.id}`} className="list-row">
              <GroupAvatar name={g.name} src={g.imageUrl} size="medium" />
              <span className="list-row-text"><span className="list-row-title">{g.name}</span></span>
            </Link>
          ))}
        </ProfileSection>
      )}

      <ProfileSection>
        <ProfileListItem as="button" danger icon={Ban} title={`${p.blockedByMe ? 'Unblock' : 'Block'} ${p.fullName}`} onClick={toggleBlock} />
        <ProfileListItem as="button" danger icon={Flag} title={`Report ${p.fullName}`} onClick={report} />
      </ProfileSection>
    </div>
  );
}
