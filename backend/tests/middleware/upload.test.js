import { describe, expect, it } from 'vitest';
import { plainText } from '../../src/middleware/upload.js';
import { UPLOAD_LIMITS } from '../../src/config/constants.js';

const file = (name, content) => ({ originalname: name, buffer: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8') });

describe('plain-text attachments', () => {
  it('accepts a real UTF-8 .txt file', () => {
    expect(plainText(file('notes.txt', 'Contribution list\nAda — ₦20,000\n'), UPLOAD_LIMITS.attachment)).toEqual({ mime: 'text/plain', ext: 'txt' });
  });

  it('rejects binaries renamed to .txt, other extensions, and uploads that do not allow text', () => {
    expect(plainText(file('virus.txt', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03])), UPLOAD_LIMITS.attachment)).toBeNull();
    expect(plainText(file('script.js', 'alert(1)'), UPLOAD_LIMITS.attachment)).toBeNull();
    expect(plainText(file('id.txt', 'hello'), UPLOAD_LIMITS.verificationDocument)).toBeNull();
  });
});
