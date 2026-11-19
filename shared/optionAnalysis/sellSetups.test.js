import { describe, it, expect } from 'vitest';
import { computeSellRecommendations, trendsAgainst } from './sellSetups.js';
import { OptionType } from '../tradeEnums.js';
import { OptionSetup } from '../analysisEnums.js';
import { TIMING, ceToken, chain, market, peToken, single, snapshotsOf } from './setups.fixture.js';

function recommend({ oiData, livePrices }, snapshots, spot = 25010) {
  return computeSellRecommendations(chain, oiData, livePrices, new Map(), new Map(), snapshots, spot, TIMING, 25000);
}

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

  it('grades the wall by its strength instead of giving every wall full points', () => {
    const weaker = market({ oi: { [ceToken(25100)]: 2500 } });
    const strong = recommend(callWall, snapshotsOf([25010, 25010, 25010], callWall));
    const weak = recommend(weaker, snapshotsOf([25010, 25010, 25010], weaker));
    expect(single(weak, OptionSetup.SellCe, 25150)?.breakdown.oiWall)
      .toBeLessThan(single(strong, OptionSetup.SellCe, 25150)?.breakdown.oiWall ?? 0);
  });

  it('gives no points for call buyers (long buildup) adding at the wall', () => {
    const before = market({ oi: { [ceToken(25100)]: 4000 }, prices: { [ceToken(25100)]: 50 } });
    const now = market({ oi: { [ceToken(25100)]: 6000 }, prices: { [ceToken(25100)]: 80 } });
    const plain = recommend(callWall, snapshotsOf([25010, 25010, 25010], before));
    const longBuildup = recommend(now, snapshotsOf([25010, 25010, 25010], before));
    expect(single(longBuildup, OptionSetup.SellCe, 25150)?.breakdown.oiWall)
      .toBe(single(plain, OptionSetup.SellCe, 25150)?.breakdown.oiWall);
  });

  it('adds points for sellers (short buildup) at the wall', () => {
    const before = market({ oi: { [ceToken(25100)]: 4000 }, prices: { [ceToken(25100)]: 90 } });
    const plain = recommend(callWall, snapshotsOf([25010, 25010, 25010], callWall));
    const shortBuildup = recommend(callWall, snapshotsOf([25010, 25010, 25010], before));
    expect(single(shortBuildup, OptionSetup.SellCe, 25150)?.breakdown.oiWall)
      .toBeGreaterThan(single(plain, OptionSetup.SellCe, 25150)?.breakdown.oiWall ?? 0);
  });

  it('makes the score the sum of its parts, with a chance of profit by today\'s close', () => {
    const recs = recommend(callWall, snapshotsOf([25010, 25010, 25010], callWall));
    expect(recs.length).toBeGreaterThan(0);
    for (const rec of recs) {
      const { direction, today, oiWall, velocity, regime } = rec.breakdown;
      expect(rec.score).toBe(direction + today + oiWall + velocity + regime);
      expect(rec.winChance).toBeGreaterThan(0);
      expect(rec.winChance).toBeLessThan(100);
    }
  });

  it('scores no strike paying under 30% of the ATM option\'s premium', () => {
    // ATM premium 100: a 25 call is below the 30 floor, a 35 one above it. Every other put is under it too,
    // so the calls aren't crowded out of the top five.
    const cheapPuts = Object.fromEntries(chain.filter((row) => row.strike !== 25000).map((row) => [peToken(row.strike), 20]));
    const cheap = market({ prices: { ...cheapPuts, [ceToken(25150)]: 25, [ceToken(25200)]: 35 } });
    const recs = recommend(cheap, snapshotsOf([25010, 25010, 25010], cheap));
    expect(single(recs, OptionSetup.SellCe, 25150)).toBeUndefined();
    expect(single(recs, OptionSetup.SellCe, 25200)).toBeDefined();
  });

  it('gives sold puts the direction points on a day rising with put writing, and sold calls fewer', () => {
    const then = market();
    const putsWritten = market({ oi: Object.fromEntries(chain.map((row) => [peToken(row.strike), 1500])) });
    const recs = recommend(putsWritten, snapshotsOf([24950, 24970, 24990, 25000], then), 25010);
    const put = single(recs, OptionSetup.SellPe, 24950);
    const call = single(recs, OptionSetup.SellCe, 25100);
    expect(put?.breakdown.direction).toBeGreaterThan(20);
    expect(call?.breakdown.direction ?? 0).toBeLessThan(20);
  });

  it('sells no calls while spot trends up through the last 30 minutes', () => {
    const recs = recommend(callWall, snapshotsOf([24940, 24960, 24990], callWall), 25010);
    expect(recs.some((r) => r.type === OptionSetup.SellCe)).toBe(false);
  });
});
