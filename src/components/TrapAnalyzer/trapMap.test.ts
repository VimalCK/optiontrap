import { describe, it, expect } from 'vitest';
import { isLabelledStrike, strikeLabelStep } from './trapMap';
import type { OptionChainRow } from '@/services/optionChain';

/** 31 strikes, as the map shows, `gap` apart from `first`. */
const chainOf = (first: number, gap: number): OptionChainRow[] =>
  Array.from({ length: 31 }, (_, i) => ({ strike: first + i * gap, ce: null, pe: null }));

const labelled = (chain: OptionChainRow[]) => {
  const step = strikeLabelStep(chain);
  return chain.map((row) => row.strike).filter((strike) => isLabelledStrike(strike, step));
};

describe('strike labels on the trap map', () => {
  it('labels every 100 on a chain 50 apart, as before', () => {
    const strikes = labelled(chainOf(24250, 50));
    expect(strikes[0]).toBe(24300);
    expect(strikes.every((strike) => strike % 100 === 0)).toBe(true);
    expect(strikes).toHaveLength(15);
  });

  it('labels a low-priced stock\'s strikes, which are never multiples of 100', () => {
    const strikes = labelled(chainOf(40, 2.5));
    expect(strikes.length).toBeGreaterThan(5);
    expect(strikes.length).toBeLessThanOrEqual(16);
    expect(strikes).toContain(50);
    expect(strikes).toContain(60);
  });

  it('thins out a chain 100 apart so the labels don\'t overlap', () => {
    expect(labelled(chainOf(61000, 100)).length).toBeLessThanOrEqual(16);
  });
});
