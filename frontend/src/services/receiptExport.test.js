import { describe, expect, it } from 'vitest';
import { bankReceiptModel, billReceiptModel, buildReceiptPdf, pdfText, receiptBlocker, receiptFilename, validatePdf, validatePng, walletReceiptModel } from './receiptExport.js';

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

describe('bill receipts (from GET /bills/history/:id/receipt)', () => {
  const electricity = {
    reference: 'ACH-BILL-261008-2B91AA04', categoryKey: 'electricity', category: 'Electricity', provider: 'Ikeja Electric', product: null,
    recipient: '••••••8842', recipientLabel: 'Meter number', customerName: 'Ada O.', meterType: 'Prepaid', units: '64.3 kWh', validity: null,
    quantity: 1, subscriptionType: null, amount: 1_000_000, fee: 0, total: 1_000_000, status: 'SUCCESS', providerReference: '99881122',
    paymentReference: null, paidWith: 'ACHIEVER Wallet', supportEmail: null, createdAt: '2026-10-08T18:40:00Z', completedAt: '2026-10-08T18:41:00Z',
  };

  it('electricity: service-specific rows in naira; missing values are left out, never invented', () => {
    const m = billReceiptModel(electricity);
    expect(m).toMatchObject({ status: 'SUCCESS', title: 'Electricity Payment', amount: '₦10,000.00', reference: electricity.reference, footer: null });
    expect(m.rows).toEqual(expect.arrayContaining([
      ['Distribution company', 'Ikeja Electric'], ['Meter number', '••••••8842'], ['Meter type', 'Prepaid'], ['Units', '64.3 kWh'],
      ['Total paid', '₦10,000.00'], ['Provider reference', '99881122'], ['Paid with', 'ACHIEVER Wallet'],
    ]));
    const labels = m.rows.map(([l]) => l);
    expect(labels).not.toContain('Payment reference');   // null on the server -> not printed
    expect(labels).not.toContain('Token');               // never on a receipt unless revealed and chosen
    expect(JSON.stringify(m.rows)).not.toMatch(/undefined|null/);
  });

  it('the token / PINs appear only when passed in (revealed by the owner and chosen for the receipt)', () => {
    expect(billReceiptModel(electricity, { secrets: { token: '1234-5678' } }).rows).toContainEqual(['Token', '1234-5678']);
    const exam = billReceiptModel({ ...electricity, categoryKey: 'education', provider: 'WAEC', product: 'Result Checker PIN', meterType: null, units: null, quantity: 2 },
      { secrets: { pins: [{ serial: 'S1', pin: '111' }, { pin: '222' }] } });
    expect(exam.title).toBe('Exam PIN Purchase');
    expect(exam.rows).toEqual(expect.arrayContaining([['Product', 'Result Checker PIN'], ['Quantity', '2'], ['PIN 1', '111 (Serial S1)'], ['PIN 2', '222']]));
  });

  it('data: network, plan, validity and number; a pending or failed purchase never gets a receipt', () => {
    const d = billReceiptModel({ ...electricity, categoryKey: 'data', provider: 'MTN Data', product: 'MTN 10GB 30 days', validity: '30 days', recipient: '08031234567', recipientLabel: 'Phone number', meterType: null, units: null, customerName: null });
    expect(d.rows.slice(0, 4)).toEqual([['Network', 'MTN Data'], ['Data plan', 'MTN 10GB 30 days'], ['Validity', '30 days'], ['Phone number', '08031234567']]);
    for (const status of ['PROCESSING', 'PENDING', 'FAILED', 'REFUNDED', 'REVERSED']) {
      const m = billReceiptModel({ ...electricity, status });
      expect(receiptBlocker(m.status)).not.toBeNull();
      expect(m.rows).toContainEqual(['Total', '₦10,000.00']);   // not "Total paid" for an unsuccessful purchase
    }
  });

  it('the PDF is valid, fits a long receipt and contains the reference, total and recipient', () => {
    const m = billReceiptModel({ ...electricity, supportEmail: 'help@achieverng.site' }, { secrets: { token: '1234-5678-9012-3456-7890' } });
    const bytes = buildReceiptPdf(m);
    expect(validatePdf(bytes, m)).toBe(true);
    const s = new TextDecoder('latin1').decode(bytes);
    expect(s).toContain('Need help? help@achieverng.site');
    const ys = [...s.matchAll(/1 0 0 1 [\d.]+ (-?[\d.]+) Tm/g)].map((x) => Number(x[1]));
    expect(Math.min(...ys)).toBeGreaterThan(0);   // nothing is drawn below the page
  });
});
