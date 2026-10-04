import { api } from '../services/api.js';

/**
 * Private chat files are served through short-lived signed URLs (10 minutes, issued by the API
 * only to members of the chat). This cache keeps one URL per attachment until shortly before it
 * expires, so the thumbnail, the full-screen viewer, share and download all use the SAME URL —
 * the browser's HTTP cache then serves the bytes it already has instead of downloading again.
 * Concurrent requests for the same attachment share one API call. Nothing is stored on disk
 * or made public; the cache lives in memory for this session only.
 */
const URL_TTL_MS = 9 * 60 * 1000;   // signed URLs last 10 minutes; refresh a minute early
const urls = new Map();              // attachmentId -> { url, expiresAt } | { promise }
const blobs = new Map();             // attachmentId -> Promise<Blob> (only while in use)

export function attachmentUrl(attachmentId, { force = false } = {}) {
  const hit = urls.get(attachmentId);
  if (!force && hit?.url && hit.expiresAt > Date.now()) return Promise.resolve(hit.url);
  if (!force && hit?.promise) return hit.promise;
  const promise = api.get(`/messages/attachments/${attachmentId}/url`)
    .then(({ data }) => {
      urls.set(attachmentId, { url: data.url, expiresAt: Date.now() + URL_TTL_MS });
      return data.url;
    })
    .catch((err) => {
      urls.delete(attachmentId);
      throw err;
    });
  urls.set(attachmentId, { promise });
  return promise;
}

/** The URL we already have (if still valid), without asking the API. */
export function cachedAttachmentUrl(attachmentId) {
  const hit = urls.get(attachmentId);
  return hit?.url && hit.expiresAt > Date.now() ? hit.url : null;
}

/** The file's bytes (for share / save). Uses the cached URL, so a loaded image is not fetched again. */
export function attachmentBlob(attachmentId) {
  if (!blobs.has(attachmentId)) {
    const p = attachmentUrl(attachmentId)
      .then((u) => fetch(u, { cache: 'force-cache' }))
      .then((r) => {
        if (!r.ok) throw new Error('DOWNLOAD_FAILED');
        return r.blob();
      })
      .finally(() => setTimeout(() => blobs.delete(attachmentId), 60_000));   // don't hold big files in memory
    blobs.set(attachmentId, p);
  }
  return blobs.get(attachmentId);
}

export const mediaKind = (mimeType = '', { voice = false } = {}) => {
  if (voice || mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
};

const DOC_TYPES = {
  'application/pdf': 'PDF document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel spreadsheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint presentation',
  'text/plain': 'Text file',
};
export const documentTypeLabel = (mimeType) => DOC_TYPES[mimeType] || 'File';

/** For tests. */
export function __resetMediaCache() {
  urls.clear();
  blobs.clear();
}
