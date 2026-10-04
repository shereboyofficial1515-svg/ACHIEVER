import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, Ban, BellOff, Check, CheckCheck, ChevronDown, Clock, Copy, FileText, Flag, Info, Megaphone, Mic, MoreVertical, Paperclip,
  Pencil, Phone, Pin, PinOff, Play, Reply, RotateCcw, Search, SendHorizontal, SmilePlus, Trash2, Video, WifiOff, X,
} from 'lucide-react';
import { ErrorState, Loader, UserAvatar } from '../ui/index.js';
import { api } from '../../services/api.js';
import { useRealtime, useRealtimeEvent } from '../../contexts/RealtimeContext.jsx';
import { useCalls } from '../../contexts/CallContext.jsx';
import { usePreferences } from '../../contexts/PreferencesContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useConfirm } from '../ui/ConfirmProvider.jsx';
import { pushOverlay } from '../../platform/overlays.js';
import { requestMicrophonePermission } from '../../platform/index.js';
import { duration, fileSize, formatDate, formatTime, relativeTime } from '../../utils/format.js';
import { mergeMessages } from '../../utils/messages.js';
import { playSound } from '../../utils/sounds.js';
import { attachmentUrl, cachedAttachmentUrl, documentTypeLabel, mediaKind } from '../../utils/mediaCache.js';
import MediaViewer from '../media/MediaViewer.jsx';
import { AttachmentSheet, PICKERS, SendPreview, fileKind, prepareFiles } from '../media/AttachmentComposer.jsx';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
// The server enforces both limits; the app only hides actions that would be refused.
export const EDIT_WINDOW = 10 * 60 * 1000;               // edit your own message: 10 minutes
export const DELETE_WINDOW = 2 * 24 * 60 * 60 * 1000;    // delete for everyone: 2 days
const GROUP_GAP = 5 * 60 * 1000;
const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

function Linkified({ text }) {
  if (!text) return null;
  return text.split(URL_RE).map((part, i) => (URL_RE.test(part) && part.startsWith('http')
    ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
    : <Fragment key={i}>{part}</Fragment>));
}

/**
 * A chat attachment inside a bubble. Private files use short-lived signed URLs from the media
 * cache, so tapping an image opens the viewer with the SAME URL (no second download).
 * Photos follow "Load photos automatically"; videos load only their first frame (metadata).
 */
function Attachment({ a, voice, onOpen }) {
  const { prefs } = usePreferences();
  const kind = mediaKind(a.mimeType, { voice });
  const autoLoad = kind === 'audio' || ((kind === 'image' || kind === 'video') && prefs.messages.autoLoadImages !== false);
  const [url, setUrl] = useState(() => cachedAttachmentUrl(a.id));
  const [length, setLength] = useState(null);
  const retried = useRef(false);
  useEffect(() => {
    if (autoLoad && !url) attachmentUrl(a.id).then(setUrl).catch(() => {});
  }, [autoLoad, url, a.id]);
  const onError = () => {   // the signed URL expired: get a fresh one once
    if (retried.current) return;
    retried.current = true;
    attachmentUrl(a.id, { force: true }).then(setUrl).catch(() => {});
  };

  if (kind === 'audio') {
    return url ? <audio className="msg-audio" controls preload="metadata" src={url} onError={onError} aria-label="Voice message" /> : <span className="small muted">Loading voice message…</span>;
  }
  if (kind === 'image') {
    return (
      <button type="button" className="media-thumb" onClick={(e) => { e.stopPropagation(); onOpen(a); }} aria-label={`Photo: ${a.fileName}. Open`}>
        {url ? <img src={url} alt="" loading="lazy" onError={onError} /> : <span className="media-placeholder">Photo · {fileSize(a.sizeBytes)}<br />Tap to view</span>}
      </button>
    );
  }
  if (kind === 'video') {
    return (
      <button type="button" className="media-thumb is-video" onClick={(e) => { e.stopPropagation(); onOpen(a); }} aria-label={`Video${length ? `, ${duration(length)}` : ''}. Play`}>
        {url ? (
          <video src={`${url}#t=0.1`} preload="metadata" muted playsInline tabIndex={-1} onLoadedMetadata={(e) => setLength(Math.round(e.currentTarget.duration))} onError={onError} />
        ) : <span className="media-placeholder">Video · {fileSize(a.sizeBytes)}</span>}
        <span className="media-play" aria-hidden><Play size={22} fill="currentColor" /></span>
        {length ? <span className="media-duration">{duration(length)}</span> : null}
      </button>
    );
  }
  return (
    <button type="button" className="doc-card" onClick={(e) => { e.stopPropagation(); onOpen(a); }} aria-label={`${a.fileName}. Open`}>
      <span className="doc-card-icon"><FileText size={22} aria-hidden /></span>
      <span className="doc-card-text">
        <strong className="truncate">{a.fileName}</strong>
        <span>{documentTypeLabel(a.mimeType)} · {fileSize(a.sizeBytes)}</span>
      </span>
    </button>
  );
}

