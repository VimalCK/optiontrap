import { describe, it, expect } from 'vitest';
import type { TradeSignalRow } from './types';
import { summarizeSignalBreakdown, signalVerdict, MIN_SCORED_FOR_VERDICT } from './signalStats';

let nextId = 1;
const signal = (overrides: Partial<TradeSignalRow>): TradeSignalRow => ({
  id: nextId++,
  signal_date: '2026-10-14',
  expiry: '2026-10-19',
  strike: 22700,
  option_type: 'CE',
  action: 'SELL',
  status: 'Confirmed',
  details: null,
  entry_premium: 100,
  outcome_price: null,
  outcome_date: null,
  outcome_status: null,
  outcome_return: null,
  max_favorable_return: null,
  max_adverse_return: null,
  outcome_final: false,
  ...overrides,
});
const win = (ret: number, overrides: Partial<TradeSignalRow> = {}) =>
  signal({ outcome_status: 'Profit', outcome_return: ret, max_adverse_return: -5, ...overrides });
const loss = (ret: number, overrides: Partial<TradeSignalRow> = {}) =>
  signal({ outcome_status: 'Loss', outcome_return: ret, max_adverse_return: -30, ...overrides });

const row = (rows: ReturnType<typeof summarizeSignalBreakdown>, group: string, label: string) =>
  rows.find((r) => r.group === group && r.label === label);

describe('signalVerdict', () => {
  it('needs enough scored signals', () => {
    expect(signalVerdict(MIN_SCORED_FOR_VERDICT - 1, 100, 50)).toBe('Too few');
    expect(signalVerdict(10, null, null)).toBe('Too few');
  });

  it('grades by win rate and average return together', () => {
    expect(signalVerdict(10, 60, 12)).toBe('Working');
    expect(signalVerdict(10, 30, -8)).toBe('Losing');
    expect(signalVerdict(10, 40, 5)).toBe('Mixed');   // few wins but big ones
    expect(signalVerdict(10, 70, -3)).toBe('Mixed');  // many small wins, big losses
    expect(signalVerdict(10, 50, 0)).toBe('Mixed');
  });
});

describe('summarizeSignalBreakdown', () => {
  it('computes win rate, average return and average worst move from scored signals only', () => {
    const rows = summarizeSignalBreakdown([
      win(40), win(20), loss(-30), signal({ outcome_status: 'Open', outcome_return: 10 }), signal({}),
    ]);
    const sell = row(rows, 'Action', 'SELL')!;

    expect(sell.total).toBe(5);
    expect(sell.scored).toBe(3);
    expect(sell.winRate).toBeCloseTo(66.67, 2);
    expect(sell.averageReturn).toBeCloseTo(10);
    expect(sell.averageMaxAdverse).toBeCloseTo((-5 - 5 - 30) / 3);
    expect(sell.verdict).toBe('Too few');
  });

  it('flags a consistently losing setup', () => {
    const rows = summarizeSignalBreakdown([
      ...[1, 2, 3, 4, 5].map(() => loss(-20, { action: 'BUY', option_type: 'PE' })),
      win(10, { action: 'BUY', option_type: 'PE' }),
      ...[1, 2, 3, 4, 5].map(() => win(15)),
    ]);

    expect(row(rows, 'Setup', 'BUY PE')).toMatchObject({ scored: 6, verdict: 'Losing' });
    expect(row(rows, 'Setup', 'SELL CE')).toMatchObject({ scored: 5, winRate: 100, verdict: 'Working' });
  });

  it('keeps groups in order and known labels in their fixed order', () => {
    const rows = summarizeSignalBreakdown([
      signal({ action: 'SELL', status: 'Watch' }),
      signal({ action: 'BUY', status: 'Confirmed' }),
    ]);
    expect(rows.map((r) => `${r.group}: ${r.label}`)).toEqual([
      'Action: BUY',
      'Action: SELL',
      'Setup: BUY CE',
      'Setup: SELL CE',
      'Strength: Confirmed',
      'Strength: Watch',
    ]);
  });

  it('slices by recorded context and skips signals without it', () => {
    const rows = summarizeSignalBreakdown([
      signal({ details: { priceTrend: { direction: 'Downward' }, decay: { daysToExpiry: 1 }, strikePattern: 'Short Buildup', flowBias: 'Downward' } }),
      signal({ details: { priceTrend: { direction: 'Upward' }, decay: { daysToExpiry: 5 } } }),
      signal({ details: { decay: { daysToExpiry: 20 } } }),
      signal({ details: null }),
    ]);

    expect(rows.filter((r) => r.group === 'OI pattern').map((r) => [r.label, r.total])).toEqual([['Short Buildup', 1]]);
    expect(rows.filter((r) => r.group === 'Option flow').map((r) => r.label)).toEqual(['Downward']);
    expect(rows.filter((r) => r.group === 'Price trend').map((r) => r.label)).toEqual(['Upward', 'Downward']);
    expect(rows.filter((r) => r.group === 'Days to expiry').map((r) => r.label)).toEqual(['0–2 days', '3–7 days', '8+ days']);
  });

  it('returns nothing for no signals', () => {
    expect(summarizeSignalBreakdown([])).toEqual([]);
  });
});
