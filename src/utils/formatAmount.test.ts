import { describe, it, expect } from 'vitest';
import { formatAmount, formatSignedAmount } from './formatAmount';

describe('formatAmount', () => {
  it('always shows two decimals', () => {
    expect(formatAmount(41949.5)).toBe('41,949.50');
    expect(formatAmount(17869)).toBe('17,869.00');
    expect(formatAmount(0.125)).toBe('0.13');
  });

  it('groups in lakhs and crores', () => {
    expect(formatAmount(12345678.9)).toBe('1,23,45,678.90');
  });
});

describe('formatSignedAmount', () => {
  it('puts + on gains and zero, and keeps the minus on losses', () => {
    expect(formatSignedAmount(41949.5)).toBe('+41,949.50');
    expect(formatSignedAmount(0)).toBe('+0.00');
    expect(formatSignedAmount(-562622.88)).toBe('-5,62,622.88');
  });
});
