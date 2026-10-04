// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mergeMessages } from './messages.js';
import { soundAllowed } from './sounds.js';
import { prepareFiles } from '../components/media/AttachmentComposer.jsx';

const m = (id, createdAt, extra = {}) => ({ id, createdAt, ...extra });

describe('mergeMessages', () => {
  it('never duplicates: the same id updates the existing message', () => {
    const list = mergeMessages([m('a', '2026-10-03T10:00:00Z', { body: 'x' })], [m('a', '2026-10-03T10:00:00Z', { body: 'edited' })]);
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe('edited');
  });
  it('keeps created_at order when events arrive out of order, optimistic messages last on ties', () => {
    const list = mergeMessages([m('c', '2026-10-03T10:00:03Z'), m('tmp', '2026-10-03T10:00:02Z', { pending: true })], [m('b', '2026-10-03T10:00:02Z'), m('a', '2026-10-03T10:00:01Z')]);
    expect(list.map((x) => x.id)).toEqual(['a', 'b', 'tmp', 'c']);
  });
});

describe('message sound settings', () => {
  it('defaults on; master switch silences chat sounds; sleep mode silences everything non-critical', () => {
    expect(soundAllowed('incoming', {})).toBe(true);
    expect(soundAllowed('outgoing', { messageSound: true, outgoingSound: false })).toBe(false);
    expect(soundAllowed('incoming', { messageSound: false, incomingSound: true })).toBe(false);
    expect(soundAllowed('notification', { messageSound: false })).toBe(true);
    for (const kind of ['incoming', 'outgoing', 'notification']) expect(soundAllowed(kind, { sleepMode: true })).toBe(false);
  });
});

describe('attachments are checked before upload', () => {
  const file = (name, type, size = 1000) => new File([new Uint8Array(Math.min(size, 10))], name, { type });
  it('rejects oversized files, old Office formats and the wrong type for the picker', async () => {
    const big = file('big.pdf', 'application/pdf');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    const { files, errors } = await prepareFiles([big, file('old.doc', 'application/msword'), file('ok.pdf', 'application/pdf'), file('song.mp3', 'audio/mpeg')], 'document');
    expect(files.map((f) => f.name)).toEqual(['ok.pdf']);
    expect(errors.join(' ')).toMatch(/10 MB/);
    expect(errors.join(' ')).toMatch(/\.doc, \.xls, \.ppt/);
    expect(errors).toHaveLength(3);
  });
  it('fills in the type for files the phone reports without one (by extension)', async () => {
    const { files } = await prepareFiles([file('slides.pptx', '')], 'document');
    expect(files[0].type).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
  });
});
