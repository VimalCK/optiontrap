import { describe, it, expect } from 'vitest';
import { MIN_CANDLES, analyzeStock } from './analysis.js';
import { SETUP_HOLD_SESSIONS, evaluateSetup, replaySetups } from './outcomes.js';
import { day, fromCloses, oscillate } from './candles.fixture.js';

describe('evaluateSetup', () => {
  const buy = { direction: 'BUY', entry: 100, stop: 95, target: 110 };
  const bar = (i, low, high) => ({ date: day(i), open: 100, high, low, close: 100, volume: 1 });

  it('resolves at the target or the stop, whichever comes first', () => {
    expect(evaluateSetup(buy, [bar(1, 98, 104), bar(2, 101, 111)])).toMatchObject({ status: 'Target', resolvedDate: day(2), sessionsHeld: 2 });
    expect(evaluateSetup(buy, [bar(1, 98, 104), bar(2, 94, 103)])).toMatchObject({ status: 'Stop', resolvedDate: day(2) });
    expect(evaluateSetup(buy, [bar(1, 94, 111)]).status).toBe('Stop');
  });

  it('tracks the best and worst move, and expires after the holding window', () => {
    const quiet = Array.from({ length: SETUP_HOLD_SESSIONS + 3 }, (_, i) => bar(i + 1, 97, 106));
    expect(evaluateSetup(buy, quiet)).toMatchObject({ status: 'Expired', resolvedDate: day(SETUP_HOLD_SESSIONS), sessionsHeld: SETUP_HOLD_SESSIONS });
    const open = evaluateSetup(buy, quiet.slice(0, 3));
    expect(open).toMatchObject({ status: 'Open', resolvedDate: null, sessionsHeld: 3 });
    expect(open.maxFavorablePct).toBeCloseTo(6, 9);
    expect(open.maxAdversePct).toBeCloseTo(3, 9);
  });

  it('mirrors for sell setups', () => {
    const sell = { direction: 'SELL', entry: 100, stop: 105, target: 92 };
    expect(evaluateSetup(sell, [bar(1, 91, 103)]).status).toBe('Target');
    expect(evaluateSetup(sell, [bar(1, 96, 106)]).status).toBe('Stop');
  });
});

describe('replaySetups', () => {
  // A range-bound stock: dips into its support zone give buy setups along the way.
  const candles = fromCloses(oscillate(260, 100, 120));

  it('finds what the scan would have shown each session, without seeing later candles', () => {
    const found = replaySetups(candles, day(0));
    expect(found.length).toBeGreaterThan(0);
    for (const setup of found) {
      const i = candles.findIndex((c) => c.date === setup.date);
      const { outcome, ...shown } = setup;
      expect(analyzeStock(candles.slice(0, i + 1)).setups).toContainEqual(shown);
      expect(outcome).toEqual(evaluateSetup(setup, candles.slice(i + 1)));
    }
  });

  it('starts at fromDate, and never before there is enough history', () => {
    const from = day(200);
    expect(replaySetups(candles, from).every((s) => s.date >= from)).toBe(true);
    expect(replaySetups(candles, day(0)).every((s) => s.date >= day(MIN_CANDLES - 1))).toBe(true);
    expect(replaySetups(candles, day(400))).toEqual([]);
  });
});
