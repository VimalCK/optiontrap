import { describe, it, expect } from 'vitest';
import type { StrikeBiasSummary, TradeSetupChecklistItem } from './types';
import {
  summarizePriceTrend,
  summarizeTradeBias,
  readinessScore,
  sortChecklistByStatus,
  checklistStatusText,
  setupReadinessLabel,
  setupReadinessWidth,
  distancePct,
  summarizeTradeLevels,
  classifyPattern,
  patternColor,
  expiryLabel,
  computeMonthlyExpiries,
} from './analysis';

const trend = (prices: number[]) => {
  const dates = prices.map((_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  return summarizePriceTrend(dates, new Map(dates.map((date, i) => [date, prices[i]])));
};

const flow = (bias: StrikeBiasSummary['bias'], strength: StrikeBiasSummary['strength'] = 'Strong') =>
  ({ bias, strength }) as StrikeBiasSummary;

const item = (status: TradeSetupChecklistItem['status'], label: string = status): TradeSetupChecklistItem => ({ label, status, answer: '' });

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

describe('checklist helpers', () => {
  it('scores pass as 1 and warn as 0.5', () => {
    expect(readinessScore([])).toBe(0);
    expect(readinessScore([item('pass'), item('warn'), item('fail')])).toBe(50);
    expect(readinessScore([item('pass'), item('pass'), item('warn')])).toBe(83);
  });

  it('sorts pass, warn, fail without mutating the input', () => {
    const items = [item('fail', 'a'), item('pass', 'b'), item('warn', 'c'), item('pass', 'd')];
    expect(sortChecklistByStatus(items).map((i) => i.label)).toEqual(['b', 'd', 'c', 'a']);
    expect(items.map((i) => i.label)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('labels statuses and readiness', () => {
    expect(checklistStatusText('pass')).toBe('Yes');
    expect(checklistStatusText('warn')).toBe('Wait');
    expect(checklistStatusText('fail')).toBe('No');
    expect(setupReadinessLabel('Avoid', 80)).toBe('No setup');
    expect(setupReadinessLabel('Watch', 80)).toBe('80%');
    expect(setupReadinessWidth('Avoid', 80)).toBe('0%');
    expect(setupReadinessWidth('Confirmed', 95)).toBe('95%');
  });
});

describe('distancePct', () => {
  it('returns null for missing values', () => {
    expect(distancePct(null, 100)).toBeNull();
    expect(distancePct(0, 100)).toBeNull();
    expect(distancePct(100, null)).toBeNull();
    expect(distancePct(100, 101)).toBeCloseTo(1);
  });
});

describe('summarizeTradeLevels', () => {
  const rows = [
    { strike: 22300, ceConsolidatedOi: 0, peConsolidatedOi: 900 },
    { strike: 22400, ceConsolidatedOi: 100, peConsolidatedOi: 1500 },
    { strike: 22500, ceConsolidatedOi: 2000, peConsolidatedOi: 300 },
    { strike: 22600, ceConsolidatedOi: 1200, peConsolidatedOi: 0 },
  ];

  it('picks support from PE OI below spot and resistance from CE OI above', () => {
    const result = summarizeTradeLevels(rows, 22450, 22450);
    expect(result.supportStrike).toBe(22400);
    expect(result.resistanceStrike).toBe(22500);
    expect(result.maxOiStrike).toBe(22500);
    expect(result.locationStatus).toBe('pass');
    expect(result.riskRewardStatus).toBe('pass');
  });

  it('grades a strike far from spot', () => {
    // 22600 is ~0.67% above 22450 → warn; 22700 is ~1.1% → fail
    expect(summarizeTradeLevels(rows, 22450, 22600).locationStatus).toBe('warn');
    expect(summarizeTradeLevels(rows, 22450, 22700).locationStatus).toBe('fail');
  });

  it('warns when spot or rows are missing', () => {
    expect(summarizeTradeLevels(rows, null, 22500)).toMatchObject({ locationStatus: 'warn', supportStrike: null });
    expect(summarizeTradeLevels([], 22450, 22500)).toMatchObject({ riskRewardStatus: 'warn', maxOiStrike: null });
  });
});

describe('classifyPattern', () => {
  type Entry = { oi: number; prevOi: number | undefined; close: number; prevClose: number | undefined };
  const near = '2026-10-27';
  const far = '2026-11-24';
  const map = (entries: Record<string, Entry>) => new Map(Object.entries(entries));

  it('returns a dash when no expiry has data', () => {
    expect(classifyPattern(new Map(), [near, far])).toBe('-');
    expect(classifyPattern(new Map(), [near])).toBe('-');
  });

  it('uses the OI/price quadrant for a single expiry', () => {
    const data = map({ [near]: { oi: 1100, prevOi: 1000, close: 105, prevClose: 100 } });
    expect(classifyPattern(data, [near])).toBe('Long Buildup');
  });

  it('detects rolling over: near OI falling, far OI rising', () => {
    const data = map({
      [near]: { oi: 800, prevOi: 1000, close: 110, prevClose: 100 },
      [far]: { oi: 600, prevOi: 400, close: 105, prevClose: 100 },
    });
    expect(classifyPattern(data, [near, far])).toBe('Rolling Over (Long)');
  });

  it('detects unwinding: both near and far OI falling', () => {
    const data = map({
      [near]: { oi: 800, prevOi: 1000, close: 100, prevClose: 100 },
      [far]: { oi: 300, prevOi: 400, close: 100, prevClose: 100 },
    });
    expect(classifyPattern(data, [near, far])).toBe('Unwinding');
  });

  it('detects doubling down and a fresh build', () => {
    expect(classifyPattern(map({
      [near]: { oi: 1200, prevOi: 1000, close: 90, prevClose: 100 },
      [far]: { oi: 500, prevOi: 400, close: 95, prevClose: 100 },
    }), [near, far])).toBe('Doubling Down (Short)');

    // Far expiry has no data → judged on the near expiry alone
    expect(classifyPattern(map({
      [near]: { oi: 1200, prevOi: 1000, close: 100, prevClose: 100 },
    }), [near, far])).toBe('Fresh Build');
  });

  it('treats a new far position as rising', () => {
    const data = map({
      [near]: { oi: 1000, prevOi: 1000, close: 100, prevClose: 100 },
      [far]: { oi: 500, prevOi: undefined, close: 100, prevClose: undefined },
    });
    expect(classifyPattern(data, [near, far])).toBe('Fresh Build');
  });
});

describe('labels', () => {
  it('colours patterns by meaning', () => {
    expect(patternColor('Rolling Over (Long)')).toBe('var(--accent)');
    expect(patternColor('Exiting (Long Unwind)')).toBe('#ef4444');
    expect(patternColor('Long Buildup')).toBe('#22c55e');
    expect(patternColor('Stable')).toBe('var(--text-secondary)');
  });

  it('formats expiry labels with a monthly marker', () => {
    expect(expiryLabel('2026-07-07', true)).toBe('Jul 7 (M)');
    expect(expiryLabel('2026-10-20', false)).toBe('Oct 20');
  });
});

describe('computeMonthlyExpiries', () => {
  it('keeps the last expiry of each month, whatever the input order', () => {
    const monthly = computeMonthlyExpiries(['2026-11-03', '2026-10-27', '2026-10-06', '2026-11-24', '2026-10-13']);
    expect([...monthly].sort()).toEqual(['2026-10-27', '2026-11-24']);
  });
});
