import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Link2, Mic, PlayCircle } from 'lucide-react';
import { Button, EmptyState, ErrorState, Tabs } from '../../components/ui/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { api } from '../../services/api.js';
import { fileSize, formatDate } from '../../utils/format.js';

const TABS = [
  { value: 'media', label: 'Media' },
  { value: 'docs', label: 'Docs' },
  { value: 'links', label: 'Links' },
  { value: 'audio', label: 'Audio' },
];

/** Private files: each thumbnail asks for its own short-lived signed URL. */
function MediaTile({ item }) {
  const [url, setUrl] = useState(null);
  const toast = useToast();
  const isImage = item.mimeType.startsWith('image/');
  useEffect(() => {
    if (!isImage) return;
    api.get(`/messages/attachments/${item.id}/url`).then(({ data }) => setUrl(data.url)).catch(() => {});
  }, [item.id, isImage]);
  const open = async () => {
    try {
      const u = url || (await api.get(`/messages/attachments/${item.id}/url`)).data.url;
      window.open(u, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <button type="button" className="media-tile" onClick={open} aria-label={`${item.fileName}, ${formatDate(item.createdAt)}`}>
      {isImage && url ? <img src={url} alt="" loading="lazy" /> : <PlayCircle size={28} aria-hidden />}
    </button>
  );
}

function FileRow({ item }) {
  const toast = useToast();
  const [audioUrl, setAudioUrl] = useState(null);
  const isAudio = item.mimeType.startsWith('audio/') || item.fileName?.startsWith('voice-message');
  const open = async () => {
    try {
      const { data } = await api.get(`/messages/attachments/${item.id}/url`);
      if (isAudio) setAudioUrl(data.url);
      else window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <li className="media-row">
      {isAudio ? <Mic size={20} aria-hidden /> : <FileText size={20} aria-hidden />}
      <span className="grow" style={{ minWidth: 0 }}>
        {audioUrl ? <audio controls autoPlay src={audioUrl} className="msg-audio" /> : (
          <button type="button" className="link-button truncate" onClick={open} style={{ display: 'block', maxWidth: '100%' }}>{isAudio ? 'Voice message' : item.fileName}</button>
        )}
        <span className="xsmall muted">{fileSize(item.sizeBytes)} · {formatDate(item.createdAt)}</span>
      </span>
    </li>
  );
}

/** Media, links & files shared in a chat (paginated, newest first). */
export default function ChatMedia() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState('media');
  const [items, setItems] = useState([]);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (type, before) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/messages/conversations/${conversationId}/media`, { type, before });
      setItems((list) => (before ? [...list, ...data.items] : data.items));
      setNext(data.next);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);
  useEffect(() => { setItems([]); load(tab); }, [tab, load]);

  return (
    <div className="stack-lg info-page">
      <div className="info-topbar">
        <button type="button" className="icon-button" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={20} /></button>
        <span className="grow">Media, links & files</span>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {error && <ErrorState error={error} onRetry={() => load(tab)} />}
      {!error && !loading && !items.length && (
        <EmptyState title={`No ${TABS.find((t) => t.value === tab).label.toLowerCase()} yet`} message="Anything shared in this chat appears here." />
      )}
      {tab === 'media' && items.length > 0 && <div className="media-grid">{items.map((it) => <MediaTile key={it.id} item={it} />)}</div>}
      {(tab === 'docs' || tab === 'audio') && items.length > 0 && <ul className="media-list">{items.map((it) => <FileRow key={it.id} item={it} />)}</ul>}
      {tab === 'links' && items.length > 0 && (
        <ul className="media-list">
          {items.map((it) => (
            <li key={it.id} className="media-row">
              <Link2 size={20} aria-hidden />
              <span className="grow" style={{ minWidth: 0 }}>
                <a href={it.url} target="_blank" rel="noopener noreferrer" className="truncate" style={{ display: 'block' }}>{it.url}</a>
                <span className="xsmall muted">{formatDate(it.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {loading && <span className="spinner" style={{ alignSelf: 'center' }} aria-label="Loading" />}
      {next && !loading && <Button variant="secondary" onClick={() => load(tab, next)}>Load more</Button>}
    </div>
  );
}
