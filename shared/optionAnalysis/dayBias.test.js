import { describe, it, expect } from 'vitest';
import { dayBias, scoreDirection } from './dayBias.js';
import { DayLean } from '../analysisEnums.js';
import { ceToken, chain, market, peToken, snapshotsOf } from './setups.fixture.js';

const WINDOW = { minutesLeft: 300, tradingDaysToExpiry: 3 };

/** Every option of one type at the given OI. */
const allOf = (tokenOf, oi) => Object.fromEntries(chain.map((row) => [tokenOf(row.strike), oi]));

describe('dayBias', () => {
  it('reads a day rising with put writing as bullish', () => {
    const now = market({ oi: allOf(peToken, 1500) });
    const day = dayBias(chain, now.oiData, snapshotsOf([24900, 24950, 24980], market()), 25010, 200, WINDOW);
    expect(day.bias).toBeGreaterThan(0.5);
    expect(day.lean).toBe(DayLean.Bullish);
    expect(day.reasons[0]).toMatch(/^Spot \+110 since /);
  });

  it('reads a day falling with call writing as bearish', () => {
    const now = market({ oi: allOf(ceToken, 1500) });
    const day = dayBias(chain, now.oiData, snapshotsOf([25100, 25060, 25030], market()), 24990, 200, WINDOW);
    expect(day.bias).toBeLessThan(-0.5);
    expect(day.lean).toBe(DayLean.Bearish);
  });

  it('reads a flat day with no OI change as neutral', () => {
    const day = dayBias(chain, market().oiData, snapshotsOf([25000, 25000, 25000]), 25000, 200, WINDOW);
    expect(day.bias).toBe(0);
    expect(day.lean).toBe(DayLean.Neutral);
    expect(day.reasons).toHaveLength(2);
  });

  it('has no lean before there are two snapshots or an expected move', () => {
    const none = { bias: 0, lean: DayLean.Neutral, reasons: [] };
    expect(dayBias(chain, market().oiData, snapshotsOf([25000]), 25100, 200, WINDOW)).toEqual(none);
    expect(dayBias(chain, market().oiData, snapshotsOf([25000, 25050]), 25100, 0, WINDOW)).toEqual(none);
  });
});

describe('scoreDirection', () => {
  const day = (bias, lean = DayLean.Neutral) => ({ bias, lean, reasons: ['read'] });

  it('gives half the points on a neutral day, all of them when the day leans fully the trade\'s way, none against it', () => {
    expect(scoreDirection(day(0), true, 40).score).toBe(20);
    expect(scoreDirection(day(1), true, 40).score).toBe(40);
    expect(scoreDirection(day(1), false, 40).score).toBe(0);
    expect(scoreDirection(day(-1), false, 40).score).toBe(40);
  });

  it('says whether the day leans with or against the trade', () => {
    expect(scoreDirection(day(0.6, DayLean.Bullish), true, 40).reasons).toEqual(['Day leans bullish (+0.60) · with this trade']);
    expect(scoreDirection(day(0.6, DayLean.Bullish), false, 40).reasons).toEqual(['Day leans bullish (+0.60) · against this trade']);
    expect(scoreDirection(day(0.1), true, 40).reasons).toEqual(['Day neutral (+0.10)']);
    expect(scoreDirection({ bias: 0, lean: DayLean.Neutral, reasons: [] }, true, 40).reasons).toEqual([]);
  });
});
