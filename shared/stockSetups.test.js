import { describe, it, expect } from 'vitest';
import {
  analyzeStock,
  averageTrueRange,
  evaluateSetup,
  findSetups,
  isCashStock,
  marketCheck,
  mergeLevels,
  parseKiteCandles,
  relativeStrengthIndex,
  roundStep,
  stockState,
  swingLevels,
  zoneHistory,
  SETUP_HOLD_SESSIONS,
} from './stockSetups.js';

/** Day `i` as an ISO date, counted from 2024-01-01. */
const day = (i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);

/** Candles from a list of closes: each opens at the previous close, with a 1% range around the body. */
function fromCloses(closes, volume = 1000) {
  return closes.map((close, i) => {
    const open = i ? closes[i - 1] : close;
    return { date: day(i), open, high: Math.max(open, close) * 1.005, low: Math.min(open, close) * 0.995, close, volume };
  });
}

/** Price swinging between `low` and `high` with the given period (a range-bound stock). */
function oscillate(count, low, high, period = 20) {
  return Array.from({ length: count }, (_, i) => low + ((high - low) * (1 - Math.cos((2 * Math.PI * i) / period))) / 2);
}

const ind = (overrides = {}) => ({ sma20: null, sma50: null, sma200: null, atr: 2, rsi: 50, avgVolume20: 1000, ...overrides });
const zone = (low, high, extra = {}) => ({ low, high, mid: (low + high) / 2, score: 2, strength: 2, reasons: [], side: 'support', distancePct: 0, history: { tests: 0, held: 0, failed: 0, avgMovePct: null }, ...extra });

describe('candles and instruments', () => {
  it('parses Kite rows, sorting oldest first and dropping malformed ones', () => {
    const candles = parseKiteCandles([
      ['2026-10-28T00:00:00+0530', 10, 12, 9, 11, 500],
      ['2026-10-27T00:00:00+0530', 9, 10, 8, 10, 400],
      ['bad'],
      ['2026-10-29T00:00:00+0530', 11, null, 10, 11, 300],
    ]);
    expect(candles).toEqual([
      { date: '2026-10-27', open: 9, high: 10, low: 8, close: 10, volume: 400 },
      { date: '2026-10-28', open: 10, high: 12, low: 9, close: 11, volume: 500 },
    ]);
  });

  it('covers NSE cash stocks only, not indices or F&O', () => {
    expect(isCashStock({ exchange: 'NSE', tradingsymbol: 'RELIANCE', instrumentType: 'EQ' })).toBe(true);
    expect(isCashStock({ exchange: 'NSE', tradingsymbol: 'BAJAJ-AUTO' })).toBe(true);
    expect(isCashStock({ exchange: 'NSE', tradingsymbol: 'NIFTY 50', instrumentType: 'EQ' })).toBe(false);
    expect(isCashStock({ exchange: 'NFO', tradingsymbol: 'RELIANCE26NOVFUT', instrumentType: 'FUT' })).toBe(false);
  });
});

describe('indicators', () => {
  it('measures average true range including gaps', () => {
    const flat = Array.from({ length: 30 }, (_, i) => ({ date: day(i), open: 100, high: 101, low: 99, close: 100, volume: 1 }));
    expect(averageTrueRange(flat)).toBeCloseTo(2, 9);
    // A gap up from 100 to a 110–112 range is a true range of 12, not 2.
    const gapped = [...flat, { date: day(30), open: 111, high: 112, low: 110, close: 111, volume: 1 }];
    expect(averageTrueRange(gapped)).toBeCloseTo((2 * 13 + 12) / 14, 9);
  });

  it('reads RSI at the extremes and in balance', () => {
    expect(relativeStrengthIndex(Array.from({ length: 30 }, (_, i) => 100 + i))).toBe(100);
    expect(relativeStrengthIndex(Array.from({ length: 30 }, (_, i) => 100 - i))).toBeCloseTo(0, 9);
    // Wilder smoothing swings a little either side of 50 on an alternating series.
    const balanced = relativeStrengthIndex(Array.from({ length: 31 }, (_, i) => (i % 2 ? 101 : 100)));
    expect(Math.abs(balanced - 50)).toBeLessThan(3);
  });

  it('picks a round-number step that suits the price', () => {
    expect(roundStep(1540)).toBe(100);
    expect(roundStep(8000)).toBe(500);
    expect(roundStep(250)).toBe(10);
  });
});

