import { describe, it, expect } from 'vitest';
import { computeMonthlyExpiries, expiryLabel } from './expiries';

describe('computeMonthlyExpiries', () => {
  it('keeps the last expiry of each month, whatever the input order', () => {
    const monthly = computeMonthlyExpiries(['2026-11-03', '2026-10-27', '2026-10-06', '2026-11-24', '2026-10-13']);
    expect([...monthly].sort()).toEqual(['2026-10-27', '2026-11-24']);
  });
});

describe('expiryLabel', () => {
  it('formats expiry labels with a monthly marker', () => {
    expect(expiryLabel('2026-07-07', true)).toBe('7 Jul (M)');
    expect(expiryLabel('2026-10-20', false)).toBe('20 Oct');
  });
});
