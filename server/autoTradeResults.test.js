import { describe, it, expect } from 'vitest';
import { resultsParams, toResults } from './autoTradeResults.js';

// Rows as the GROUPING SETS query returns them (numbers already parsed).
const row = (dimension, key, trades, pnl, extra = {}) => ({
  dimension, key, trades, wins: 0, losses: 0, pnl, gross_profit: 0, gross_loss: 0, best: pnl, worst: pnl, charges: 0, ...extra,
});

describe('toResults', () => {
  it('puts each grouping row in its breakdown: time and day in order, the rest best P&L first', () => {
    const results = toResults([
      row('all', null, 3, 500, { wins: 2, losses: 1, gross_profit: 2000, gross_loss: 1500, best: 1500, worst: -1500, charges: 170.55 }),
      row('setup', 'Bull put', 2, -1000),
      row('setup', 'Long call', 1, 1500),
      row('exitRule', null, 1, 500),
      row('entrySlot', '810', 1, 500),
      row('entrySlot', '570', 2, 0),
      row('day', '2026-11-10', 1, 500),
      row('day', '2026-11-09', 2, 0),
    ], 1500);

    expect(results.summary).toEqual({ key: null, trades: 3, wins: 2, losses: 1, pnl: 500, grossProfit: 2000, grossLoss: 1500, best: 1500, worst: -1500, charges: 170.55 });
    expect(results.maxDrawdown).toBe(1500);
    expect(results.bySetup.map((g) => g.key)).toEqual(['Long call', 'Bull put']);
    expect(results.byExitRule[0].key).toBeNull(); // exited manually
    expect(results.byEntrySlot.map((g) => g.key)).toEqual([570, 810]); // minutes after IST midnight, as numbers
    expect(results.byDay.map((g) => g.key)).toEqual(['2026-11-09', '2026-11-10']);
    expect(results.byStrategy).toEqual([]);
    expect(results.bySide).toEqual([]);
  });

  it('gives an empty summary when there are no closed trades in the range', () => {
    const results = toResults([row('all', null, 0, 0, { best: null, worst: null })], 0);
    expect(results.summary).toMatchObject({ trades: 0, pnl: 0, best: null, worst: null });
    expect(toResults([], 0).summary.trades).toBe(0);
  });
});

describe('resultsParams', () => {
  it('covers whole IST days, from 00:00 IST on the first to 00:00 IST after the last', () => {
    expect(resultsParams('U1', { from: '2026-11-09', to: '2026-11-10' })).toEqual([
      'U1', '2026-11-08T18:30:00.000Z', '2026-11-10T18:30:00.000Z', 'Asia/Kolkata',
    ]);
  });
});