describe('levels and zones', () => {
  it('finds the turning points of a swinging price', () => {
    const levels = swingLevels(fromCloses(oscillate(100, 100, 120)));
    const lows = levels.filter((l) => l.kind === 'swing-low');
    const highs = levels.filter((l) => l.kind === 'swing-high');
    expect(lows.length).toBeGreaterThanOrEqual(3);
    expect(highs.length).toBeGreaterThanOrEqual(3);
    for (const l of lows) expect(l.price).toBeLessThan(101);
    for (const h of highs) expect(h.price).toBeGreaterThan(119);
  });

  it('merges nearby levels, counts repeats, and drops round-number-only zones', () => {
    const zones = mergeLevels([
      { price: 100, kind: 'swing-low', weight: 1 },
      { price: 100.4, kind: 'swing-low', weight: 1 },
      { price: 100.8, kind: 'volume', weight: 1.5 },
      { price: 150, kind: 'round', weight: 0.5 },
    ], 1, 2);
    expect(zones).toHaveLength(1);
    expect(zones[0].reasons).toEqual(['swing low ×2', 'high-volume area']);
    expect(zones[0].score).toBeCloseTo(1 + 0.5 + 1.5, 9);
    expect(zones[0].low).toBeLessThanOrEqual(100);
    expect(zones[0].high).toBeGreaterThanOrEqual(100.8);
  });

  it('counts how often a support zone held, and when it gave way', () => {
    const z = { low: 99, high: 101, mid: 100 };
    // Three dips to ~100 that each bounce over 105.
    const held = fromCloses([...oscillate(80, 100, 112), 112]);
    expect(zoneHistory(held, z, 'support', 0.03, 0.02)).toMatchObject({ tests: 4, held: 4, failed: 0 });
    // One dip that keeps falling through the zone.
    const broke = fromCloses([110, 108, 106, 104, 103, 102, 100.5, 98, 95, 92, 90, 89, 88]);
    expect(zoneHistory(broke, z, 'support', 0.03, 0.02)).toMatchObject({ tests: 1, held: 0, failed: 1 });
  });
});

describe('state and market', () => {
  // A decline with up days in it; a perfectly straight one has RSI 0 and reads as stretched.
  const steadyFall = fromCloses(Array.from({ length: 80 }, (_, i) => 200 - i * 0.5 + 1.5 * Math.sin(i * 1.3)));

  it('reads a steady decline as falling and a crash as stretched', () => {
    const analysis = analyzeStock(steadyFall);
    expect(analysis.state).toBe('falling');
    const crash = fromCloses([...Array.from({ length: 70 }, () => 200), ...Array.from({ length: 10 }, (_, i) => 196 - i * 6)]);
    expect(analyzeStock(crash).state).toBe('stretched');
  });

  it('sees a turn when a falling stock closes above the previous high without a new low', () => {
    const turn = [...steadyFall.slice(0, -2)];
    const base = turn[turn.length - 1].close;
    turn.push({ date: day(78), open: base, high: base + 0.5, low: base - 0.2, close: base + 0.2, volume: 1000 });
    turn.push({ date: day(79), open: base + 0.2, high: base + 2.5, low: base + 0.1, close: base + 2.2, volume: 1000 });
    expect(stockState(turn, { ...ind(), sma20: 165, sma50: 175 }).state).toBe('turning');
  });

  it('tells a stock falling on its own from one falling with the market', () => {
    const stock = fromCloses(Array.from({ length: 30 }, (_, i) => 100 - i));
    const flatMarket = fromCloses(Array.from({ length: 30 }, () => 20000));
    const fallingMarket = fromCloses(Array.from({ length: 30 }, (_, i) => 20000 * (1 - i * 0.009)));
    expect(marketCheck(stock, flatMarket).relation).toBe('alone');
    expect(marketCheck(stock, fallingMarket).relation).toBe('with-market');
    // 20 sessions: from day 9 (91) to day 29 (71).
    expect(marketCheck(stock, flatMarket).stockPct).toBeCloseTo((71 / 91 - 1) * 100, 9);
  });
});

