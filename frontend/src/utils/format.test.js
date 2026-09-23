import { describe, expect, it } from 'vitest';
import { commissionLabel, koboToNairaInput, parseNairaToKobo } from './format.js';

describe('money parsing', () => {
  it('parses naira input to integer kobo without float error', () => {
    expect(parseNairaToKobo('20,000')).toBe(2_000_000);
    expect(parseNairaToKobo('₦1,234.5')).toBe(123_450);
    expect(parseNairaToKobo('0.29')).toBe(29);
    expect(parseNairaToKobo('19.99')).toBe(1999);
  });

  it('rejects invalid input', () => {
    expect(parseNairaToKobo('abc')).toBeNull();
    expect(parseNairaToKobo('1.234')).toBeNull();
    expect(parseNairaToKobo('-5')).toBeNull();
    expect(parseNairaToKobo('')).toBeNull();
  });

  it('round-trips kobo back to an input value', () => {
    expect(koboToNairaInput(2_000_000)).toBe('20000');
    expect(koboToNairaInput(123_450)).toBe('1234.50');
  });

  it('labels commission terms', () => {
    expect(commissionLabel('percentage', 300)).toBe('3% of savings');
    expect(commissionLabel('percentage', 250)).toBe('2.50% of savings');
  });
});
