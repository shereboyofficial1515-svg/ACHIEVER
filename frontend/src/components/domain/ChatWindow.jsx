import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckCheck, FileText, Paperclip, Phone, SendHorizontal, Video } from 'lucide-react';
import { UserAvatar, ErrorState, Loader } from '../ui/index.js';
import { api } from '../../services/api.js';
import { useRealtimeEvent } from '../../contexts/RealtimeContext.jsx';
import { useCalls } from '../../contexts/CallContext.jsx';
import { usePreferences } from '../../contexts/PreferencesContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { fileSize, formatDate, formatTime } from '../../utils/format.js';

const MAX_FILE = 10 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

function Attachment({ a }) {
  const [url, setUrl] = useState(null);
  const isImage = a.mimeType.startsWith('image/');
  const toast = useToast();
  const { prefs } = usePreferences();
  const autoLoad = prefs.messages.autoLoadImages !== false; // Settings > Messages

  // Private files: fetch a short-lived signed URL only when needed.
  useEffect(() => {
    if (!isImage || !autoLoad) return;
    api.get(`/messages/attachments/${a.id}/url`).then(({ data }) => setUrl(data.url)).catch(() => {});
  }, [a.id, isImage, autoLoad]);

  const open = async () => {
    try {
      const { data } = await api.get(`/messages/attachments/${a.id}/url`);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <button type="button" className="attachment" onClick={open}>
      {isImage && url ? <img src={url} alt={a.fileName} loading="lazy" /> : <FileText size={20} aria-hidden />}
      {isImage && !url && !autoLoad && <span className="small">Photo · tap to open</span>}
      {!isImage && (
        <span>
          <span style={{ display: 'block', fontWeight: 600 }}>{a.fileName}</span>
          {fileSize(a.sizeBytes)}
        </span>
      )}
    </button>
  );
}

export default function ChatWindow({ conversationId, currentUserId, onBack }) {
  const [conv, setConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const stickToBottom = useRef(true);
  const fileRef = useRef(null);
  const calls = useCalls();
  const toast = useToast();

  const markRead = useCallback(() => api.post(`/messages/conversations/${conversationId}/read`).catch(() => {}), [conversationId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, m] = await Promise.all([
        api.get(`/messages/conversations/${conversationId}`),
        api.get(`/messages/conversations/${conversationId}/messages`, { limit: 40 }),
      ]);
      setConv(c.data);
      setMessages(m.data.messages);
      setHasMore(m.data.hasMore);
      stickToBottom.current = true;
      markRead();
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [conversationId, markRead]);

  useEffect(() => {
    load();
  }, [load]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const loadOlder = async () => {
    if (!messages.length || loadingMore) return;
    setLoadingMore(true);
    const el = listRef.current;
    const prevHeight = el.scrollHeight;
    try {
      const { data } = await api.get(`/messages/conversations/${conversationId}/messages`, { limit: 40, before: messages[0].createdAt });
      stickToBottom.current = false;
      setMessages((m) => [...data.messages, ...m]);
      setHasMore(data.hasMore);
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch (err) {
      toast.error(err);
    } finally {
      setLoadingMore(false);
    }
  };

  const onScroll = (e) => {
    const el = e.currentTarget;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && hasMore) loadOlder();
  };

  useRealtimeEvent('message.new', (m) => {
    if (m.conversationId !== conversationId) return;
    setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
    if (m.senderId !== currentUserId) markRead();
  });

  const append = (m) => {
    stickToBottom.current = true;
    setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
  };

  const send = async (e) => {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const { data } = await api.post(`/messages/conversations/${conversationId}/messages`, { body });
      setDraft('');
      append(data);
    } catch (err) {
      toast.error(err);
    } finally {
      setSending(false);
    }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE) {
      toast.error('Files must be 10 MB or smaller');
      return;
    }
    setSending(true);
    try {
      const { data } = await api.upload(`/messages/conversations/${conversationId}/attachments`, file, { caption: draft.trim() });
      setDraft('');
      append(data);
    } catch (err) {
      toast.error(err);
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Loader label="Loading messages..." />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  const byId = new Map(conv.members.map((m) => [m.id, m]));
  const other = conv.type !== 'group' ? conv.members.find((m) => m.id !== currentUserId) : null;
  const title = conv.type === 'group' ? conv.title : other?.name || conv.title;
  const subtitle = conv.type === 'group' ? `${conv.members.length} members` : other?.online ? 'Online' : 'Offline';
  const othersReadAt = conv.members.filter((m) => m.id !== currentUserId).map((m) => (m.lastReadAt ? new Date(m.lastReadAt).getTime() : 0));
  const readByAll = (createdAt) => othersReadAt.length > 0 && othersReadAt.every((t) => t >= new Date(createdAt).getTime());

  let lastDay = null;
  return (
    <div className="chat">
      <header className="chat-header">
        {onBack && (
          <button type="button" className="icon-button back-btn" onClick={onBack} aria-label="Back to conversations">
            <ArrowLeft size={20} />
          </button>
        )}
        <UserAvatar name={title} src={other?.avatarUrl} online={other ? other.online : undefined} size={38} />
        <div className="grow">
          <h2 className="truncate" style={{ fontSize: 15 }}>
            {title}
          </h2>
          <p>{subtitle}</p>
        </div>
        <button type="button" className="icon-button" onClick={() => calls.startCall(conversationId, 'voice')} disabled={calls.busy || calls.inCall} aria-label="Start voice call">
          <Phone size={19} />
        </button>
        <button type="button" className="icon-button" onClick={() => calls.startCall(conversationId, 'video')} disabled={calls.busy || calls.inCall} aria-label="Start video call">
          <Video size={20} />
        </button>
      </header>

      <div className="chat-messages" ref={listRef} onScroll={onScroll} aria-live="polite">
        {loadingMore && <span className="spinner" style={{ alignSelf: 'center' }} aria-label="Loading older messages" />}
        {!hasMore && messages.length > 0 && <span className="day-divider">Start of conversation</span>}
        {messages.length === 0 && (
          <div className="state">
            <p>No messages yet. Say hello.</p>
          </div>
        )}
        {messages.map((m) => {
          const day = formatDate(m.createdAt);
          const divider = day !== lastDay ? <span className="day-divider">{day}</span> : null;
          lastDay = day;
          if (m.kind === 'system' || m.kind === 'call') {
            return (
              <Fragment key={m.id}>
                {divider}
                <div className="msg system">
                  <div className="bubble">{m.body}</div>
                </div>
              </Fragment>
            );
          }
          const mine = m.senderId === currentUserId;
          const sender = byId.get(m.senderId);
          return (
            <Fragment key={m.id}>
              {divider}
              <div className={`msg ${mine ? 'mine' : 'theirs'}`}>
                {!mine && conv.type === 'group' && <span className="sender">{sender?.name || 'Former member'}</span>}
                <div className="bubble">
                  {m.attachments?.map((a) => (
                    <Attachment key={a.id} a={a} />
                  ))}
                  {m.body}
                </div>
                <span className="meta">
                  {formatTime(m.createdAt)}
                  {mine && (readByAll(m.createdAt) ? <CheckCheck size={14} aria-label="Read" /> : <Check size={14} aria-label="Sent" />)}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>

      <form className="chat-composer" onSubmit={send}>
        <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={onFile} />
        <button type="button" className="icon-button" onClick={() => fileRef.current?.click()} disabled={sending} aria-label="Attach a photo or PDF">
          <Paperclip size={20} />
        </button>
        <label className="sr-only" htmlFor="composer">
          Message
        </label>
        <textarea
          id="composer"
          rows={1}
          placeholder="Type a message"
          value={draft}
          maxLength={4000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) send(e);
          }}
        />
        <button type="submit" className="send-btn" disabled={!draft.trim() || sending} aria-label="Send message">
          {sending ? <span className="spinner" style={{ width: 18, height: 18 }} /> : <SendHorizontal size={19} />}
        </button>
      </form>
    </div>
  );
}
