import { describe, expect, it } from 'vitest';
import { calcCollectorCommission, cycleDueDate, formatNaira, osusuCycleFigures } from '../../src/utils/money.js';

describe('Osusu cycle arithmetic', () => {
  it('computes the pooled payout for 10 members at ₦20,000', () => {
    const f = osusuCycleFigures({ contributionAmount: 2_000_000, memberCount: 10, paidCount: 10 });
    expect(f.expected).toBe(20_000_000); // ₦200,000 in kobo
    expect(f.outstanding).toBe(0);
    expect(f.funded).toBe(true);
  });

  it('reports outstanding amounts and unpaid members mid-cycle', () => {
    const f = osusuCycleFigures({ contributionAmount: 2_000_000, memberCount: 10, paidCount: 7 });
    expect(f.collected).toBe(14_000_000);
    expect(f.outstanding).toBe(6_000_000);
    expect(f.unpaidCount).toBe(3);
    expect(f.funded).toBe(false);
  });

  it('schedules weekly, biweekly and daily due dates', () => {
    expect(cycleDueDate('2026-10-05', 'weekly', 1)).toBe('2026-10-05');
    expect(cycleDueDate('2026-10-05', 'weekly', 3)).toBe('2026-10-19');
    expect(cycleDueDate('2026-10-05', 'biweekly', 2)).toBe('2026-10-19');
    expect(cycleDueDate('2026-12-30', 'daily', 4)).toBe('2027-01-02');
  });

  it('clamps monthly due dates to the end of shorter months', () => {
    expect(cycleDueDate('2027-01-31', 'monthly', 2)).toBe('2027-02-28');
    expect(cycleDueDate('2027-01-31', 'monthly', 3)).toBe('2027-03-31');
  });
});

describe('Collector commission', () => {
  it('applies percentage commission in basis points of total contributed', () => {
    // 3.33% of ₦90,000 = ₦2,997
    expect(calcCollectorCommission({ type: 'percentage', value: 333, totalContributed: 9_000_000, balance: 9_000_000 })).toBe(299_700);
  });

  it('floors fractional kobo so the saver is never under-paid', () => {
    expect(calcCollectorCommission({ type: 'percentage', value: 150, totalContributed: 333, balance: 333 })).toBe(4);
  });

  it('applies fixed commission', () => {
    expect(calcCollectorCommission({ type: 'fixed', value: 150_000, totalContributed: 5_000_000, balance: 5_000_000 })).toBe(150_000);
  });

  it('never exceeds the balance held', () => {
    expect(calcCollectorCommission({ type: 'fixed', value: 500_000, totalContributed: 200_000, balance: 200_000 })).toBe(200_000);
  });

  it('is zero when nothing was saved', () => {
    expect(calcCollectorCommission({ type: 'percentage', value: 500, totalContributed: 0, balance: 0 })).toBe(0);
  });
});

describe('formatNaira', () => {
  it('formats kobo as naira', () => {
    expect(formatNaira(2_000_000)).toBe('₦20,000.00');
    expect(formatNaira(5)).toBe('₦0.05');
  });
});
