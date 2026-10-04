import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Download, ExternalLink, FileText, RotateCcw, Share2, ZoomIn, ZoomOut } from 'lucide-react';
import { pushOverlay } from '../../platform/overlays.js';
import { isNative, openExternalLink, saveFile, shareGeneratedFile } from '../../platform/index.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { attachmentBlob, attachmentUrl, cachedAttachmentUrl, documentTypeLabel, mediaKind } from '../../utils/mediaCache.js';
import { fileSize, formatDateTime } from '../../utils/format.js';

const MAX_ZOOM = 5;

/** Pinch-to-zoom, double-tap zoom and pan for one image (pointer events: touch, pen and mouse). */
function ZoomableImage({ src, alt, onError }) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const lastTap = useRef(0);
  const clamp = (v) => ({ ...v, scale: Math.min(MAX_ZOOM, Math.max(1, v.scale)) });

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
    }
  };
  const onPointerMove = (e) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setView((v) => clamp({ ...v, scale: pinch.current.scale * (dist / pinch.current.dist) }));
    } else if (pointers.current.size === 1 && view.scale > 1) {
      setView((v) => ({ ...v, x: v.x + (e.clientX - prev.x), y: v.y + (e.clientY - prev.y) }));
    }
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (e.type === 'pointerup') {   // double tap / double click toggles zoom
      const now = Date.now();
      if (now - lastTap.current < 280 && pointers.current.size === 0) {
        setView((v) => (v.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 }));
        lastTap.current = 0;
      } else {
        lastTap.current = now;
      }
    }
  };
  const onWheel = (e) => setView((v) => clamp({ ...v, scale: v.scale * (e.deltaY < 0 ? 1.15 : 0.87) }));
  useEffect(() => { if (view.scale === 1 && (view.x || view.y)) setView({ scale: 1, x: 0, y: 0 }); }, [view]);

  return (
    <div className="viewer-stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}>
      <img
        src={src}
        alt={alt}
        onError={onError}
        draggable={false}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      />
      <div className="viewer-zoom" role="group" aria-label="Zoom">
        <button type="button" className="viewer-btn" onClick={() => setView((v) => clamp({ ...v, scale: v.scale / 1.5 }))} aria-label="Zoom out"><ZoomOut size={20} /></button>
        <button type="button" className="viewer-btn" onClick={() => setView({ scale: 1, x: 0, y: 0 })} aria-label="Reset zoom"><RotateCcw size={18} /></button>
        <button type="button" className="viewer-btn" onClick={() => setView((v) => clamp({ ...v, scale: v.scale * 1.5 }))} aria-label="Zoom in"><ZoomIn size={20} /></button>
      </div>
    </div>
  );
}

/**
 * Full-screen viewer for a chat attachment (image, video or document). Opens on tap; the
 * Android back button and the ← button close it. Uses the cached signed URL, so an image that
 * is already on screen is shown from the browser cache, not downloaded again; an expired URL
 * is refreshed once automatically.
 */
export default function MediaViewer({ attachment, sender, createdAt, onClose }) {
  const toast = useToast();
  const kind = mediaKind(attachment.mimeType);
  const [url, setUrl] = useState(() => cachedAttachmentUrl(attachment.id));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const refreshed = useRef(false);

  useEffect(() => pushOverlay(onClose), [onClose]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  useEffect(() => {
    if (url) return;
    attachmentUrl(attachment.id).then(setUrl).catch(setError);
  }, [attachment.id, url]);

  // A signed URL can expire while the viewer is open: get a fresh one once.
  const onMediaError = useCallback(() => {
    if (refreshed.current) { setError(new Error('This file could not be loaded.')); return; }
    refreshed.current = true;
    attachmentUrl(attachment.id, { force: true }).then(setUrl).catch(setError);
  }, [attachment.id]);

  const share = async () => {
    setBusy('share');
    try {
      const blob = await attachmentBlob(attachment.id);
      const res = await shareGeneratedFile(blob, attachment.fileName, { title: attachment.fileName });
      if (res === 'downloaded') toast.success('Saved to your downloads');
    } catch {
      toast.error('Could not share this file. Please try again.');
    } finally {
      setBusy(null);
    }
  };
  const download = async () => {
    setBusy('download');
    try {
      const blob = await attachmentBlob(attachment.id);
      await saveFile(blob, attachment.fileName);
    } catch {
      toast.error('Could not download this file. Please try again.');
    } finally {
      setBusy(null);
    }
  };
  const openExternally = async () => {
    try {
      await openExternalLink(url || (await attachmentUrl(attachment.id)));
    } catch {
      toast.error('Could not open this file.');
    }
  };

  // PDFs preview inline in browsers; the Android WebView cannot render PDFs, so there it opens externally.
  const pdfInline = kind === 'document' && attachment.mimeType === 'application/pdf' && !isNative();

  return createPortal(
    <div className={`media-viewer kind-${kind}`} role="dialog" aria-modal="true" aria-label={`${attachment.fileName}`}>
      <header className="viewer-top">
        <button type="button" className="viewer-btn" onClick={onClose} aria-label="Back"><ArrowLeft size={22} /></button>
        <div className="viewer-title">
          <strong className="truncate">{sender || attachment.fileName}</strong>
          <span className="truncate">{createdAt ? formatDateTime(createdAt) : ''}{kind !== 'document' ? ` · ${fileSize(attachment.sizeBytes)}` : ''}</span>
        </div>
        <button type="button" className="viewer-btn" onClick={share} disabled={Boolean(busy)} aria-label="Share"><Share2 size={20} /></button>
        <button type="button" className="viewer-btn" onClick={download} disabled={Boolean(busy)} aria-label="Download"><Download size={20} /></button>
      </header>

      <div className="viewer-body">
        {error && <p className="viewer-error">{error.message || 'This file could not be loaded.'}</p>}
        {!error && !url && <span className="spinner" aria-label="Loading" />}
        {!error && url && kind === 'image' && <ZoomableImage src={url} alt={attachment.fileName} onError={onMediaError} />}
        {!error && url && kind === 'video' && (
          // Streams with range requests: playback starts before the whole file is downloaded.
          <video className="viewer-video" src={url} controls autoPlay playsInline preload="metadata" onError={onMediaError} />
        )}
        {!error && url && kind === 'audio' && <audio src={url} controls autoPlay onError={onMediaError} />}
        {!error && kind === 'document' && (
          pdfInline && url ? (
            <iframe className="viewer-pdf" src={url} title={attachment.fileName} />
          ) : (
            <div className="viewer-doc">
              <span className="viewer-doc-icon"><FileText size={44} aria-hidden /></span>
              <strong className="viewer-doc-name">{attachment.fileName}</strong>
              <span className="viewer-doc-meta">{documentTypeLabel(attachment.mimeType)} · {fileSize(attachment.sizeBytes)}</span>
              <p className="viewer-doc-note">A preview isn’t available for this file type in the app. Open it with another app, download it, or share it.</p>
              <div className="viewer-doc-actions">
                <button type="button" className="btn btn-primary" onClick={openExternally} disabled={!url}><ExternalLink size={17} aria-hidden /> Open</button>
                <button type="button" className="btn btn-secondary" onClick={download} disabled={Boolean(busy)}><Download size={17} aria-hidden /> Download</button>
                <button type="button" className="btn btn-secondary" onClick={share} disabled={Boolean(busy)}><Share2 size={17} aria-hidden /> Share</button>
              </div>
            </div>
          )
        )}
      </div>
    </div>,
    document.body,
  );
}
