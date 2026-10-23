import { describe, it, expect } from 'vitest';
import type { Position } from './positions';
import { computeRiskGroups, samplePayoffCurve, underlyingFromSymbol } from './positionRisk';

let nextToken = 1;
const leg = (overrides: Partial<Position>): Position => ({
  id: String(nextToken),
  mode: 'paper',
  tradingsymbol: 'NIFTY26OCT22500PE',
  instrumentToken: nextToken++,
  strike: 22500,
  optionType: 'PE',
  side: 'BUY',
  quantity: 65,
  entryPrice: 100,
  entryTime: '2026-10-20T04:00:00Z',
  expiry: '2026-10-27',
  ...overrides,
});

describe('underlyingFromSymbol', () => {
  it('strips everything from the first digit', () => {
    expect(underlyingFromSymbol('NIFTY26OCT22500PE')).toBe('NIFTY');
    expect(underlyingFromSymbol('banknifty26oct52000ce')).toBe('BANKNIFTY');
  });
});

describe('computeRiskGroups', () => {
  // Long 22500 PE, short 23000 CE: unlimited profit below, unlimited loss above.
  const longPut = leg({ tradingsymbol: 'NIFTY26OCT22500PE', strike: 22500, optionType: 'PE', side: 'BUY', entryPrice: 74.35 });
  const shortCall = leg({ tradingsymbol: 'NIFTY26OCT23000CE', strike: 23000, optionType: 'CE', side: 'SELL', entryPrice: 49.45 });

  it('sums live P&L across legs from current prices', () => {
    const prices = new Map([[longPut.instrumentToken, 140], [shortCall.instrumentToken, 18]]);
    const [group] = computeRiskGroups([longPut, shortCall], prices);

    expect(group.key).toBe('NIFTY|2026-10-27');
    expect(group.legs).toHaveLength(2);
    // (140 - 74.35) * 65 + (49.45 - 18) * 65
    expect(group.livePnL).toBeCloseTo(6311.5, 2);
  });

  it('reports unbounded sides as null and finds the breakeven', () => {
    const [group] = computeRiskGroups([longPut, shortCall], new Map());

    expect(group.livePnL).toBeNull();
    expect(group.maxProfit).toBeNull();
    expect(group.maxLoss).toBeNull();
    // Net debit 24.90 → breakeven 22500 - 24.90
    expect(group.breakevens).toEqual([22475.1]);
  });

  it('computes bounded max profit and loss for a debit spread', () => {
    const [group] = computeRiskGroups([
      leg({ strike: 22500, optionType: 'CE', side: 'BUY', entryPrice: 100 }),
      leg({ strike: 22600, optionType: 'CE', side: 'SELL', entryPrice: 50 }),
    ], new Map());

    expect(group.maxLoss).toBe(-3250);
    expect(group.maxProfit).toBe(3250);
    expect(group.breakevens).toEqual([22550]);
  });

  it('groups by underlying and expiry, nearest expiry first, ignoring exited legs', () => {
    const groups = computeRiskGroups([
      leg({ expiry: '2026-11-24' }),
      leg({ expiry: '2026-10-27' }),
      leg({ tradingsymbol: 'BANKNIFTY26OCT52000CE', optionType: 'CE', strike: 52000 }),
      leg({ expiry: '2026-12-29', exited: true }),
    ], new Map());

    expect(groups.map((g) => g.key).sort()).toEqual(['BANKNIFTY|2026-10-27', 'NIFTY|2026-10-27', 'NIFTY|2026-11-24']);
    expect(groups.map((g) => g.expiry)).toEqual(['2026-10-27', '2026-10-27', '2026-11-24']);
  });

  it('flags a stop-loss breach in the losing direction only', () => {
    const buy = leg({ side: 'BUY', entryPrice: 100, stopLossPrice: 60 });
    const sell = leg({ side: 'SELL', entryPrice: 100, stopLossPrice: 150, tradingsymbol: 'NIFTY26OCT22500CE', optionType: 'CE' });

    const breached = computeRiskGroups([buy, sell], new Map([[buy.instrumentToken, 55], [sell.instrumentToken, 120]]))[0];
    expect(breached.invalidationHit).toBe(true);
    expect(breached.legs.map((l) => l.invalidationHit)).toEqual([true, false]);

    const safe = computeRiskGroups([buy, sell], new Map([[buy.instrumentToken, 80], [sell.instrumentToken, 120]]))[0];
    expect(safe.invalidationHit).toBe(false);
  });
});

describe('samplePayoffCurve', () => {
  const longPut = leg({ strike: 22500, optionType: 'PE', side: 'BUY', entryPrice: 74.35 });
  const shortCall = leg({ strike: 23000, optionType: 'CE', side: 'SELL', entryPrice: 49.45, tradingsymbol: 'NIFTY26OCT23000CE' });
  const [group] = computeRiskGroups([longPut, shortCall], new Map());

  it('values legs at intrinsic only, so it is the payoff at expiry', () => {
    const curve = samplePayoffCurve(group, 22450);
    const at = (price: number) => curve.points.find((p) => p.price === price)?.payoff;

    // Between the strikes both options expire worthless: lose the net debit.
    expect(at(22500)).toBeCloseTo(-1618.5, 2);
    expect(at(23000)).toBeCloseTo(-1618.5, 2);
  });

  it('covers spot, strikes and breakevens, sorted by price', () => {
    const curve = samplePayoffCurve(group, 22450);
    const prices = curve.points.map((p) => p.price);

    expect(curve.minPrice).toBeLessThan(22450);
    expect(curve.maxPrice).toBeGreaterThan(23000);
    expect(prices).toContain(22475.1);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    expect(curve.maxPayoff).toBeGreaterThan(0);
    expect(curve.minPayoff).toBeLessThan(0);
  });
});
