import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, FileText, Image as ImageIcon, RotateCcw, SendHorizontal, Video, X } from 'lucide-react';
import { pushOverlay } from '../../platform/overlays.js';
import { documentTypeLabel } from '../../utils/mediaCache.js';
import { fileSize } from '../../utils/format.js';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;   // same limit as the API
export const MAX_VIDEO_SECONDS = 180;
export const MAX_FILES = 10;

/** What each picker accepts (the API checks the real content again). */
export const PICKERS = {
  camera: { accept: 'image/*', capture: 'environment', multiple: false },
  photos: { accept: 'image/jpeg,image/png,image/webp', multiple: true },
  video: { accept: 'video/mp4,video/webm,video/quicktime', multiple: false },
  document: { accept: '.pdf,.docx,.xlsx,.pptx,.txt,application/pdf,text/plain', multiple: true },
};
const ALLOWED = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  document: [
    'application/pdf', 'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
};
const EXT_MIME = { pdf: 'application/pdf', txt: 'text/plain', docx: ALLOWED.document[2], xlsx: ALLOWED.document[3], pptx: ALLOWED.document[4] };
const LEGACY = /\.(doc|xls|ppt)$/i;

export const fileKind = (f) => (f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : 'document');

function videoDuration(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    v.preload = 'metadata';
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    v.src = url;
  });
}

/** Large photos are resized (longest side 2048px, JPEG 85%) before upload: faster on mobile data. */
async function compressImage(file) {
  if (!['image/jpeg', 'image/webp'].includes(file.type) || file.size < 1.5 * 1024 * 1024 || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}

/**
 * Check the chosen files before anything is uploaded.
 * Returns { files: File[], errors: string[] } (files that fail are left out, with a reason).
 */
export async function prepareFiles(list, picker) {
  const errors = [];
  const files = [];
  for (const original of [...list].slice(0, MAX_FILES)) {
    let f = original;
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!f.type && EXT_MIME[ext]) f = new File([f], f.name, { type: EXT_MIME[ext], lastModified: f.lastModified });
    if (LEGACY.test(f.name)) { errors.push(`${f.name}: older Office formats (.doc, .xls, .ppt) are not supported. Save it as .docx, .xlsx, .pptx or PDF.`); continue; }
    const kind = fileKind(f);
    const allowed = picker === 'document' ? ALLOWED.document : picker === 'video' ? ALLOWED.video : ALLOWED.image;
    if (!allowed.includes(f.type)) { errors.push(`${f.name}: this file type can't be sent.`); continue; }
    if (kind === 'image') f = await compressImage(f);
    if (f.size > MAX_ATTACHMENT_BYTES) { errors.push(`${f.name}: files must be 10 MB or smaller (this is ${fileSize(f.size)}).`); continue; }
    if (kind === 'video') {
      const seconds = await videoDuration(f);
      if (seconds && seconds > MAX_VIDEO_SECONDS) { errors.push(`${f.name}: videos can be up to 3 minutes long.`); continue; }
    }
    files.push(f);
  }
  if (list.length > MAX_FILES) errors.push(`You can send up to ${MAX_FILES} files at a time.`);
  return { files, errors };
}

/** The "Attach" sheet: Camera, Photos, Video, Document. */
export function AttachmentSheet({ onPick, onClose }) {
  useEffect(() => pushOverlay(onClose), [onClose]);
  const options = [
    { key: 'camera', label: 'Camera', Icon: Camera },
    { key: 'photos', label: 'Photos', Icon: ImageIcon },
    { key: 'video', label: 'Video', Icon: Video },
    { key: 'document', label: 'Document', Icon: FileText },
  ];
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="attach-sheet" role="dialog" aria-modal="true" aria-label="Attach" onClick={(e) => e.stopPropagation()}>
        <div className="attach-sheet-handle" aria-hidden />
        <strong className="attach-sheet-title">Attach</strong>
        <div className="attach-sheet-grid">
          {options.map(({ key, label, Icon }) => (
            <button key={key} type="button" className={`attach-option tone-${key}`} onClick={() => onPick(key)}>
              <span className="attach-option-icon"><Icon size={24} aria-hidden /></span>
              <span>{label}</span>
            </button>
          ))}
        </div>
        <p className="xsmall muted attach-sheet-note">Photos, videos (up to 3 min) and PDF, Word, Excel, PowerPoint or text files · 10 MB each</p>
      </div>
    </div>,
    document.body,
  );
}

/** Full-screen preview before sending: nothing is uploaded until Send. */
export function SendPreview({ files, picker, onCancel, onRetake, onSend, onRemove }) {
  const [caption, setCaption] = useState('');
  const previews = useMemo(() => files.map((f) => ({ f, kind: fileKind(f), url: fileKind(f) === 'document' ? null : URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => p.url && URL.revokeObjectURL(p.url)), [previews]);
  useEffect(() => pushOverlay(onCancel), [onCancel]);
  const single = previews.length === 1 ? previews[0] : null;

  return createPortal(
    <div className="send-preview" role="dialog" aria-modal="true" aria-label="Send attachment">
      <header className="viewer-top">
        <button type="button" className="viewer-btn" onClick={onCancel} aria-label="Cancel"><X size={22} /></button>
        <div className="viewer-title"><strong>{files.length === 1 ? 'Send 1 file' : `Send ${files.length} files`}</strong></div>
        {picker === 'camera' && <button type="button" className="viewer-btn" onClick={onRetake} aria-label="Retake"><RotateCcw size={20} /></button>}
      </header>
      <div className={`send-preview-body${single ? ' single' : ''}`}>
        {previews.map(({ f, kind, url }, i) => (
          <figure key={`${f.name}-${i}`} className={`send-preview-item kind-${kind}`}>
            {kind === 'image' && <img src={url} alt={f.name} />}
            {kind === 'video' && <video src={url} controls playsInline preload="metadata" />}
            {kind === 'document' && (
              <div className="viewer-doc compact">
                <span className="viewer-doc-icon"><FileText size={36} aria-hidden /></span>
                <strong className="viewer-doc-name">{f.name}</strong>
                <span className="viewer-doc-meta">{documentTypeLabel(f.type)} · {fileSize(f.size)}</span>
              </div>
            )}
            {files.length > 1 && <button type="button" className="send-preview-remove" onClick={() => onRemove(i)} aria-label={`Remove ${f.name}`}><X size={16} /></button>}
            {kind !== 'document' && <figcaption>{fileSize(f.size)}</figcaption>}
          </figure>
        ))}
      </div>
      <form className="send-preview-bar" onSubmit={(e) => { e.preventDefault(); onSend(caption.trim()); }}>
        {files.length === 1 && (
          <input className="input" placeholder="Add a caption" value={caption} maxLength={4000} onChange={(e) => setCaption(e.target.value)} onInput={(e) => setCaption(e.currentTarget.value)} aria-label="Caption" />
        )}
        <button type="submit" className="send-btn" aria-label="Send"><SendHorizontal size={19} /></button>
      </form>
    </div>,
    document.body,
  );
}
