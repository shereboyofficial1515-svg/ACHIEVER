import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BellOff, Megaphone, MessageSquare, Mic, PenSquare } from 'lucide-react';
import { AsyncContent, EmptyState, Modal, SkeletonList, UserAvatar } from '../../components/ui/index.js';
import ChatWindow from '../../components/domain/ChatWindow.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useRealtimeEvent } from '../../contexts/RealtimeContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { api } from '../../services/api.js';
import { relativeTime } from '../../utils/format.js';

function NewChatModal({ onClose, onOpen }) {
  const contacts = useAsync(() => api.get('/messages/contacts'), []);
  const toast = useToast();
  const start = async (id) => {
    try {
      const { data } = await api.post('/messages/conversations/direct', { userId: id });
      onOpen(data.id);
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Modal open onClose={onClose} title="New message">
      <AsyncContent loading={contacts.loading} error={contacts.error} onRetry={contacts.reload} empty={!contacts.data?.length} emptyState={<EmptyState title="No contacts yet" message="You can message people in your groups and savings plans." />}>
        <ul className="list">
          {contacts.data?.map((c) => (
            <li key={c.id} className="list-item clickable" onClick={() => start(c.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && start(c.id)}>
              <UserAvatar name={c.name} src={c.avatarUrl} online={c.online} />
              <span className="grow">{c.name}</span>
            </li>
          ))}
        </ul>
      </AsyncContent>
    </Modal>
  );
}

export default function Messages() {
  const { conversationId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [composing, setComposing] = useState(false);
  const convs = useAsync(() => api.get('/messages/conversations'), []);

  useRealtimeEvent('message.new', (m) => {
    convs.setData(
      (convs.data || [])
        .map((c) =>
          c.id === m.conversationId
            ? { ...c, lastMessage: m.kind === 'attachment' ? (m.metadata?.voice ? 'Voice message' : m.body || 'Attachment') : m.body, lastMessageKind: m.kind, lastSenderId: m.senderId, lastMessageAt: m.createdAt, unreadCount: m.senderId !== user.id && m.conversationId !== conversationId ? c.unreadCount + 1 : c.unreadCount }
            : c,
        )
        .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt)),
    );
    if (!(convs.data || []).some((c) => c.id === m.conversationId)) convs.reload();
  });
  // Edits, deletes, mute and group changes: refresh the previews.
  useRealtimeEvent('message.updated', () => convs.reload());
  useRealtimeEvent('conversation.updated', () => convs.reload());

  const visible = useMemo(
    () => (convs.data || []).filter((c) => !filter || c.title?.toLowerCase().includes(filter.toLowerCase())),
    [convs.data, filter],
  );

  const open = (id) => {
    convs.setData((convs.data || []).map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
    navigate(`/app/messages/${id}`);
  };

  return (
    <div className={`messenger ${conversationId ? 'has-active' : ''}`}>
      <div className="conversations">
        <div className="conv-search row">
          <input className="input" type="search" placeholder="Search chats" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search conversations" />
          <button type="button" className="icon-button" onClick={() => setComposing(true)} aria-label="New message">
            <PenSquare size={19} />
          </button>
        </div>
        <AsyncContent
          loading={convs.loading}
          error={convs.error}
          onRetry={convs.reload}
          empty={!visible.length}
          skeleton={<SkeletonList rows={6} />}
          emptyState={<EmptyState icon={MessageSquare} title="No conversations yet" message="Group chats appear when you join a group. Savings plans have a chat with your collector." />}
        >
          {visible.map((c) => (
            <button key={c.id} type="button" className={`conv-item ${c.id === conversationId ? 'active' : ''}`} onClick={() => open(c.id)}>
              <UserAvatar name={c.title} src={c.otherUser?.avatarUrl || c.imageUrl} online={c.otherUser ? c.otherUser.online : undefined} size={42} />
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="row-between">
                  <strong className="truncate">{c.title}{c.mutedUntil && <BellOff size={13} className="muted conv-muted" aria-label="Muted" />}</strong>
                  <span className="xsmall muted nowrap">{relativeTime(c.lastMessageAt)}</span>
                </span>
                <span className="row-between">
                  <span className="preview truncate">
                    {c.lastMessageKind === 'announcement' && <Megaphone size={13} aria-label="Announcement" />}
                    {c.lastMessage === 'Voice message' && <Mic size={13} aria-hidden />}
                    {c.lastMessage && c.lastSenderId === user.id && c.lastMessageKind !== 'system' ? 'You: ' : ''}
                    {c.lastMessage || (c.type === 'group' ? `${c.memberCount} member${c.memberCount === 1 ? "" : "s"}` : 'Start the conversation')}
                  </span>
                  {c.unreadCount > 0 && <span className={`unread${c.mutedUntil ? ' is-muted' : ''}`}>{c.unreadCount}</span>}
                </span>
              </span>
            </button>
          ))}
        </AsyncContent>
      </div>
      {conversationId ? (
        <ChatWindow key={conversationId} conversationId={conversationId} currentUserId={user.id} onBack={() => navigate('/app/messages')} />
      ) : (
        <div className="chat-empty" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState icon={MessageSquare} title="Select a conversation" message="Messages are private to the members of each chat." />
        </div>
      )}
      {composing && <NewChatModal onClose={() => setComposing(false)} onOpen={(id) => { setComposing(false); convs.reload(); navigate(`/app/messages/${id}`); }} />}
    </div>
  );
}
