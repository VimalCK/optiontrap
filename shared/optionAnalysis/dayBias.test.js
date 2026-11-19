import { describe, it, expect } from 'vitest';
import { dayBias, scoreDirection } from './dayBias.js';
import { ceToken, chain, market, peToken, snapshotsOf } from './setups.fixture.js';

const WINDOW = { minutesLeft: 300, tradingDaysToExpiry: 3 };

/** Every option of one type at the given OI. */
const allOf = (tokenOf, oi) => Object.fromEntries(chain.map((row) => [tokenOf(row.strike), oi]));

describe('dayBias', () => {
  it('reads a day rising with put writing as bullish', () => {
    const now = market({ oi: allOf(peToken, 1500) });
    const day = dayBias(chain, now.oiData, snapshotsOf([24900, 24950, 24980], market()), 25010, 200, WINDOW);
    expect(day.bias).toBeGreaterThan(0.5);
    expect(day.reasons[0]).toContain('bullish');
  });

  it('reads a day falling with call writing as bearish', () => {
    const now = market({ oi: allOf(ceToken, 1500) });
    const day = dayBias(chain, now.oiData, snapshotsOf([25100, 25060, 25030], market()), 24990, 200, WINDOW);
    expect(day.bias).toBeLessThan(-0.5);
    expect(day.reasons[0]).toContain('bearish');
  });

  it('reads a flat day with no OI change as neutral', () => {
    const day = dayBias(chain, market().oiData, snapshotsOf([25000, 25000, 25000]), 25000, 200, WINDOW);
    expect(day.bias).toBe(0);
    expect(day.reasons[0]).toContain('neutral');
  });

  it('has no lean before there are two snapshots or an expected move', () => {
    expect(dayBias(chain, market().oiData, snapshotsOf([25000]), 25100, 200, WINDOW)).toEqual({ bias: 0, reasons: [] });
    expect(dayBias(chain, market().oiData, snapshotsOf([25000, 25050]), 25100, 0, WINDOW)).toEqual({ bias: 0, reasons: [] });
  });
});

describe('scoreDirection', () => {
  const lean = (bias) => ({ bias, reasons: [] });

  it('gives half the points on a neutral day, all of them when the day leans fully the trade\'s way, none against it', () => {
    expect(scoreDirection(lean(0), true, 40).score).toBe(20);
    expect(scoreDirection(lean(1), true, 40).score).toBe(40);
    expect(scoreDirection(lean(1), false, 40).score).toBe(0);
    expect(scoreDirection(lean(-1), false, 40).score).toBe(40);
  });
});
