import { describe, it, expect } from 'vitest';
import type { StrikeBiasSummary } from './types';
import { summarizePriceTrend, summarizeTradeBias } from './trendBias';

const trend = (prices: number[]) => {
  const dates = prices.map((_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  return summarizePriceTrend(dates, new Map(dates.map((date, i) => [date, prices[i]])));
};

const flow = (bias: StrikeBiasSummary['bias'], strength: StrikeBiasSummary['strength'] = 'Strong') =>
  ({ bias, strength }) as StrikeBiasSummary;

describe('summarizePriceTrend', () => {
  it('needs at least two positive prices', () => {
    const result = trend([0, 22500]);
    expect(result.direction).toBe('Unknown');
    expect(result.sessions).toBe(1);
    expect(result.startPrice).toBe(22500);
    expect(result.changePct).toBeNull();
  });

  it('grades direction and strength from the overall change', () => {
    expect(trend([100, 101, 103])).toMatchObject({ direction: 'Upward', strength: 'Strong', changePct: 3 });
    expect(trend([100, 98.5])).toMatchObject({ direction: 'Downward', strength: 'Moderate' });
    expect(trend([100, 100.7])).toMatchObject({ direction: 'Upward', strength: 'Mild' });
    expect(trend([100, 100.3])).toMatchObject({ direction: 'Sideways', strength: 'Flat' });
  });

  it('measures the recent change over the last four sessions', () => {
    const result = trend([100, 90, 100, 105, 110]);
    // last four: 90 → 110
    expect(result.recentChangePct).toBeCloseTo(22.22, 2);
    expect(result.sessions).toBe(5);
  });
});

describe('summarizeTradeBias', () => {
  it('agrees when price and option flow point the same way', () => {
    expect(summarizeTradeBias(trend([100, 103]), flow('Upward')).bias).toBe('Bullish');
    expect(summarizeTradeBias(trend([100, 97]), flow('Downward')).bias).toBe('Bearish');
  });

  it('flags a conflict when they disagree', () => {
    expect(summarizeTradeBias(trend([100, 103]), flow('Downward')).bias).toBe('Conflict');
    expect(summarizeTradeBias(trend([100, 97]), flow('Upward')).bias).toBe('Conflict');
  });

  it('follows price when flow is neutral, otherwise stays neutral', () => {
    expect(summarizeTradeBias(trend([100, 103]), flow('Neutral')).title).toBe('Bullish price trend, OI neutral');
    expect(summarizeTradeBias(trend([100, 97]), flow('Neutral')).title).toBe('Bearish price trend, OI neutral');
    expect(summarizeTradeBias(trend([100, 100.1]), flow('Upward')).bias).toBe('Neutral');
  });
});
