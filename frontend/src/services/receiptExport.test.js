import { describe, expect, it } from 'vitest';
import { bankReceiptModel, buildReceiptPdf, pdfText, receiptBlocker, receiptFilename, validatePdf, validatePng, walletReceiptModel } from './receiptExport.js';

const sent = {
  id: 't1', type: 'transfer', direction: 'debit', status: 'success', label: 'Money sent', reference: 'ACH-WTX-261002-ABC123',
  amount: 1_005_000, principal: 1_000_000, fee: 5_000, createdAt: '2026-10-02T16:40:00Z', completedAt: '2026-10-02T16:40:00Z',
  counterparty: { displayName: 'Aisha Peter', name: 'Aisha Peter', walletId: 'ACH6LG58HCRFYRD3PF8', avatarUrl: null }, note: 'Lunch',
};

describe('receipt model (from the server transaction)', () => {
  it('internal transfer: full recipient name and wallet ID, amount / fee / total debit', () => {
    const m = walletReceiptModel(sent);
    expect(m).toMatchObject({ status: 'SUCCESS', title: 'Money Sent', amount: '₦10,000.00', reference: 'ACH-WTX-261002-ABC123' });
    expect(m.rows).toEqual(expect.arrayContaining([
      ['Recipient', 'Aisha Peter'], ['ACHIEVER Wallet', 'ACH6LG58HCRFYRD3PF8'], ['Amount', '₦10,000.00'], ['Fee', '₦50.00'], ['Total Debit', '₦10,050.00'], ['Paid with', 'ACHIEVER Wallet'],
    ]));
    expect(JSON.stringify(m)).not.toMatch(/\*/);
  });
  it('only successful transactions get a receipt', () => {
    expect(receiptBlocker('success')).toBeNull();
    expect(receiptBlocker('SUCCESS')).toBeNull();
    expect(receiptBlocker('PENDING')).toBe('Transaction is still processing.');
    expect(receiptBlocker('PROCESSING')).toBe('Transaction is still processing.');
    expect(receiptBlocker('failed')).toBe('This transaction does not have a successful receipt.');
    expect(receiptBlocker('REVERSED')).toBe('Transaction Reversed.');
  });
  it('bank transfer model and file names', () => {
    const m = bankReceiptModel({ status: 'SUCCESS', reference: 'ACH-WBT-1', accountName: 'ADA OKAFOR', bankName: 'GTBank', accountNumber: '******6789', amount: 10000, fee: 10000, totalDebit: 20000, recipientAmount: 10000, createdAt: '2026-10-02T10:00:00Z' });
    expect(m.rows[0]).toEqual(['Recipient', 'ADA OKAFOR']);
    expect(receiptFilename(m, 'pdf')).toBe('ACHIEVER-Receipt-ACH-WBT-1.pdf');
  });
});

describe('PDF receipt (a real file, no print dialog)', () => {
  it('is a valid PDF that contains the reference, recipient and amount', () => {
    const m = walletReceiptModel(sent);
    const bytes = buildReceiptPdf(m);
    const s = new TextDecoder('latin1').decode(bytes);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('(Aisha Peter)');
    expect(s).toContain('(ACH-WTX-261002-ABC123)');
    expect(s).toContain('(NGN 10,000.00)');
    expect(s).toContain('(ACH6LG58HCRFYRD3PF8)');
    expect(validatePdf(bytes, m)).toBe(true);
    // the cross-reference offsets point at real objects
    const startxref = Number(/startxref\n(\d+)/.exec(s)[1]);
    expect(s.slice(startxref, startxref + 4)).toBe('xref');
    const firstObj = Number(/0000000000 65535 f \n(\d{10})/.exec(s)[1]);
    expect(s.slice(firstObj, firstObj + 7)).toBe('1 0 obj');
  });
  it('long names wrap onto more lines instead of being cut or masked', () => {
    const long = 'Oluwaseun Adebayo-Williams Chukwuemeka Babatunde Okonkwo-Ibrahim';
    const m = walletReceiptModel({ ...sent, counterparty: { ...sent.counterparty, displayName: long } });
    const s = new TextDecoder('latin1').decode(buildReceiptPdf(m));
    for (const word of long.split(' ')) expect(s).toContain(word);
    expect(s).not.toContain('*');
  });
  it('escapes PDF special characters and replaces ₦', () => {
    expect(pdfText('₦5 (fee) \\ x')).toBe('NGN 5 \\(fee\\) \\\\ x');
  });
  it('a broken or empty file fails validation', () => {
    const m = walletReceiptModel(sent);
    expect(validatePdf(new Uint8Array(0), m)).toBe(false);
    expect(validatePdf(new TextEncoder().encode('<html>not a pdf</html>'.repeat(20)), m)).toBe(false);
  });
});

describe('PNG validation', () => {
  it('checks the PNG signature and size', async () => {
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])], { type: 'image/png' });
    expect(await validatePng(png)).toBe(true);
    expect(await validatePng(new Blob([], { type: 'image/png' }))).toBe(false);
    expect(await validatePng(new Blob(['GIF89a....'], { type: 'image/png' }))).toBe(false);
    expect(await validatePng(null)).toBe(false);
  });
});