describe('findSetups', () => {
  const prev = { date: day(0), open: 105, high: 106, low: 104, close: 105, volume: 1000 };

  it('finds a pullback into support in an uptrend that closes strong', () => {
    const last = { date: day(1), open: 101, high: 104, low: 99, close: 103.5, volume: 1000 };
    const [setup] = findSetups([prev, last], ind({ sma200: 90 }), 'uptrend', [zone(98, 100)], [zone(115, 117, { side: 'resistance' })], []);
    expect(setup).toMatchObject({ type: 'pullback', direction: 'buy', entry: 103.5, stop: 97, target: 115 });
    expect(setup.rewardRisk).toBeCloseTo(11.5 / 6.5, 9);
  });

  it('finds breakouts and breakdowns only on heavy volume', () => {
    const r = { low: 108, high: 110, mid: 109 };
    const up = { date: day(1), open: 109, high: 113, low: 108.5, close: 112, volume: 2000 };
    const breakout = findSetups([{ ...prev, close: 109 }, up], ind(), 'sideways', [], [], [r]);
    expect(breakout.map((s) => s.type)).toEqual(['breakout']);
    expect(breakout[0].stop).toBeCloseTo(107.5, 9);
    expect(findSetups([{ ...prev, close: 109 }, { ...up, volume: 1200 }], ind(), 'sideways', [], [], [r])).toEqual([]);

    const down = { date: day(1), open: 109, high: 109.5, low: 105, close: 106, volume: 2000 };
    const breakdown = findSetups([{ ...prev, close: 109 }, down], ind(), 'falling', [], [], [r]);
    expect(breakdown.map((s) => [s.type, s.direction])).toEqual([['breakdown', 'sell']]);
  });

  it('finds a rejection at resistance with a target at the support below', () => {
    const last = { date: day(1), open: 110, high: 111, low: 107.5, close: 108, volume: 1000 };
    const [setup] = findSetups([prev, last], ind({ sma50: 115 }), 'falling', [zone(108, 109), zone(98, 100)], [zone(110, 112, { side: 'resistance' })], []);
    expect(setup).toMatchObject({ type: 'rejection', direction: 'sell', entry: 108, stop: 113, target: 100 });
  });

  it('skips setups whose reward is smaller than their risk', () => {
    const last = { date: day(1), open: 101, high: 104, low: 99, close: 103.5, volume: 1000 };
    expect(findSetups([prev, last], ind({ sma200: 90 }), 'uptrend', [zone(98, 100)], [zone(105, 106, { side: 'resistance' })], [])).toEqual([]);
  });
});

describe('analyzeStock', () => {
  it('puts a tested support zone under a range-bound stock and plans around it', () => {
    const closes = [...oscillate(200, 100, 120), 104, 103];
    const analysis = analyzeStock(fromCloses(closes));
    const support = analysis.supports[0];
    expect(support.low).toBeLessThan(101);
    expect(support.high).toBeGreaterThan(99);
    expect(support.history.tests).toBeGreaterThan(3);
    // Every resolved test held; the latest dip can still be unresolved.
    expect(support.history.failed).toBe(0);
    expect(support.history.held).toBeGreaterThanOrEqual(support.history.tests - 1);
    expect(analysis.resistances[0].low).toBeGreaterThan(103);
    expect(analysis.resistances.some((r) => r.high > 119)).toBe(true);
    expect(analysis.plan).toContain('held');
  });

  it('needs enough history', () => {
    expect(analyzeStock(fromCloses(oscillate(30, 100, 120)))).toBeNull();
  });
});

describe('evaluateSetup', () => {
  const buy = { direction: 'buy', entry: 100, stop: 95, target: 110 };
  const bar = (i, low, high) => ({ date: day(i), open: 100, high, low, close: 100, volume: 1 });

  it('resolves at the target or the stop, whichever comes first', () => {
    expect(evaluateSetup(buy, [bar(1, 98, 104), bar(2, 101, 111)])).toMatchObject({ status: 'target', resolvedDate: day(2), sessionsHeld: 2 });
    expect(evaluateSetup(buy, [bar(1, 98, 104), bar(2, 94, 103)])).toMatchObject({ status: 'stop', resolvedDate: day(2) });
    expect(evaluateSetup(buy, [bar(1, 94, 111)]).status).toBe('stop');
  });

  it('tracks the best and worst move, and expires after the holding window', () => {
    const quiet = Array.from({ length: SETUP_HOLD_SESSIONS + 3 }, (_, i) => bar(i + 1, 97, 106));
    expect(evaluateSetup(buy, quiet)).toMatchObject({ status: 'expired', resolvedDate: day(SETUP_HOLD_SESSIONS), sessionsHeld: SETUP_HOLD_SESSIONS });
    const open = evaluateSetup(buy, quiet.slice(0, 3));
    expect(open).toMatchObject({ status: 'open', resolvedDate: null, sessionsHeld: 3 });
    expect(open.maxFavorablePct).toBeCloseTo(6, 9);
    expect(open.maxAdversePct).toBeCloseTo(3, 9);
  });

  it('mirrors for sell setups', () => {
    const sell = { direction: 'sell', entry: 100, stop: 105, target: 92 };
    expect(evaluateSetup(sell, [bar(1, 91, 103)]).status).toBe('target');
    expect(evaluateSetup(sell, [bar(1, 96, 106)]).status).toBe('stop');
  });
});
