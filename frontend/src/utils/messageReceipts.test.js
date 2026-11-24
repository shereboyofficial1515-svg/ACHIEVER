import { describe, expect, it } from 'vitest';
import { PREVIEW, messagePreview, messageReceipt } from './messages.js';

const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('long message preview', () => {
  it('short messages are shown in full', () => {
    expect(messagePreview('Hello 👋')).toBeNull();
    expect(messagePreview('a'.repeat(PREVIEW.maxChars))).toBeNull();
    expect(messagePreview(Array.from({ length: PREVIEW.maxLines }, () => 'line').join('\n'))).toBeNull();
  });

  it('a long message is cut at a word boundary, never mid-word', () => {
    const text = words(200);
    const p = messagePreview(text);
    expect(p.length).toBeLessThanOrEqual(PREVIEW.previewChars);
    expect(text.startsWith(p)).toBe(true);
    expect(text[p.length]).toBe(' ');   // the next character is the space after a whole word
  });

  it('many short lines collapse to the first lines, keeping the line breaks', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`).join('\n');
    const p = messagePreview(text);
    expect(p.split('\n')).toHaveLength(PREVIEW.previewLines);
    expect(p.endsWith(`Line ${PREVIEW.previewLines}`)).toBe(true);
  });

  it('never splits an emoji (including joined sequences and skin tones)', () => {
    const family = '👨‍👩‍👧‍👦';
    const text = `${'x'.repeat(PREVIEW.previewChars - 3)}${family.repeat(80)}`;
    const p = messagePreview(text);
    const rest = text.slice(p.length);
    expect(rest.startsWith(family)).toBe(true);
    expect(`${p}${rest}`).toBe(text);
  });

  it('never cuts inside a link', () => {
    const url = 'https://achieverng.site/app/osusu/very/long/path/that/goes/on/and/on';
    const text = `${words(60)} ${url} ${words(200)}`;
    const p = messagePreview(text, { ...PREVIEW, previewChars: text.indexOf(url) + 20 });
    expect(p.includes('https://')).toBe(false);
    expect(text.slice(p.length).trimStart().startsWith(url)).toBe(true);
  });
});

describe('message receipts', () => {
  const base = { id: 'm1', createdAt: '2026-11-24T10:00:00.000Z' };
  const after = '2026-11-24T10:00:05.000Z';
  const before = '2026-11-24T09:59:00.000Z';
  const ada = (over = {}) => ({ id: 'ada', name: 'Ada', avatarUrl: 'a.jpg', sharesReceipts: true, lastDeliveredAt: null, lastReadAt: null, ...over });
  const me = { id: 'me', sharesReceipts: true, lastReadAt: after, lastDeliveredAt: after };

  it('sending until the server accepts it', () => {
    expect(messageReceipt({ ...base, pending: true }, [me, ada()], 'me').status).toBe('sending');
  });

  it('sent (one tick) when the recipient has not received it', () => {
    expect(messageReceipt(base, [me, ada({ lastDeliveredAt: before })], 'me')).toEqual({ status: 'sent', readers: [] });
  });

  it('delivered (two grey ticks) is never shown as read, even if the recipient is online', () => {
    const r = messageReceipt(base, [me, ada({ lastDeliveredAt: after, lastReadAt: before, online: true })], 'me');
    expect(r).toEqual({ status: 'delivered', readers: [] });
  });

  it('read only after the recipient viewed it, with their avatar', () => {
    const r = messageReceipt(base, [me, ada({ lastDeliveredAt: after, lastReadAt: after })], 'me');
    expect(r.status).toBe('read');
    expect(r.readers.map((x) => x.id)).toEqual(['ada']);
  });

  it('a recipient who hides read receipts can show delivered but never read', () => {
    const r = messageReceipt(base, [me, ada({ sharesReceipts: false, lastReadAt: null, lastDeliveredAt: after })], 'me');
    expect(r).toEqual({ status: 'delivered', readers: [] });
  });

  it('groups: readers so far are listed; "read" only when everyone has read', () => {
    const members = [me, ada({ lastReadAt: after, lastDeliveredAt: after }), ada({ id: 'bo', lastDeliveredAt: after }), ada({ id: 'cy', lastDeliveredAt: before })];
    const r = messageReceipt(base, members, 'me');
    expect(r.status).toBe('sent');            // cy has not received it
    expect(r.readers.map((x) => x.id)).toEqual(['ada']);
  });

  it('a group that hides its member list only ever claims "sent"', () => {
    const r = messageReceipt(base, [me, ada({ lastReadAt: after, lastDeliveredAt: after })], 'me', { membersKnown: false });
    expect(r).toEqual({ status: 'sent', readers: [] });
  });
});
