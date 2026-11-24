/** Merge messages by id (update, never duplicate) and keep them in created_at order. */
export function mergeMessages(list, incoming) {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()].sort((a, b) => {
    const d = new Date(a.createdAt) - new Date(b.createdAt);
    if (d) return d;
    if (a.pending !== b.pending) return a.pending ? 1 : -1;   // optimistic messages after saved ones
    return String(a.id).localeCompare(String(b.id));
  });
}

// Long messages ---------------------------------------------------------------------------------
// A message is collapsed only when it is clearly long, so a few characters over never fold away.
export const PREVIEW = { maxChars: 450, previewChars: 320, maxLines: 10, previewLines: 7, wordWindow: 60 };

function graphemes(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
  return Array.from(text);   // code points: never splits a surrogate pair
}

/**
 * The shortened form of a long message, or null when it should be shown in full.
 * The cut never falls inside a word, a link or an emoji (whole grapheme clusters), keeps the
 * original line breaks, and ends at the last whitespace before the limit.
 */
export function messagePreview(text, opts = PREVIEW) {
  if (!text) return null;
  const lines = text.split('\n');
  const tooLong = text.length > opts.maxChars || lines.length > opts.maxLines;
  if (!tooLong) return null;

  let limit = Math.min(text.length, opts.previewChars);
  if (lines.length > opts.maxLines) limit = Math.min(limit, lines.slice(0, opts.previewLines).join('\n').length);

  // Whole grapheme clusters only (emoji with skin tones / ZWJ sequences stay intact).
  let cut = 0;
  for (const g of graphemes(text)) {
    if (cut + g.length > limit) break;
    cut += g.length;
  }
  // Mid-word? Back up to the last whitespace nearby, so no word is cut in half.
  const midWord = cut > 0 && /\S/.test(text[cut] ?? ' ') && /\S/.test(text[cut - 1]);
  if (midWord) {
    const from = Math.max(0, cut - opts.wordWindow);
    const lastSpace = Math.max(...[' ', '\n', '\t'].map((c) => text.lastIndexOf(c, cut - 1)));
    if (lastSpace >= from) cut = lastSpace;   // one very long "word": keep the grapheme-safe cut
  }
  // Never inside a link: if the cut falls within a URL, stop before it.
  const re = /https?:\/\/[^\s<>"']+/g;
  let mm;
  while ((mm = re.exec(text))) {
    if (mm.index < cut && cut < mm.index + mm[0].length) { cut = mm.index; break; }
    if (mm.index >= cut) break;
  }
  const preview = text.slice(0, cut).replace(/\s+$/, '');
  return preview.length > 0 && preview.length < text.length ? preview : null;
}

// Receipts ---------------------------------------------------------------------------------------
const at = (v) => (v ? new Date(v).getTime() : 0);

/**
 * Status of a message I sent, from what the other members report (never invented):
 *   sending   – not yet accepted by the server
 *   sent      – accepted by the server (one tick)
 *   delivered – on every recipient's device (two grey ticks), not necessarily read
 *   read      – every recipient viewed it
 * `readers` are the members who viewed it and share read receipts (shown as avatars).
 * When some members are hidden (a group that hides its member list) only "sent" is claimed.
 */
export function messageReceipt(m, members, currentUserId, { membersKnown = true } = {}) {
  if (m.pending || String(m.id).startsWith('tmp-')) return { status: 'sending', readers: [] };
  const others = members.filter((mm) => mm.id !== currentUserId);
  if (!membersKnown || !others.length) return { status: 'sent', readers: [] };
  const t = at(m.createdAt);
  const readers = others.filter((mm) => mm.sharesReceipts && mm.lastReadAt && at(mm.lastReadAt) >= t);
  const delivered = others.every((mm) => at(mm.lastDeliveredAt) >= t || (mm.lastReadAt && at(mm.lastReadAt) >= t));
  if (readers.length === others.length) return { status: 'read', readers };
  return { status: delivered ? 'delivered' : 'sent', readers };
}
