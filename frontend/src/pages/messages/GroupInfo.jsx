import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BellOff, ChevronRight, FileText, Flag, LogOut, Pin, Settings, ShieldCheck, UsersRound } from 'lucide-react';
import { AsyncContent, Card, KeyValue, Loader, UserAvatar } from '../../components/ui/index.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useRealtimeEvent } from '../../contexts/RealtimeContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useConfirm } from '../../components/ui/ConfirmProvider.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { formatDate, naira, titleCase } from '../../utils/format.js';

/** Group Info: a full page (not a modal) opened from the chat header. */
export default function GroupInfo() {
  const { conversationId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const confirmAction = useConfirm();
  const conv = useAsync(() => api.get(`/messages/conversations/${conversationId}`), [conversationId]);
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

  if (conv.loading && !c) return <Loader label="Loading group info..." />;
  const perms = c?.permissions || {};
  const g = c?.group;
  return (
    <AsyncContent loading={false} error={conv.error} onRetry={conv.reload}>
      {c && (
        <div className="stack-lg info-page">
          <div className="info-topbar">
            <button type="button" className="icon-button" onClick={() => navigate(`/app/messages/${conversationId}`)} aria-label="Back to chat"><ArrowLeft size={20} /></button>
            <span className="grow">{c.type === 'group' ? 'Group info' : 'Chat info'}</span>
            {perms.canManageSettings && <Link to={`/app/messages/${conversationId}/settings`} className="icon-button" aria-label="Group settings"><Settings size={19} /></Link>}
          </div>

          <section className="profile-hero">
            <UserAvatar name={c.title} src={g?.imageUrl} size={104} />
            <h1 className="profile-name">{c.title}</h1>
            <p className="small muted">
              {c.type === 'group' ? 'Group' : 'Chat'} · {c.memberCount} members{perms.canSeeOnline ? ` · ${c.onlineCount} online` : ''}
            </p>
            {c.me?.mutedUntil && <span className="badge badge-neutral"><BellOff size={12} aria-hidden /> Muted</span>}
            {c.description && <p className="info-description">{c.description}</p>}
          </section>

          {g && (
            <Card title="OSUSU group">
              <KeyValue items={[
                ['Contribution', `${naira(g.contributionAmount)} · ${titleCase(g.frequency || '')}`],
                ['Status', titleCase(g.status || '')],
                ['Created', formatDate(g.createdAt)],
                ['Admin', c.members.find((m) => m.id === g.adminId)?.name || 'Group admin'],
              ]} />
              <Link to={`/app/osusu/${g.id}`} className="info-link">Open group details, cycles and payouts <ChevronRight size={16} aria-hidden /></Link>
            </Card>
          )}

          {g?.rules && (
            <Card title="Group rules">
              <p className="info-rules">{g.rules}</p>
            </Card>
          )}

          {c.pinned?.length > 0 && (
            <Card title={`Pinned messages (${c.pinned.length})`}>
              <ul className="info-list">
                {c.pinned.map((p) => (
                  <li key={p.messageId}>
                    <Pin size={15} aria-hidden />
                    <span className="grow truncate">{p.body || 'Attachment'}</span>
                    <span className="xsmall muted nowrap">{formatDate(p.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <div className="info-links">
              <Link to={`/app/messages/${conversationId}/media`}><FileText size={18} aria-hidden /> <span className="grow">Media, links & files</span><ChevronRight size={16} aria-hidden /></Link>
              <Link to="/app/settings/messages"><BellOff size={18} aria-hidden /> <span className="grow">Notification settings</span><ChevronRight size={16} aria-hidden /></Link>
              {perms.canManageSettings && <Link to={`/app/messages/${conversationId}/settings`}><Settings size={18} aria-hidden /> <span className="grow">Group settings</span><ChevronRight size={16} aria-hidden /></Link>}
            </div>
          </Card>

          <Card title={<span id="members"><UsersRound size={16} aria-hidden /> {c.memberCount} members</span>}>
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

          <Card title="Danger zone">
            <div className="info-links danger">
              {c.groupId && !perms.isAdmin && <button type="button" onClick={leave}><LogOut size={18} aria-hidden /> <span className="grow">Leave group</span></button>}
              <button type="button" onClick={report}><Flag size={18} aria-hidden /> <span className="grow">Report group</span></button>
            </div>
            {perms.isAdmin && <p className="xsmall muted">As the admin you manage the group from Group settings. Cancelling a group that has not started is done on the group page.</p>}
          </Card>
        </div>
      )}
    </AsyncContent>
  );
}
