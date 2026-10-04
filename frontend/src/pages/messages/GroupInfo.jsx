import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, BellOff, CalendarDays, ChevronRight, FileText, Flag, LogOut, Pin, Search, Settings, ShieldCheck, UsersRound, Wallet,
} from 'lucide-react';
import { Card, ErrorState, GroupAvatar, Skeleton, UserAvatar } from '../../components/ui/index.js';
import { ProfileListItem, ProfileSection } from '../../components/domain/ProfileParts.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useRealtimeEvent } from '../../contexts/RealtimeContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useConfirm } from '../../components/ui/ConfirmProvider.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDate, naira, titleCase } from '../../utils/format.js';

const STATUS_TONE = { active: 'success', recruiting: 'info', completed: 'neutral', cancelled: 'danger' };

function InfoSkeleton() {
  return (
    <div className="stack-lg info-page" aria-busy="true" aria-label="Loading group info">
      <div className="identity-card"><Skeleton height={104} width={104} style={{ borderRadius: '50%' }} /><Skeleton height={22} width={220} /><Skeleton height={14} width={160} /></div>
      <Skeleton height={160} />
    </div>
  );
}

/** Group Info: a full page (not a modal) opened from the chat header. */
export default function GroupInfo() {
  const { conversationId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const confirmAction = useConfirm();
  const conv = useAsync(() => api.get(`/messages/conversations/${conversationId}`), [conversationId], { cacheKey: `conversation:${conversationId}` });
  const [q, setQ] = useState('');
  useRealtimeEvent('conversation.updated', (e) => { if (e.conversationId === conversationId) conv.reload(); });

  useEffect(() => {
    if (location.hash === '#members' && conv.data) document.getElementById('members')?.scrollIntoView({ block: 'start' });
  }, [location.hash, conv.data]);

  const c = conv.data;
  const members = useMemo(() => {
    if (!c) return [];
    const term = q.trim().toLowerCase();
    return [...c.members]
      .filter((m) => !term || m.name?.toLowerCase().includes(term))
      .sort((a, b) => (Number(b.role === 'admin') - Number(a.role === 'admin')) || (Number(b.online) - Number(a.online)) || (a.name || '').localeCompare(b.name || ''));
  }, [c, q]);

  const leave = async () => {
    if (!c?.groupId) return;
    if (!(await confirmAction({ severity: 'danger', title: 'Leave this group?', message: 'Leaving an OSUSU group affects contributions and payouts. Groups that have started may not allow you to leave until the cycle ends.', confirmLabel: 'Leave group' }))) return;
    try {
      await api.post(`/osusu/groups/${c.groupId}/leave`);
      toast.success('You left the group');
      navigate('/app/messages', { replace: true });
    } catch (err) {
      toast.error(err);
    }
  };
  const report = async () => {
    if (!(await confirmAction({ severity: 'warning', title: 'Report this group?', message: 'ACHIEVER support will review the group chat.', confirmLabel: 'Report' }))) return;
    try {
      const { data } = await api.post(`/messages/conversations/${conversationId}/report`, { reason: 'Reported from Group info.' });
      toast.success(`Report sent (${data.reference})`);
    } catch (err) {
      toast.error(err);
    }
  };

  if (conv.loading && !c) return <InfoSkeleton />;
  if (conv.error && !c) return <ErrorState error={conv.error} onRetry={conv.reload} />;
  if (!c) return null;
  const perms = c.permissions || {};
  const g = c.group;
  const isGroup = c.type === 'group';
  const counts = `${c.memberCount} member${c.memberCount === 1 ? '' : 's'}${perms.canSeeOnline ? ` · ${c.onlineCount} online` : ''}`;
  const adminName = g ? c.members.find((m) => m.id === g.adminId)?.name : null;

  return (
    <div className="stack-lg info-page">
      <header className="info-topbar">
        <button type="button" className="icon-button" onClick={() => navigate(`/app/messages/${conversationId}`)} aria-label="Back to chat"><ArrowLeft size={20} /></button>
        <h1 className="grow info-topbar-title">{isGroup ? 'Group info' : 'Chat info'}</h1>
        {perms.canManageSettings && <Link to={`/app/messages/${conversationId}/settings`} className="icon-button" aria-label="Group settings"><Settings size={19} /></Link>}
      </header>

      {/* Identity: the avatar is a fixed square box, so the name and counts can never be covered. */}
      <section className="identity-card" aria-labelledby="group-name">
        <GroupAvatar name={c.title} src={g?.imageUrl} size="profile" eager label={`${c.title} picture`} />
        <div className="identity-text">
          <h2 id="group-name" className="identity-name">{c.title}</h2>
          <p className="identity-meta">{isGroup ? 'Group' : 'Chat'} · {counts}</p>
          <div className="identity-badges">
            {g?.status && <span className={`badge badge-${STATUS_TONE[g.status] || 'neutral'}`}>{titleCase(g.status)}</span>}
            {c.me?.mutedUntil && <span className="badge badge-neutral"><BellOff size={12} aria-hidden /> Muted</span>}
            {perms.isAdmin && <span className="badge badge-success"><ShieldCheck size={12} aria-hidden /> You are the admin</span>}
          </div>
          {c.description && <p className="identity-description">{c.description}</p>}
        </div>
      </section>

      {g && (
        <ProfileSection title="OSUSU group">
          <dl className="fact-grid">
            <div><dt><Wallet size={15} aria-hidden /> Contribution</dt><dd>{naira(g.contributionAmount)} · {titleCase(g.frequency || '')}</dd></div>
            <div><dt>Status</dt><dd>{titleCase(g.status || '')}</dd></div>
            <div><dt><CalendarDays size={15} aria-hidden /> Created</dt><dd>{formatDate(g.createdAt)}</dd></div>
            <div><dt><ShieldCheck size={15} aria-hidden /> Admin</dt><dd>{adminName || 'Group admin'}</dd></div>
          </dl>
          <ProfileListItem to={`/app/osusu/${g.id}`} icon={UsersRound} title="Open group details, cycles and payouts" />
        </ProfileSection>
      )}

      <ProfileSection>
        <ProfileListItem to={`/app/messages/${conversationId}/media`} icon={FileText} title="Media, links & files" />
        <ProfileListItem to={`/app/messages/${conversationId}?search=1`} icon={Search} title="Search messages" />
        <ProfileListItem to="/app/settings/notifications" icon={BellOff} title="Notification settings" />
        <ProfileListItem to={`${location.pathname}#members`} icon={UsersRound} title="Members" detail={String(c.memberCount)} onClick={() => document.getElementById('members')?.scrollIntoView({ behavior: 'smooth' })} />
        {perms.canManageSettings && <ProfileListItem to={`/app/messages/${conversationId}/settings`} icon={Settings} title="Group settings" />}
      </ProfileSection>

      {g?.rules && (
        <ProfileSection title="Group rules">
          <p className="info-rules">{g.rules}</p>
        </ProfileSection>
      )}

      {c.pinned?.length > 0 && (
        <ProfileSection title={`Pinned messages (${c.pinned.length})`}>
          <ul className="info-list">
            {c.pinned.map((p) => (
              <li key={p.messageId}>
                <Pin size={15} aria-hidden />
                <span className="grow truncate">{p.body || 'Attachment'}</span>
                <span className="xsmall muted nowrap">{formatDate(p.createdAt)}</span>
              </li>
            ))}
          </ul>
        </ProfileSection>
      )}

      <Card title={<span id="members">{counts}</span>}>
        {!perms.canSeeMembers && <p className="xsmall muted">The group admin has limited the member list to admins.</p>}
        {c.members.length > 6 && (
          <input className="input" type="search" placeholder="Search members" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search members" style={{ marginBottom: 8 }} />
        )}
        <ul className="info-members">
          {members.map((m) => {
            const self = m.id === user.id;
            const content = (
              <>
                <UserAvatar name={m.name} src={m.avatarUrl} online={m.online} size={40} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="truncate" style={{ display: 'block', fontWeight: 600 }}>{self ? 'You' : m.name}</span>
                  <span className="xsmall muted">{m.online ? 'Online' : ''}</span>
                </span>
                {m.role === 'admin' && <span className="badge badge-success"><ShieldCheck size={12} aria-hidden /> Admin</span>}
              </>
            );
            return (
              <li key={m.id}>
                {self ? <div className="info-member">{content}</div> : <Link className="info-member" to={`/app/contacts/${m.id}?chat=${conversationId}`}>{content}</Link>}
              </li>
            );
          })}
        </ul>
      </Card>

      <ProfileSection title="Danger zone">
        {c.groupId && !perms.isAdmin && <ProfileListItem as="button" danger icon={LogOut} title="Leave group" onClick={leave} />}
        <ProfileListItem as="button" danger icon={Flag} title="Report group" onClick={report} />
        {perms.isAdmin && <p className="xsmall muted section-note">As the admin you manage the group from Group settings. Cancelling a group that has not started is done on the group page.</p>}
      </ProfileSection>
    </div>
  );
}
