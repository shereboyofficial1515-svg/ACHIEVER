import { describe, expect, it } from 'vitest';
import { describeFee, exampleFee } from './fees.js';

const base = { enabled: true, fixedAmount: 0, percentage: 0, tiers: [], minimumFee: null, maximumFee: null, feeBearingMode: 'FEE_ADDED' };

describe('admin fee examples (illustration of the server rules)', () => {
  it('percentage with minimum and cap', () => {
    const f = { ...base, feeType: 'PERCENTAGE', percentage: 0.5, minimumFee: 5000, maximumFee: 50000 };
    expect(exampleFee(f, 500000).fee).toBe(5000);       // ₦5,000 → minimum ₦50
    expect(exampleFee(f, 10000000).fee).toBe(50000);    // ₦100,000 → capped at ₦500
  });
  it('tiers and fee-included', () => {
    const f = { ...base, feeType: 'TIERED', feeBearingMode: 'FEE_INCLUDED', tiers: [{ min: 0, max: 1000000, fixed: 5000 }, { min: 1000001, max: null, fixed: 10000 }] };
    expect(exampleFee(f, 1000000)).toEqual({ fee: 5000, total: 1000000, receives: 995000 });
    expect(exampleFee(f, 2000000).fee).toBe(10000);
  });
  it('describes fees for the table', () => {
    expect(describeFee({ ...base, feeType: 'FIXED_PLUS_PERCENTAGE', fixedAmount: 5000, percentage: 1 })).toBe('₦50.00 + 1%');
    expect(describeFee({ ...base, feeType: 'FIXED', enabled: false })).toBe('No fee (disabled)');
  });
});
