import { describe, it, expect } from 'vitest';
import { buyPop, computeBuyRecommendations, moveInFavour } from './buySetups.js';
import { OptionType } from '../tradeEnums.js';
import { OptionSetup } from '../analysisEnums.js';
import { STRIKES, ceToken, chain, market, peToken, single, snapshotsOf } from './setups.fixture.js';

function recommend({ oiData, livePrices }, snapshots, spot = 25010) {
  return computeBuyRecommendations(chain, oiData, livePrices, new Map(), new Map(), snapshots, spot, 1, 25000);
}

/** Every put's OI and price changed by the given factors since the snapshots. */
function putsMoved(oiFactor, priceFactor) {
  const then = market();
  const oi = {};
  const prices = {};
  for (const strike of STRIKES) {
    oi[peToken(strike)] = 1000 * oiFactor;
    prices[peToken(strike)] = then.livePrices.get(peToken(strike)) * priceFactor;
  }
  return { now: market({ oi, prices }), then };
}

describe('buyPop', () => {
  it('is the chance spot ends beyond the breakeven', () => {
    // Straddle 200 → SD 250. Call 25000 bought at 100: breakeven 25100, 0.4 SD up.
    expect(buyPop(25000, 100, 25000, 200, OptionType.CE)).toBeCloseTo(34.5, 0);
    expect(buyPop(25000, 100, 25000, 200, OptionType.PE)).toBeCloseTo(34.5, 0);
  });

  it('is lower the further out the strike', () => {
    expect(buyPop(25200, 30, 25000, 200, OptionType.CE)).toBeLessThan(buyPop(25050, 70, 25000, 200, OptionType.CE));
  });
});

describe('moveInFavour', () => {
  const snaps = (spots) => spots.map((spot) => ({ spot, data: {}, timestamp: 0, timeLabel: '' }));

  it('is the 30-minute move as a share of the expected move, up for calls and down for puts', () => {
    expect(moveInFavour(OptionType.CE, snaps([25000, 25020]), 25040, 200)).toBeCloseTo(0.2);
    expect(moveInFavour(OptionType.PE, snaps([25000, 25020]), 25040, 200)).toBeCloseTo(-0.2);
  });
});

describe('computeBuyRecommendations', () => {
  // Spot up 70 in 30 minutes (0.35 of the expected move): calls qualify, puts are trending against.
  const RISING = [24940, 24960, 24990];
  const calls = (recs) => recs.filter((r) => r.type === OptionSetup.BuyCe);

  it('makes POP part of the score, and the score the sum of its parts', () => {
    const recs = recommend(market(), snapshotsOf(RISING));
    expect(recs.length).toBeGreaterThan(0);
    for (const rec of recs) {
      const { probability, trend, flow, breakout, premiumCost } = rec.breakdown;
      expect(rec.score).toBe(probability + trend + flow + breakout + premiumCost);
    }
    expect(single(recs, OptionSetup.BuyCe, 25000)?.pop).toBeGreaterThan(single(recs, OptionSetup.BuyCe, 25150)?.pop ?? 100);
  });

  it('suggests no buys without a sign of the move: spot flat and no buyers entering', () => {
    const { now, then } = putsMoved(1.2, 0.8); // put writers adding, but spot hasn't moved and no one is buying
    expect(recommend(now, snapshotsOf([25010, 25010, 25010], then))).toEqual([]);
  });

  it('does not count put writers covering (bearish) as support for a call buy', () => {
    const { now, then } = putsMoved(0.8, 1.3); // put OI down, put prices up: short covering
    const recs = calls(recommend(now, snapshotsOf(RISING, then)));
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.some((r) => r.reasons.some((reason) => reason.includes('opposite side retreating')))).toBe(false);
  });

  it('counts put writers adding as puts fall (bullish) as support for a call buy', () => {
    const { now, then } = putsMoved(1.2, 0.8); // put OI up, put prices down: short buildup
    const recs = calls(recommend(now, snapshotsOf(RISING, then)));
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.reasons.some((reason) => reason.includes('opposite side retreating')))).toBe(true);
  });

  it('gives no breakout points when the call wall in the way is only losing its buyers (long unwinding)', () => {
    const then = market({ oi: { [ceToken(25100)]: 8000 }, prices: { [ceToken(25100)]: 30 } });
    const now = market({ oi: { [ceToken(25100)]: 6000 }, prices: { [ceToken(25100)]: 20 } });
    const recs = recommend(now, snapshotsOf(RISING, then));
    expect(single(recs, OptionSetup.BuyCe, 25050)?.breakdown.breakout).toBe(0); // breakeven 25110, past the wall
  });

  it('scores a call wall in the way as a breakout when its writers cover', () => {
    const then = market({ oi: { [ceToken(25100)]: 8000 }, prices: { [ceToken(25100)]: 10 } });
    const now = market({ oi: { [ceToken(25100)]: 6000 }, prices: { [ceToken(25100)]: 20 } });
    const recs = recommend(now, snapshotsOf(RISING, then));
    expect(single(recs, OptionSetup.BuyCe, 25050)?.breakdown.breakout).toBe(15);
  });

  it('scores a clear path to the breakeven, and nothing for a wall still holding there', () => {
    const wall = market({ oi: { [ceToken(25100)]: 6000 } });
    const recs = recommend(wall, snapshotsOf(RISING, wall));
    expect(single(recs, OptionSetup.BuyCe, 25000)?.breakdown.breakout).toBe(10); // breakeven 25100: the wall isn't before it
    expect(single(recs, OptionSetup.BuyCe, 25050)?.breakdown.breakout).toBe(0); // breakeven 25110: the wall at 25100 blocks
  });

  it('buys no calls while spot falls through the last 30 minutes, and rewards a rise', () => {
    const falling = recommend(market(), snapshotsOf([25080, 25060, 25040]), 25010);
    expect(calls(falling)).toEqual([]);
    const rising = recommend(market(), snapshotsOf(RISING));
    expect(single(rising, OptionSetup.BuyCe, 25050)?.breakdown.trend).toBe(20);
  });
});
