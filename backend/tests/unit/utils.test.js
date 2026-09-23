import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashIdentityNumber, hashOtp, paystackSignature, randomDigits, safeEqual } from '../../src/utils/crypto.js';
import { toCsv } from '../../src/utils/csv.js';
import { cleanText, escapeHtml, maskPhone, normalizeNigerianPhone, safeFileName } from '../../src/utils/sanitize.js';
import { translateDbError } from '../../src/integrations/supabase/db.js';
import { signSessionStart, readSessionStart } from '../../src/utils/cookies.js';
import { likePattern } from '../../src/utils/pagination.js';

describe('crypto helpers', () => {
  it('computes Paystack HMAC-SHA512 signatures over the raw body', () => {
    const body = Buffer.from('{"event":"charge.success"}');
    const expected = crypto.createHmac('sha512', 'sk_test_dummy').update(body).digest('hex');
    expect(paystackSignature(body, 'sk_test_dummy')).toBe(expected);
  });

  it('never stores identity numbers or OTPs in recoverable form', () => {
    const h = hashIdentityNumber('bvn', '22123456789');
    expect(h).not.toContain('22123456789');
    expect(h).toHaveLength(64);
    expect(hashIdentityNumber('nin', '22123456789')).not.toBe(h);
    expect(hashOtp('u1', 'email_verification', '123456')).not.toBe(hashOtp('u2', 'email_verification', '123456'));
  });

  it('generates numeric codes of the requested length', () => {
    for (let i = 0; i < 20; i += 1) expect(randomDigits(6)).toMatch(/^\d{6}$/);
  });

  it('compares in constant time and handles length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('session cookie signing', () => {
  it('round-trips a signed start time and rejects tampering', () => {
    const v = signSessionStart(1_700_000_000_000);
    expect(readSessionStart(v)).toBe(1_700_000_000_000);
    expect(readSessionStart(v.replace('1700', '1800'))).toBeNull();
    expect(readSessionStart('garbage')).toBeNull();
  });
});

describe('CSV export', () => {
  it('escapes quotes, commas and newlines', () => {
    const csv = toCsv([{ a: 'x,"y"', b: 'line\nbreak' }], [{ label: 'A', key: 'a' }, { label: 'B', key: 'b' }]);
    expect(csv).toBe('A,B\r\n"x,""y""","line\nbreak"');
  });

  it('neutralises spreadsheet formula injection', () => {
    const csv = toCsv([{ a: '=HYPERLINK("http://evil")' }], [{ label: 'A', key: 'a' }]);
    expect(csv.split('\r\n')[1].startsWith('"\'=')).toBe(true);
  });
});

describe('sanitisation', () => {
  it('normalises Nigerian phone numbers to E.164', () => {
    expect(normalizeNigerianPhone('08031234567')).toBe('+2348031234567');
    expect(normalizeNigerianPhone('+234 803 123 4567')).toBe('+2348031234567');
    expect(normalizeNigerianPhone('2349031234567')).toBe('+2349031234567');
    expect(normalizeNigerianPhone('0123')).toBeNull();
    expect(normalizeNigerianPhone('+14155550100')).toBeNull();
  });

  it('strips control characters and escapes HTML', () => {
    expect(cleanText('  hi\u0000there ')).toBe('hithere');
    expect(escapeHtml('<script>"x"</script>')).toBe('&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  });

  it('masks phone numbers and cleans file names', () => {
    expect(maskPhone('+2348031234567')).toBe('+234803****567');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('my <file>.pdf')).toBe('my _file_.pdf');
  });

  it('escapes search wildcards for ilike filters', () => {
    expect(likePattern('50%_off,(x)')).toBe('%50\\%\\_off\\,\\(x\\)%');
  });
});

describe('database error translation', () => {
  it('surfaces business-rule errors raised by SQL functions', () => {
    const e = translateDbError({ message: 'ACH:409:PAYOUT_ALREADY_PROCESSED:This payout has already been approved' });
    expect(e.status).toBe(409);
    expect(e.code).toBe('PAYOUT_ALREADY_PROCESSED');
    expect(e.message).toBe('This payout has already been approved');
  });

  it('hides unexpected database errors', () => {
    const e = translateDbError({ message: 'relation "secret_table" does not exist', code: '42P01' });
    expect(e.status).toBe(500);
    expect(e.expose).toBe(false);
    expect(e.message).not.toContain('secret_table');
  });

  it('maps unique violations to 409', () => {
    expect(translateDbError({ code: '23505', message: 'dup' }).status).toBe(409);
  });
});
