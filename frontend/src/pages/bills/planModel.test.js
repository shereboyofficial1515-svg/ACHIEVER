import { describe, expect, it } from 'vitest';
import { detectNetwork, formatPhone, isValidPhone, maskPhone, normalisePlan, planFilters } from './planModel.js';

const plan = (name, amount, validity) => ({ code: name, name, amount, validity });

describe('plan normalisation (real VTpass names)', () => {
  it('volume first, price separate, no repeated network or price text', () => {
    const p = normalisePlan(plan('Glo Data (SME) N320 - 1GB 30 days', 32000, '30 days'), { providerName: 'Glo SME', category: 'data' });
    expect(p).toMatchObject({ title: '1 GB', price: 32000, validity: '30 days', type: 'SME', period: 'Monthly' });
    expect(p.title).not.toMatch(/glo|N320|₦/i);
  });

  it('understands hours, days and special bundles', () => {
    expect(normalisePlan(plan('N100 100MB - 24 hrs', 10000), { category: 'data' })).toMatchObject({ title: '100 MB', validity: '1 day', period: 'Daily', type: 'Regular' });
    expect(normalisePlan(plan('MTN N200 Xtradata', 20000), { category: 'data' })).toMatchObject({ type: 'Special' });
    expect(normalisePlan(plan('9mobile Data - 100 Naira - 100MB - 1 day', 10000), { category: 'data' })).toMatchObject({ title: '100 MB', validity: '1 day' });
  });

  it('non-data bundles keep their own value, drop only the price, and never repeat the name as validity', () => {
    const v = normalisePlan(plan('600 Naira Voice Bundle - N100', 10000), { providerName: 'Airtel', category: 'data' });
    expect(v).toMatchObject({ title: '600 Naira Voice Bundle', validity: null, kind: null, price: 10000 });
  });

  it('packages (TV) keep the provider name without the price', () => {
    expect(normalisePlan(plan('DStv Padi N2,950', 295000), { category: 'tv' })).toMatchObject({ title: 'DStv Padi', type: null, kind: null });
  });

  it('filter chips only include categories actually present', () => {
    const plans = [
      normalisePlan(plan('Glo Data (SME) N320 - 1GB 30 days', 32000), { category: 'data' }),
      normalisePlan(plan('N100 100MB - 24 hrs', 10000), { category: 'data' }),
    ];
    expect(planFilters(plans)).toEqual(['SME', 'Regular', 'Daily', 'Monthly']);
  });
});

describe('Nigerian mobile numbers', () => {
  it('validates and detects the network from the prefix', () => {
    expect(isValidPhone('0701 028 8040')).toBe(true);
    expect(isValidPhone('+2348031234567')).toBe(true);
    expect(isValidPhone('0601234567')).toBe(false);
    expect(detectNetwork('07010288040')).toEqual({ code: 'airtel', name: 'Airtel' });
    expect(detectNetwork('08051234567')).toEqual({ code: 'glo', name: 'Glo' });
    expect(detectNetwork('+2348031234567')).toEqual({ code: 'mtn', name: 'MTN' });
    expect(detectNetwork('08091234567')).toEqual({ code: '9mobile', name: '9mobile' });
  });
  it('formats and masks for display', () => {
    expect(formatPhone('07010288040')).toBe('0701 028 8040');
    expect(maskPhone('07010288040')).toBe('0701 **** 8040');
  });
});
