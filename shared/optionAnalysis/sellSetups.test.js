import { describe, it, expect } from 'vitest';
import { computeSellRecommendations, sellPop, trendsAgainst } from './sellSetups.js';
import { rangePop } from './setupScoring.js';
import { OptionType } from '../tradeEnums.js';
import { OptionSetup } from '../analysisEnums.js';
import { ceToken, chain, market, single, snapshotsOf } from './setups.fixture.js';

function recommend({ oiData, livePrices }, snapshots, spot = 25010) {
  return computeSellRecommendations(chain, oiData, livePrices, new Map(), new Map(), snapshots, spot, 1, 25000);
}

describe('sellPop', () => {
  it('is the chance spot ends inside the breakeven, the straddle being 0.8 standard deviations', () => {
    // Straddle 200 → SD 250. Call 25200 sold at 50: breakeven 25250, one SD above 25000.
    expect(sellPop(25200, 50, 25000, 200, OptionType.CE)).toBeCloseTo(84.13, 1);
    expect(sellPop(24800, 50, 25000, 200, OptionType.PE)).toBeCloseTo(84.13, 1);
  });

  it('counts the premium received, so an at-the-money sale is better than a coin flip', () => {
    expect(sellPop(25000, 100, 25000, 200, OptionType.CE)).toBeGreaterThan(60);
  });

  it('is 50 without an expected move', () => {
    expect(sellPop(25200, 50, 25000, 0, OptionType.CE)).toBe(50);
  });
});

describe('rangePop', () => {
  it('needs spot to stay between both breakevens, so a strangle is less likely than either leg', () => {
    const ce = sellPop(25200, 40, 25000, 200, OptionType.CE);
    const pe = sellPop(24800, 40, 25000, 200, OptionType.PE);
    const strangle = rangePop(24800 - 80, 25200 + 80, 25000, 200);
    expect(strangle).toBeLessThan(Math.min(ce, pe));
    const ceAtStranglePremium = sellPop(25200, 80, 25000, 200, OptionType.CE);
    const peAtStranglePremium = sellPop(24800, 80, 25000, 200, OptionType.PE);
    expect(strangle).toBeCloseTo(ceAtStranglePremium + peAtStranglePremium - 100, 6);
  });
});

describe('trendsAgainst', () => {
  const snaps = (spots) => spots.map((spot) => ({ spot, data: {}, timestamp: 0, timeLabel: '' }));

  it('flags a sold call when spot rose more than a quarter of the expected move in 30 minutes', () => {
    expect(trendsAgainst(OptionType.CE, snaps([25000, 25020, 25040]), 25060, 200)).toBe(true);
    expect(trendsAgainst(OptionType.PE, snaps([25000, 25020, 25040]), 25060, 200)).toBe(false);
  });

  it('flags a sold put when spot fell that far', () => {
    expect(trendsAgainst(OptionType.PE, snaps([25060, 25040, 25020]), 25000, 200)).toBe(true);
  });

  it('lets a small move through, and only reads the last 30 minutes', () => {
    expect(trendsAgainst(OptionType.CE, snaps([25000, 25020]), 25040, 200)).toBe(false);
    expect(trendsAgainst(OptionType.CE, snaps([24800, 25050, 25050, 25050]), 25060, 200)).toBe(false);
  });
});

describe('computeSellRecommendations', () => {
  const callWall = market({ oi: { [ceToken(25100)]: 6000 } });

  it('gives wall points only to calls whose strike is at or beyond the wall', () => {
    const recs = recommend(callWall, snapshotsOf([25010, 25010, 25010], callWall));
    // Resistance at 25100 protects calls sold at 25100 and above, not one at 25050 below it.
    expect(single(recs, OptionSetup.SellCe, 25100)?.breakdown.oiWall).toBeGreaterThan(0);
    expect(single(recs, OptionSetup.SellCe, 25150)?.breakdown.oiWall).toBeGreaterThan(0);
    expect(single(recs, OptionSetup.SellCe, 25050)?.breakdown.oiWall ?? 0).toBe(0);
  });

  it('gives no points for call buyers (long buildup) adding at the wall', () => {
    const before = market({ oi: { [ceToken(25100)]: 4000 }, prices: { [ceToken(25100)]: 10 } });
    const now = market({ oi: { [ceToken(25100)]: 6000 }, prices: { [ceToken(25100)]: 30 } });
    const plain = recommend(callWall, snapshotsOf([25010, 25010, 25010], before));
    const longBuildup = recommend(now, snapshotsOf([25010, 25010, 25010], before));
    expect(single(longBuildup, OptionSetup.SellCe, 25150)?.breakdown.oiWall)
      .toBe(single(plain, OptionSetup.SellCe, 25150)?.breakdown.oiWall);
  });

  it('adds points for sellers (short buildup) at the wall', () => {
    const before = market({ oi: { [ceToken(25100)]: 4000 }, prices: { [ceToken(25100)]: 40 } });
    const plain = recommend(callWall, snapshotsOf([25010, 25010, 25010], callWall));
    const shortBuildup = recommend(callWall, snapshotsOf([25010, 25010, 25010], before));
    expect(single(shortBuildup, OptionSetup.SellCe, 25150)?.breakdown.oiWall)
      .toBe((single(plain, OptionSetup.SellCe, 25150)?.breakdown.oiWall ?? 0) + 10);
  });

  it('makes POP part of the score, and the score the sum of its parts', () => {
    const recs = recommend(callWall, snapshotsOf([25010, 25010, 25010], callWall));
    for (const rec of recs) {
      const { probability, oiWall, velocity, premiumValue, regime } = rec.breakdown;
      expect(rec.score).toBe(probability + oiWall + velocity + premiumValue + regime);
    }
    const near = single(recs, OptionSetup.SellCe, 25100);
    const far = single(recs, OptionSetup.SellCe, 25200);
    expect(far?.pop).toBeGreaterThan(near?.pop ?? 100);
    expect(far?.breakdown.probability).toBeGreaterThan(near?.breakdown.probability ?? 30);
  });

  it('sells no calls while spot trends up through the last 30 minutes', () => {
    const recs = recommend(callWall, snapshotsOf([24940, 24960, 24990], callWall), 25010);
    expect(recs.some((r) => r.type === OptionSetup.SellCe)).toBe(false);
  });
});
