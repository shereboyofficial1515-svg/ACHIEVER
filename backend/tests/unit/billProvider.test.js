import { describe, expect, it } from 'vitest';
import { __test__, vtpassRequestId } from '../../src/integrations/bills/vtpassProvider.js';
import { disabledProvider } from '../../src/integrations/bills/disabledProvider.js';

const { mapPurchase } = __test__;

describe('VTpass response mapping', () => {
  it('treats delivered transactions as delivered and extracts the token', () => {
    const r = mapPurchase({ json: { code: '000', content: { transactions: { status: 'delivered', transactionId: 99 } }, purchased_code: 'Token : 1234-5678', units: '20kWh' } });
    expect(r).toMatchObject({ outcome: 'delivered', providerReference: '99', token: '1234-5678', units: '20kWh' });
  });

  it('treats pending/initiated as processing (requery later)', () => {
    expect(mapPurchase({ json: { code: '099', content: { transactions: { status: 'pending' } } } }).outcome).toBe('processing');
    expect(mapPurchase({ json: { code: '000', content: { transactions: { status: 'initiated' } } } }).outcome).toBe('processing');
  });

  it('treats network failures as UNKNOWN (processing), never as failed', () => {
    const r = mapPurchase({ networkError: true, json: null });
    expect(r.outcome).toBe('processing');
    expect(r.retryable).toBe(true);
  });

  it('treats explicit failures as failed so a refund is issued', () => {
    expect(mapPurchase({ json: { code: '016', response_description: 'TRANSACTION FAILED', content: { transactions: { status: 'failed' } } } }).outcome).toBe('failed');
    expect(mapPurchase({ json: { code: '011', response_description: 'INVALID ARGUMENTS' } }).outcome).toBe('failed');
  });

  it('builds request ids prefixed with the Lagos timestamp', () => {
    expect(vtpassRequestId('abc')).toMatch(/^\d{12}abc$/);
  });
});

describe('disabled provider', () => {
  it('refuses to operate instead of pretending to deliver', () => {
    expect(disabledProvider.enabled).toBe(false);
    expect(() => disabledProvider.purchase()).toThrow(/not yet available/);
  });
});