/** An upload in progress (or failed) shown at the end of the chat until the server confirms it. */
function UploadRow({ u, onRetry, onCancel, onRemove }) {
  const kind = fileKind(u.file);
  return (
    <div className="msg mine upload-row">
      <div className="msg-body">
        <div className={`bubble${kind !== 'document' ? ' has-media' : ''}`}>
          {kind === 'image' && u.previewUrl && <span className="media-thumb"><img src={u.previewUrl} alt="" /></span>}
          {kind === 'video' && <span className="media-thumb is-video"><span className="media-placeholder">Video · {fileSize(u.file.size)}</span></span>}
          {kind === 'document' && (
            <span className="doc-card">
              <span className="doc-card-icon"><FileText size={22} aria-hidden /></span>
              <span className="doc-card-text"><strong className="truncate">{u.file.name}</strong><span>{documentTypeLabel(u.file.type)} · {fileSize(u.file.size)}</span></span>
            </span>
          )}
          {u.caption && <span className="msg-text">{u.caption}</span>}
          {u.status === 'failed' ? (
            <span className="upload-state failed" role="alert">
              <AlertCircle size={15} aria-hidden /> Upload failed
              <button type="button" className="upload-action" onClick={() => onRetry(u)}><RotateCcw size={14} aria-hidden /> Retry</button>
              <button type="button" className="upload-action" onClick={() => onRemove(u)} aria-label="Remove"><X size={14} aria-hidden /></button>
            </span>
          ) : (
            <span className="upload-state" aria-live="polite">
              <span className="upload-bar"><span style={{ width: `${u.progress}%` }} /></span>
              Uploading… {u.progress}%
              <button type="button" className="upload-action" onClick={() => onCancel(u)} aria-label="Cancel upload"><X size={14} aria-hidden /></button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Ticks({ status }) {
  if (status === 'sending') return <Clock size={13} aria-label="Sending" />;
  if (status === 'read') return <CheckCheck size={15} className="tick-read" aria-label="Read" />;
  if (status === 'delivered') return <CheckCheck size={15} aria-label="Delivered" />;
  return <Check size={15} aria-label="Sent" />;
}

function useLongPress(onLongPress, ms = 450) {
  const timer = useRef(null);
  const start = (e) => { timer.current = setTimeout(() => onLongPress(e), ms); };
  const clear = () => clearTimeout(timer.current);
  return { onTouchStart: start, onTouchEnd: clear, onTouchMove: clear, onContextMenu: (e) => { e.preventDefault(); onLongPress(e); } };
}

function MessageRow({ m, mine, showSender, sender, senderName, nameOf, status, highlighted, selected, onSelect, onJump, onToggleReaction, onOpenMedia, currentUserId, isGroup }) {
  const press = useLongPress(() => onSelect(m));
  const reactions = useMemo(() => {
    const byEmoji = new Map();
    (m.reactions || []).forEach((r) => {
      const e = byEmoji.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false };
      e.count += 1;
      if (r.userId === currentUserId) e.mine = true;
      byEmoji.set(r.emoji, e);
    });
    return [...byEmoji.values()];
  }, [m.reactions, currentUserId]);

  if (m.kind === 'system' || m.kind === 'call') {
    return <div className="msg system" id={`m-${m.id}`}><div className="bubble">{m.body}</div></div>;
  }
  const voice = m.metadata?.voice;
  const announcement = m.kind === 'announcement';
  const visual = !m.deleted && !voice && m.attachments?.some((a) => /^(image|video)\//.test(a.mimeType));
  return (
    <div id={`m-${m.id}`} className={`msg ${mine ? 'mine' : 'theirs'}${showSender ? ' first' : ''}${highlighted ? ' highlight' : ''}${selected ? ' selected' : ''}${announcement ? ' announcement' : ''}`}>
      {!mine && isGroup && (showSender ? <UserAvatar name={senderName} src={sender?.avatarUrl} size={28} /> : <span className="msg-avatar-gap" aria-hidden />)}
      <div className="msg-body">
        {!mine && isGroup && showSender && !announcement && <span className="sender">{senderName}</span>}
        <div className={`bubble${visual ? ' has-media' : ''}${visual && !m.body ? ' media-only' : ''}`} {...press} onDoubleClick={() => onSelect(m)} tabIndex={0} role="article"
          aria-label={`${mine ? 'You' : senderName}: ${m.deleted ? 'deleted message' : m.body || 'attachment'}`}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(m); } }}>
          {announcement && !m.deleted && <span className="announcement-label"><Megaphone size={14} aria-hidden /> Group announcement{isGroup ? ` · ${mine ? 'You' : senderName}` : ''}</span>}
          {m.replyTo && !m.deleted && (
            <button type="button" className="reply-quote" onClick={(e) => { e.stopPropagation(); onJump(m.replyTo.id); }}>
              <strong>{nameOf(m.replyTo.senderId)}</strong>
              <span>{m.replyTo.deleted ? 'This message was deleted' : m.replyTo.body || 'Attachment'}</span>
            </button>
          )}
          {m.deleted ? <em className="deleted">This message was deleted</em> : (
            <>
              {m.attachments?.map((a) => <Attachment key={a.id} a={a} voice={voice} onOpen={(att) => onOpenMedia(att, m)} />)}
              {m.body && <span className="msg-text"><Linkified text={m.body} /></span>}
            </>
          )}
          <span className="meta">
            {m.editedAt && <span className="edited">edited</span>}
            {formatTime(m.createdAt)}
            {mine && !m.deleted && <Ticks status={status} />}
          </span>
        </div>
        {reactions.length > 0 && (
          <div className="reactions">
            {reactions.map((r) => (
              <button key={r.emoji} type="button" className={`reaction${r.mine ? ' mine' : ''}`} onClick={() => onToggleReaction(m, r.mine ? null : r.emoji)}
                aria-label={`${r.emoji} ${r.count}${r.mine ? ', your reaction' : ''}`}>
                {r.emoji}<span>{r.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {!m.deleted && (
        <button type="button" className="msg-more" onClick={() => onSelect(m)} aria-label="Message options"><ChevronDown size={16} /></button>
      )}
    </div>
  );
}

/**
 * A conversation: header → messages (own scroll) → typing / reply / edit → composer.
 * Full screen on phones (the bottom navigation is hidden while a chat is open).
 */
export default function ChatWindow({ conversationId, currentUserId, onBack }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const calls = useCalls();
  const toast = useToast();
  const confirmAction = useConfirm();
  const [conv, setConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [announce, setAnnounce] = useState(false);
  const [selected, setSelected] = useState(null);
  const [reacting, setReacting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menu, setMenu] = useState(null);           // null | 'main' | 'mute'
  const [search, setSearch] = useState(null);        // null | { q, results, loading }
  const [typing, setTyping] = useState({});           // userId -> { name, until }
  const [newCount, setNewCount] = useState(0);
  const [highlight, setHighlight] = useState(null);
  const [pinIndex, setPinIndex] = useState(0);
  const [recording, setRecording] = useState(null);   // { started, recorder, chunks }
  const [recSeconds, setRecSeconds] = useState(0);
  const [viewer, setViewer] = useState(null);         // { attachment, sender, createdAt }
  const [sheet, setSheet] = useState(false);          // the Attach sheet
  const [picked, setPicked] = useState(null);         // { files, picker } waiting for Send
  const [uploads, setUploads] = useState([]);         // uploads in progress / failed
  const { status: connection } = useRealtime();
  const { prefs } = usePreferences();
  const listRef = useRef(null);
  const atBottom = useRef(true);
  const pickerRefs = useRef({});
  const inputRef = useRef(null);
  const lastTyping = useRef(0);
  const restoreScroll = useRef(null);

  const markRead = useCallback(() => api.post(`/messages/conversations/${conversationId}/read`).catch(() => {}), [conversationId]);
  const loadConv = useCallback(() => api.get(`/messages/conversations/${conversationId}`).then(({ data }) => setConv(data)), [conversationId]);

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
      setHasNewer(false);
      atBottom.current = true;
      markRead();
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [conversationId, markRead]);
  useEffect(() => { load(); }, [load]);
  // Opened from Group info → "Search messages": start in search mode.
  useEffect(() => {
    if (searchParams.get('search') === '1') {
      setSearch({ q: '', results: [] });
      setSearchParams((p) => { p.delete('search'); return p; }, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setNewCount(0);
  }, []);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (restoreScroll.current != null) {
      el.scrollTop = el.scrollHeight - restoreScroll.current;
      restoreScroll.current = null;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, typing]);

  // Keyboard opening / rotation resizes the viewport: keep the latest messages in view.
  useEffect(() => {
    const vv = window.visualViewport;
    const onResize = () => { if (atBottom.current) requestAnimationFrame(() => scrollToBottom()); };
    (vv || window).addEventListener('resize', onResize);
    return () => (vv || window).removeEventListener('resize', onResize);
  }, [scrollToBottom]);

  const loadOlder = async () => {
    if (!messages.length || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const { data } = await api.get(`/messages/conversations/${conversationId}/messages`, { limit: 40, before: messages[0].createdAt });
      restoreScroll.current = listRef.current.scrollHeight - listRef.current.scrollTop;
      setMessages((list) => mergeMessages(list, data.messages));
      setHasMore(data.hasMore);
    } catch (err) {
      toast.error(err);
    } finally {
      setLoadingMore(false);
    }
  };

  const onScroll = (e) => {
    const el = e.currentTarget;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current && newCount) setNewCount(0);
    if (el.scrollTop < 80 && hasMore && !loadingMore) loadOlder();
  };

  const jumpTo = useCallback(async (messageId) => {
    setSearch(null);
    const show = () => {
      const node = document.getElementById(`m-${messageId}`);
      if (node) {
        atBottom.current = false;
        node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setHighlight(messageId);
        setTimeout(() => setHighlight(null), 2200);
        return true;
      }
      return false;
    };
    if (show()) return;
    try {
      const { data } = await api.get(`/messages/conversations/${conversationId}/messages/${messageId}/around`);
      atBottom.current = false;
      setMessages(data.messages);
      setHasMore(data.hasMore);
      setHasNewer(data.hasNewer);
      setTimeout(show, 60);
    } catch (err) {
      toast.error(err);
    }
  }, [conversationId, toast]);

  const backToLatest = () => { if (hasNewer) load(); else scrollToBottom(true); };

  // Realtime ---------------------------------------------------------------------------------
  useRealtimeEvent('message.new', (m) => {
    if (m.conversationId !== conversationId) return;
    if (hasNewer) return;   // viewing older history: the "latest" button reloads
    // Same id = same message (update, never duplicate); kept in created_at order.
    setMessages((list) => mergeMessages(list.filter((x) => !(x.pending && x.body === m.body && m.senderId === currentUserId)), [m]));
    setTyping((t) => { const n = { ...t }; delete n[m.senderId]; return n; });
    if (m.senderId !== currentUserId) {
      if (atBottom.current) markRead();
      else setNewCount((n) => n + 1);
    }
  });
  // Reconnected / back from the background: fetch what arrived while the connection was down.
  useRealtimeEvent('resync', async () => {
    if (hasNewer) return;
    const newest = [...messages].reverse().find((x) => !x.pending);
    try {
      const [{ data }] = await Promise.all([
        api.get(`/messages/conversations/${conversationId}/messages`, newest ? { limit: 100, after: newest.createdAt } : { limit: 40 }),
        loadConv().catch(() => {}),
      ]);
      if (!data.messages.length) return;
      const fresh = data.messages.filter((x) => !messages.some((y) => y.id === x.id) && x.senderId !== currentUserId);
      setMessages((list) => mergeMessages(list, data.messages));
      if (fresh.length) {
        if (atBottom.current) markRead();
        else setNewCount((n) => n + fresh.length);
      }
    } catch { /* the next reconnect tries again */ }
  });
  useRealtimeEvent('message.updated', (m) => {
    if (m.conversationId !== conversationId) return;
    setMessages((list) => list.map((x) => (x.id === m.id ? m : x)));
    if (conv?.pinned?.some((p) => p.messageId === m.id)) loadConv().catch(() => {});
  });
  useRealtimeEvent('conversation.updated', (e) => { if (e.conversationId === conversationId) loadConv().catch(() => {}); });
  useRealtimeEvent('conversation.receipt', (r) => {
    if (r.conversationId !== conversationId) return;
    setConv((c) => (c ? {
      ...c,
      members: c.members.map((mm) => (mm.id === r.userId && mm.sharesReceipts
        ?{ ...mm, lastReadAt: r.lastReadAt ?? mm.lastReadAt, lastDeliveredAt: r.lastDeliveredAt ?? mm.lastDeliveredAt } : mm)),
    } : c));
  });
  useRealtimeEvent('typing', (t) => {
    if (t.conversationId !== conversationId || t.userId === currentUserId) return;
    setTyping((prev) => ({ ...prev, [t.userId]: { name: t.name, until: Date.now() + 5000 } }));
  });
  useEffect(() => {
    const timer = setInterval(() => setTyping((prev) => {
      const now = Date.now();
      const next = Object.fromEntries(Object.entries(prev).filter(([, v]) => v.until > now));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    }), 1000);
    return () => clearInterval(timer);
  }, []);

  // The Android back button closes menus, search and selection before leaving the chat.
  useEffect(() => (menu ? pushOverlay(() => setMenu(null)) : undefined), [menu]);
  useEffect(() => (search ? pushOverlay(() => setSearch(null)) : undefined), [search]);
  useEffect(() => (selected ? pushOverlay(() => { setSelected(null); setReacting(false); setDeleting(false); }) : undefined), [selected]);
  // Revoke local previews of finished uploads.
  useEffect(() => () => uploads.forEach((u) => u.previewUrl && URL.revokeObjectURL(u.previewUrl)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sending -----------------------------------------------------------------------------------
  const onDraft = (value) => {
    setDraft(value);
    if (value && Date.now() - lastTyping.current > 3000) {
      lastTyping.current = Date.now();
      api.post(`/messages/conversations/${conversationId}/typing`).catch(() => {});
    }
  };

  const send = async (e) => {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    if (editing) {
      setSending(true);
      try {
        const { data } = await api.patch(`/messages/messages/${editing.id}`, { body });
        setMessages((list) => list.map((x) => (x.id === data.id ? data : x)));
        if (conv.pinned?.some((p) => p.messageId === data.id)) loadConv().catch(() => {});
        setEditing(null);
        setDraft('');
      } catch (err) {
        toast.error(err);
      } finally {
        setSending(false);
      }
      return;
    }
    const temp = { id: `tmp-${Date.now()}`, pending: true, conversationId, senderId: currentUserId, kind: announce ? 'announcement' : 'text', body, createdAt: new Date().toISOString(), replyTo: replyTo ? { id: replyTo.id, senderId: replyTo.senderId, body: replyTo.body } : null, reactions: [], attachments: [] };
    atBottom.current = true;
    setMessages((list) => [...list, temp]);
    setDraft('');
    const reply = replyTo;
    setReplyTo(null);
    setSending(true);
    try {
      const { data } = await api.post(`/messages/conversations/${conversationId}/messages`, { body, replyTo: reply?.id || null, announcement: announce || undefined });
      setMessages((list) => mergeMessages(list.filter((x) => x.id !== temp.id), [data]));
      setAnnounce(false);
      playSound('outgoing', prefs.messages);
    } catch (err) {
      setMessages((list) => list.filter((x) => x.id !== temp.id));
      setDraft(body);
      toast.error(err);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // Attachments: Attach sheet → picker → preview → Send → upload with progress (cancel / retry).
  const runUpload = useCallback(async (u) => {
    const controller = new AbortController();
    setUploads((list) => list.map((x) => (x.id === u.id ? { ...x, status: 'uploading', progress: 0, controller } : x)));
    try {
      const { data } = await api.uploadWithProgress(
        `/messages/conversations/${conversationId}/attachments`,
        u.file,
        { caption: u.caption || '', replyTo: u.replyTo || '', voice: u.voice ? 'true' : '' },
        { signal: controller.signal, onProgress: (progress) => setUploads((list) => list.map((x) => (x.id === u.id ? { ...x, progress } : x))) },
      );
      setUploads((list) => list.filter((x) => x.id !== u.id));
      if (u.previewUrl) URL.revokeObjectURL(u.previewUrl);
      atBottom.current = true;
      setMessages((list) => mergeMessages(list, [data]));
      playSound('outgoing', prefs.messages);
    } catch (err) {
      if (err?.name === 'AbortError') {
        setUploads((list) => list.filter((x) => x.id !== u.id));
        return;
      }
      // Nothing was saved on the server: the file stays here with Retry.
      setUploads((list) => list.map((x) => (x.id === u.id ? { ...x, status: 'failed', error: err } : x)));
      toast.error(err);
    }
  }, [conversationId, prefs.messages, toast]);

  const queueUploads = (files, { caption = '', voice = false } = {}) => {
    const items = files.map((file, i) => ({
      id: `up-${Date.now()}-${i}`,
      file,
      caption: i === 0 ? caption : '',
      voice,
      replyTo: replyTo?.id || null,
      progress: 0,
      status: 'uploading',
      previewUrl: fileKind(file) === 'image' ? URL.createObjectURL(file) : null,
    }));
    setReplyTo(null);
    atBottom.current = true;
    setUploads((list) => [...list, ...items]);
    // One at a time keeps mobile data responsive; each has its own progress.
    items.reduce((chain, item) => chain.then(() => runUpload(item)), Promise.resolve());
  };
  const upload = (file, opts) => queueUploads([file], opts);

  const openPicker = (picker) => {
    setSheet(false);
    setTimeout(() => pickerRefs.current[picker]?.click(), 50);
  };
  const onPicked = (picker) => async (e) => {
    const list = [...(e.target.files || [])];
    e.target.value = '';
    if (!list.length) return;
    const { files, errors } = await prepareFiles(list, picker);
    errors.forEach((msg) => toast.error(msg));
    if (files.length) setPicked({ files, picker });
  };

  const canRecord = typeof window !== 'undefined' && 'MediaRecorder' in window && navigator.mediaDevices?.getUserMedia;
  const startRecording = async () => {
    try {
      await requestMicrophonePermission().catch(() => {});
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      recorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
      recorder.start();
      setRecSeconds(0);
      setRecording({ started: Date.now(), recorder, chunks, stream });
    } catch {
      toast.error('Microphone is not available. Allow microphone access to record a voice message.');
    }
  };
  useEffect(() => {
    if (!recording) return undefined;
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - recording.started) / 1000);
      setRecSeconds(s);
      if (s >= 120) stopRecording(true);   // two-minute limit (fits the 10 MB attachment limit)
    }, 250);
    return () => clearInterval(t);
  }, [recording]); // eslint-disable-line react-hooks/exhaustive-deps
  const stopRecording = (sendIt) => {
    const r = recording;
    if (!r) return;
    setRecording(null);
    r.recorder.onstop = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      if (!sendIt || Date.now() - r.started < 800) return;
      const type = r.recorder.mimeType || 'audio/webm';
      const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
      upload(new File([new Blob(r.chunks, { type })], `voice-message.${ext}`, { type: type.split(';')[0] }), { voice: true });
    };
    r.recorder.stop();
  };
  useEffect(() => () => recording?.stream?.getTracks().forEach((t) => t.stop()), [recording]);

  // Message actions ---------------------------------------------------------------------------
  const closeSelection = () => { setSelected(null); setReacting(false); setDeleting(false); };
  const doReact = async (m, emoji) => {
    closeSelection();
    try {
      const { data } = await api.put(`/messages/messages/${m.id}/reaction`, { emoji });
      setMessages((list) => list.map((x) => (x.id === data.id ? data : x)));
    } catch (err) {
      toast.error(err);
    }
  };
  const doCopy = async (m) => {
    closeSelection();
    try { await navigator.clipboard.writeText(m.body || ''); toast.success('Copied'); } catch { toast.error('Could not copy'); }
  };
  const doDelete = async (m, scope) => {
    closeSelection();
    try {
      await api.post(`/messages/messages/${m.id}/delete`, { scope });
      if (scope === 'me') setMessages((list) => list.filter((x) => x.id !== m.id));
      else setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, deleted: true, body: null, replyTo: null, attachments: [], reactions: [] } : x)));
      if (conv.pinned?.some((p) => p.messageId === m.id)) loadConv().catch(() => {});
    } catch (err) {
      toast.error(err);
    }
  };
  const doPin = async (m, pinned) => {
    closeSelection();
    try {
      await api.post(`/messages/conversations/${conversationId}/messages/${m.id}/pin`, { pinned });
      toast.success(pinned ? 'Message pinned' : 'Message unpinned');
      loadConv();
    } catch (err) {
      toast.error(err);
    }
  };
  const doReport = async (m) => {
    closeSelection();
    const ok = await confirmAction({ severity: 'warning', title: m ? 'Report this message?' : conv.type === 'group' ? 'Report this group?' : 'Report this person?', message: 'ACHIEVER support will review it. The person is not told who reported them.', confirmLabel: 'Report' });
    if (!ok) return;
    try {
      const { data } = await api.post(`/messages/conversations/${conversationId}/report`, { messageId: m?.id || null, reason: m ? 'Reported from the chat: inappropriate or unsafe message.' : 'Reported from the chat menu.' });
      toast.success(`Report sent (${data.reference}). Support will review it.`);
    } catch (err) {
      toast.error(err);
    }
  };

  // Menu actions --------------------------------------------------------------------------------
  const setMute = async (until) => {
    setMenu(null);
    try {
      await api.put(`/messages/conversations/${conversationId}/mute`, { until });
      setConv((c) => ({ ...c, me: { ...c.me, mutedUntil: until } }));
      toast.success(until ? 'Notifications muted' : 'Notifications on');
    } catch (err) { toast.error(err); }
  };
  const clearChat = async () => {
    setMenu(null);
    if (!(await confirmAction({ severity: 'danger', title: 'Clear this chat?', message: 'Messages are removed from your view only. Other members still see them.', confirmLabel: 'Clear chat' }))) return;
    try {
      await api.post(`/messages/conversations/${conversationId}/clear`);
      setMessages([]);
      setHasMore(false);
      toast.success('Chat cleared');
    } catch (err) { toast.error(err); }
  };
  const toggleBlock = async () => {
    setMenu(null);
    const other = conv.members.find((mm) => mm.id !== currentUserId);
    const blocking = !conv.blocked?.byMe;
    if (!(await confirmAction({ severity: blocking ? 'danger' : 'warning', title: blocking ? `Block ${other?.name}?` : `Unblock ${other?.name}?`, message: blocking ? 'Neither of you will be able to send messages in this chat until you unblock them.' : 'You will be able to message each other again.', confirmLabel: blocking ? 'Block' : 'Unblock' }))) return;
    try {
      await api.put(`/messages/people/${other.id}/block`, { blocked: blocking });
      await loadConv();
    } catch (err) { toast.error(err); }
  };
  const runSearch = async (q) => {
    setSearch((s) => ({ ...s, q, loading: q.trim().length >= 2 }));
    if (q.trim().length < 2) { setSearch((s) => ({ ...s, results: [] })); return; }
    try {
      const { data } = await api.get(`/messages/conversations/${conversationId}/search`, { q: q.trim() });
      setSearch((s) => (s && s.q === q ? { ...s, results: data, loading: false } : s));
    } catch {
      setSearch((s) => (s ? { ...s, loading: false } : s));
    }
  };

  if (loading) return <div className="chat"><Loader label="Loading messages..." /></div>;
  if (error) return <div className="chat"><ErrorState error={error} onRetry={load} /></div>;

  const isGroup = conv.type === 'group';
  const perms = { canSend: true, ...(conv.permissions || {}) };
  const byId = new Map(conv.members.map((mm) => [mm.id, mm]));
  const nameOf = (id) => (id === currentUserId ? 'You' : byId.get(id)?.name || 'Member');
  const other = !isGroup ? conv.members.find((mm) => mm.id !== currentUserId) : null;
  const title = isGroup ? conv.title : other?.name || conv.title;
  const avatarSrc = isGroup ? conv.group?.imageUrl : other?.avatarUrl;
  const infoPath = isGroup ? `/app/messages/${conversationId}/info` : other ? `/app/contacts/${other.id}?chat=${conversationId}` : null;
  const typers = Object.values(typing);
  let subtitle;
  if (typers.length) subtitle = typers.length === 1 ? (isGroup ? `${typers[0].name} is typing…` : 'typing…') : typers.length === 2 ? `${typers[0].name} and ${typers[1].name} are typing…` : `${typers.length} people are typing…`;
  else if (isGroup) subtitle = `${conv.memberCount} member${conv.memberCount === 1 ? "" : "s"}${perms.canSeeOnline ? ` · ${conv.onlineCount} online` : ''}`;
  else if (other?.online) subtitle = 'Online';
  else if (other?.lastSeenAt) subtitle = `Last seen ${relativeTime(other.lastSeenAt)}`;
  else subtitle = '';

  // Receipt state of my message from what others share (never invented).
  const others = conv.members.filter((mm) => mm.id !== currentUserId);
  const sharing = others.filter((mm) => mm.sharesReceipts);
  const statusOf = (m) => {
    if (m.pending) return 'sending';
    if (!others.length || sharing.length < others.length) return 'sent';
    const t = new Date(m.createdAt).getTime();
    if (sharing.every((mm) => mm.lastReadAt && new Date(mm.lastReadAt).getTime() >= t)) return 'read';
    if (sharing.every((mm) => (mm.lastDeliveredAt && new Date(mm.lastDeliveredAt).getTime() >= t) || (mm.lastReadAt && new Date(mm.lastReadAt).getTime() >= t))) return 'delivered';
    return 'sent';
  };

  const hasText = draft.trim().length > 0;   // "   " is empty; anything else shows Send
  const connectionNote = connection === 'reconnecting' ? (navigator.onLine === false ? 'Waiting for network…' : 'Reconnecting…')
    : connection === 'connecting' ? 'Connecting…' : null;

  const pinned = conv.pinned || [];
  const pin = pinned.length ? pinned[pinIndex % pinned.length] : null;
  const sel = selected;
  const selMine = sel && sel.senderId === currentUserId;
  const selAge = sel ? Date.now() - new Date(sel.createdAt).getTime() : 0;
  const isPinned = sel && pinned.some((p) => p.messageId === sel.id);
  const canDeleteEveryone = sel && !sel.deleted && ((selMine && selAge < DELETE_WINDOW) || (isGroup && perms.isAdmin));
  const blockedNote = conv.blocked?.byMe ? 'You blocked this contact.' : conv.blocked?.byThem ? 'You can’t send messages in this chat.' : null;

  let lastDay = null;
  let prev = null;
  return (
    <div className="chat">
      {/* Header: action bar while a message is selected */}
      {sel ? (
        <header className="chat-header chat-actionbar" aria-label="Message actions">
          <button type="button" className="icon-button" onClick={closeSelection} aria-label="Close message actions"><X size={20} /></button>
          <span className="grow small">{deleting ? 'Delete message?' : '1 selected'}</span>
          {deleting ? (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => doDelete(sel, 'me')}>Delete for me</button>
              {canDeleteEveryone && <button type="button" className="btn btn-danger btn-sm" onClick={() => doDelete(sel, 'everyone')}>For everyone</button>}
            </>
          ) : (
            <>
              {perms.canSend && !blockedNote && <button type="button" className="icon-button" onClick={() => { setReplyTo(sel); setEditing(null); closeSelection(); inputRef.current?.focus(); }} aria-label="Reply"><Reply size={19} /></button>}
              <button type="button" className="icon-button" onClick={() => setReacting((r) => !r)} aria-label="React"><SmilePlus size={19} /></button>
              {sel.body && <button type="button" className="icon-button" onClick={() => doCopy(sel)} aria-label="Copy"><Copy size={18} /></button>}
              {selMine && ['text', 'announcement'].includes(sel.kind) && selAge < EDIT_WINDOW && (
                <button type="button" className="icon-button" onClick={() => { setEditing(sel); setReplyTo(null); setDraft(sel.body || ''); closeSelection(); inputRef.current?.focus(); }} aria-label="Edit"><Pencil size={18} /></button>
              )}
              {perms.canPin && <button type="button" className="icon-button" onClick={() => doPin(sel, !isPinned)} aria-label={isPinned ? 'Unpin' : 'Pin'}>{isPinned ? <PinOff size={18} /> : <Pin size={18} />}</button>}
              <button type="button" className="icon-button" onClick={() => setDeleting(true)} aria-label="Delete"><Trash2 size={18} /></button>
              {!selMine && <button type="button" className="icon-button" onClick={() => doReport(sel)} aria-label="Report"><Flag size={18} /></button>}
            </>
          )}
        </header>
      ) : search ? (
        <header className="chat-header">
          <button type="button" className="icon-button" onClick={() => setSearch(null)} aria-label="Close search"><ArrowLeft size={20} /></button>
          <input className="input chat-search-input" type="search" autoFocus placeholder="Search this chat" value={search.q} onChange={(e) => runSearch(e.target.value)} aria-label="Search messages in this chat" />
        </header>
      ) : (
        <header className="chat-header">
          {onBack && <button type="button" className="icon-button back-btn" onClick={onBack} aria-label="Back to conversations"><ArrowLeft size={20} /></button>}
          <button type="button" className="chat-identity" onClick={() => infoPath && navigate(infoPath)} aria-label={`${title}. ${isGroup ? 'Group info' : 'View profile'}`}>
            <UserAvatar name={title} src={avatarSrc} online={other ? other.online : undefined} size={40} />
            <span className="chat-identity-text">
              <span className="chat-title truncate">{title}{conv.me?.mutedUntil && <BellOff size={13} className="muted" aria-label="Muted" />}</span>
              {connectionNote
                ? <span className="chat-subtitle truncate is-connecting" role="status"><WifiOff size={12} aria-hidden /> {connectionNote}</span>
                : <span className={`chat-subtitle truncate${typers.length ? ' is-typing' : ''}`}>{subtitle}</span>}
            </span>
          </button>
          <button type="button" className="icon-button" onClick={() => calls.startCall(conversationId, 'voice')} disabled={calls.busy || calls.inCall || Boolean(blockedNote)} aria-label="Start voice call"><Phone size={19} /></button>
          <button type="button" className="icon-button" onClick={() => calls.startCall(conversationId, 'video')} disabled={calls.busy || calls.inCall || Boolean(blockedNote)} aria-label="Start video call"><Video size={20} /></button>
          <div className="chat-menu-wrap">
            <button type="button" className="icon-button" onClick={() => setMenu(menu ? null : 'main')} aria-haspopup="menu" aria-expanded={Boolean(menu)} aria-label="Chat options"><MoreVertical size={20} /></button>
            {menu && (
              <>
                <div className="chat-menu-backdrop" onClick={() => setMenu(null)} />
                <div className="chat-menu" role="menu">
                  {menu === 'main' ? (
                    <>
                      {infoPath && <button type="button" role="menuitem" onClick={() => navigate(infoPath)}><Info size={16} /> {isGroup ? 'Group info' : 'Contact info'}</button>}
                      <button type="button" role="menuitem" onClick={() => { setMenu(null); setSearch({ q: '', results: [] }); }}><Search size={16} /> Search</button>
                      <button type="button" role="menuitem" onClick={() => navigate(`/app/messages/${conversationId}/media`)}><FileText size={16} /> Media, links & files</button>
                      {conv.me?.mutedUntil
                        ? <button type="button" role="menuitem" onClick={() => setMute(null)}><BellOff size={16} /> Unmute {isGroup ? 'group' : 'chat'}</button>
                        : <button type="button" role="menuitem" onClick={() => setMenu('mute')}><BellOff size={16} /> Mute {isGroup ? 'group' : 'notifications'}</button>}
                      {isGroup && <button type="button" role="menuitem" onClick={() => navigate(`/app/messages/${conversationId}/info#members`)}><Search size={16} /> Search members</button>}
                      {isGroup && perms.canManageSettings && <button type="button" role="menuitem" onClick={() => navigate(`/app/messages/${conversationId}/settings`)}><Pencil size={16} /> Group settings</button>}
                      <button type="button" role="menuitem" onClick={() => navigate('/app/settings/messages')}><Megaphone size={16} /> Notification settings</button>
                      <button type="button" role="menuitem" onClick={clearChat}><Trash2 size={16} /> Clear chat</button>
                      {!isGroup && conv.type === 'direct' && <button type="button" role="menuitem" className="danger" onClick={toggleBlock}><Ban size={16} /> {conv.blocked?.byMe ? 'Unblock' : 'Block'}</button>}
                      <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(null); doReport(null); }}><Flag size={16} /> Report{isGroup ? ' group' : ''}</button>
                    </>
                  ) : (
                    <>
                      <span className="chat-menu-label">Mute notifications for</span>
                      <button type="button" role="menuitem" onClick={() => setMute(new Date(Date.now() + 8 * 3600_000).toISOString())}>8 hours</button>
                      <button type="button" role="menuitem" onClick={() => setMute(new Date(Date.now() + 7 * 86400_000).toISOString())}>1 week</button>
                      <button type="button" role="menuitem" onClick={() => setMute(new Date(Date.now() + 3650 * 86400_000).toISOString())}>Always</button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </header>
      )}

      {reacting && sel && (
        <div className="reaction-picker" role="group" aria-label="Choose a reaction">
          {REACTIONS.map((e) => <button key={e} type="button" onClick={() => doReact(sel, e)} aria-label={`React ${e}`}>{e}</button>)}
        </div>
      )}

      {pin && !search && (
        <button type="button" className="pinned-bar" onClick={() => { jumpTo(pin.messageId); setPinIndex((i) => i + 1); }}>
          <Pin size={15} aria-hidden />
          <span className="grow truncate"><strong>Pinned{pinned.length > 1 ? ` (${(pinIndex % pinned.length) + 1}/${pinned.length})` : ''}</strong> {pin.body || 'Attachment'}</span>
        </button>
      )}

      <div className="chat-messages" ref={listRef} onScroll={onScroll} aria-live="polite">
        {search && (
          <div className="chat-search-results" role="list">
            {search.loading && <span className="small muted">Searching…</span>}
            {!search.loading && search.q.trim().length >= 2 && !search.results?.length && <span className="small muted">No messages found</span>}
            {search.results?.map((r) => (
              <button key={r.id} type="button" role="listitem" className="search-hit" onClick={() => jumpTo(r.id)}>
                <span className="xsmall muted">{nameOf(r.senderId)} · {formatDate(r.createdAt)}</span>
                <span className="truncate">{r.body}</span>
              </button>
            ))}
          </div>
        )}
        {loadingMore && <span className="spinner" style={{ alignSelf: 'center' }} aria-label="Loading older messages" />}
        {!hasMore && messages.length > 0 && <span className="day-divider">Start of conversation</span>}
        {messages.length === 0 && <div className="state"><p>No messages yet. Say hello.</p></div>}
        {messages.map((m) => {
          const day = formatDate(m.createdAt);
          const divider = day !== lastDay ? <span className="day-divider">{day}</span> : null;
          lastDay = day;
          const showSender = !prev || prev.senderId !== m.senderId || divider || ['system', 'call'].includes(prev.kind)
            || new Date(m.createdAt) - new Date(prev.createdAt) > GROUP_GAP;
          prev = m;
          return (
            <Fragment key={m.id}>
              {divider}
              <MessageRow
                m={m}
                mine={m.senderId === currentUserId}
                showSender={showSender}
                sender={byId.get(m.senderId)}
                senderName={byId.get(m.senderId)?.name || 'Former member'}
                nameOf={nameOf}
                status={statusOf(m)}
                highlighted={highlight === m.id}
                selected={sel?.id === m.id}
                onSelect={(x) => { if (!x.pending && !['system', 'call'].includes(x.kind)) { setSelected(x); setReacting(false); setDeleting(false); } }}
                onJump={jumpTo}
                onToggleReaction={doReact}
                onOpenMedia={(attachment, msg) => setViewer({ attachment, sender: msg.senderId === currentUserId ? 'You' : byId.get(msg.senderId)?.name, createdAt: msg.createdAt })}
                currentUserId={currentUserId}
                isGroup={isGroup}
              />
            </Fragment>
          );
        })}
        {uploads.map((u) => (
          <UploadRow
            key={u.id}
            u={u}
            onRetry={runUpload}
            onCancel={(x) => x.controller?.abort()}
            onRemove={(x) => { if (x.previewUrl) URL.revokeObjectURL(x.previewUrl); setUploads((list) => list.filter((y) => y.id !== x.id)); }}
          />
        ))}
      </div>

      {(newCount > 0 || hasNewer) && (
        <button type="button" className="new-messages-pill" onClick={backToLatest}>
          <ChevronDown size={16} aria-hidden /> {newCount > 0 ? `${newCount} new message${newCount === 1 ? '' : 's'}` : 'Latest messages'}
        </button>
      )}

      {(replyTo || editing) && (
        <div className="composer-context">
          {editing ? <Pencil size={16} aria-hidden /> : <Reply size={16} aria-hidden />}
          <span className="grow truncate">
            <strong>{editing ? 'Edit message' : `Replying to ${nameOf(replyTo.senderId)}`}</strong> {(editing || replyTo).body || 'Attachment'}
          </span>
          <button type="button" className="icon-button" onClick={() => { setReplyTo(null); if (editing) { setEditing(null); setDraft(''); } }} aria-label="Cancel"><X size={18} /></button>
        </div>
      )}

      {blockedNote ? (
        <div className="chat-composer-note">
          {blockedNote} {conv.blocked?.byMe && <button type="button" className="link-button" onClick={toggleBlock}>Unblock</button>}
        </div>
      ) : !perms.canSend ? (
        <div className="chat-composer-note"><Megaphone size={16} aria-hidden /> Only group admins can send messages.</div>
      ) : recording ? (
        <div className="chat-composer recording" aria-live="polite">
          <button type="button" className="icon-button" onClick={() => stopRecording(false)} aria-label="Cancel recording"><Trash2 size={19} /></button>
          <span className="rec-dot" aria-hidden />
          <span className="grow">Recording {Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, '0')}</span>
          <button type="button" className="send-btn" onClick={() => stopRecording(true)} aria-label="Send voice message"><SendHorizontal size={19} /></button>
        </div>
      ) : (
        <form className="chat-composer" onSubmit={send}>
          {Object.entries(PICKERS).map(([key, cfg]) => (
            <input key={key} ref={(el) => { pickerRefs.current[key] = el; }} type="file" hidden accept={cfg.accept} multiple={cfg.multiple} capture={cfg.capture} onChange={onPicked(key)} />
          ))}
          {!editing && <button type="button" className="icon-button" onClick={() => setSheet(true)} aria-haspopup="dialog" aria-label="Attach: camera, photos, video or document"><Paperclip size={20} /></button>}
          {isGroup && perms.canAnnounce && !editing && (
            <button type="button" className={`icon-button${announce ? ' is-active' : ''}`} onClick={() => setAnnounce((a) => !a)} aria-pressed={announce} aria-label="Send as group announcement"><Megaphone size={19} /></button>
          )}
          <label className="sr-only" htmlFor={`composer-${conversationId}`}>Message</label>
          <textarea
            id={`composer-${conversationId}`}
            ref={inputRef}
            rows={1}
            placeholder={announce ? 'Write an announcement' : 'Type a message'}
            value={draft}
            maxLength={4000}
            onChange={(e) => onDraft(e.target.value)}
            // Paste, autocomplete, the keyboard's clipboard chip and dictation all end up here:
            // the Send/Mic button follows the field's real value, not key presses.
            onInput={(e) => { if (e.currentTarget.value !== draft) onDraft(e.currentTarget.value); }}
            onPaste={(e) => { const el = e.currentTarget; setTimeout(() => { if (el.value !== draft) onDraft(el.value); }, 0); }}
            onCompositionEnd={(e) => onDraft(e.currentTarget.value)}
            onFocus={() => { if (atBottom.current) setTimeout(() => scrollToBottom(), 250); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) send(e); }}
          />
          {hasText || editing || !canRecord ? (
            <button type="submit" className="send-btn" disabled={!hasText || sending} aria-label={editing ? 'Save edit' : 'Send message'}>
              {sending ? <span className="spinner" style={{ width: 18, height: 18 }} /> : editing ? <Check size={19} /> : <SendHorizontal size={19} />}
            </button>
          ) : (
            <button type="button" className="send-btn" onClick={startRecording} disabled={sending} aria-label="Record a voice message"><Mic size={19} /></button>
          )}
        </form>
      )}
      {sheet && <AttachmentSheet onPick={openPicker} onClose={() => setSheet(false)} />}
      {picked && (
        <SendPreview
          files={picked.files}
          picker={picked.picker}
          onCancel={() => setPicked(null)}
          onRetake={() => { setPicked(null); openPicker('camera'); }}
          onRemove={(i) => setPicked((p) => { const files = p.files.filter((_, j) => j !== i); return files.length ? { ...p, files } : null; })}
          onSend={(caption) => { queueUploads(picked.files, { caption }); setPicked(null); }}
        />
      )}
      {viewer && <MediaViewer {...viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}
