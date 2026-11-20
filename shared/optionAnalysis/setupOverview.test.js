import { describe, it, expect } from 'vitest';
import { autoPickOf, rankSetups, setupOverview, setupSide } from './setupOverview.js';
import { computeBuyRecommendations } from './buySetups.js';
import { computeSellRecommendations } from './sellSetups.js';
import { Side } from '../tradeEnums.js';
import { DayLean, OptionSetup } from '../analysisEnums.js';
import { TIMING, chain, market, peToken, snapshotsOf } from './setups.fixture.js';

const setup = (type, score) => ({ type, score, strikes: [25000] });

describe('rankSetups', () => {
  it('ranks sells and buys together, best first', () => {
    const ranked = rankSetups([setup(OptionSetup.SellPe, 60), setup(OptionSetup.SellCe, 40)], [setup(OptionSetup.BuyCe, 70)]);
    expect(ranked.map((s) => s.type)).toEqual([OptionSetup.BuyCe, OptionSetup.SellPe, OptionSetup.SellCe]);
  });
});

describe('autoPickOf', () => {
  it('is the best single option, skipping straddles and strangles', () => {
    const ranked = [setup(OptionSetup.SellStraddle, 80), setup(OptionSetup.SellPe, 70), setup(OptionSetup.BuyCe, 60)];
    expect(autoPickOf(ranked)?.type).toBe(OptionSetup.SellPe);
    expect(autoPickOf([setup(OptionSetup.BuyStrangle, 50)])).toBeNull();
  });
});

describe('setupSide', () => {
  it('is the side every leg of a setup trades', () => {
    expect(setupSide(OptionSetup.SellStrangle)).toBe(Side.SELL);
    expect(setupSide(OptionSetup.BuyPe)).toBe(Side.BUY);
  });
});

describe('setupOverview', () => {
  const overview = (now, snapshots, spot) => setupOverview(chain, now.oiData, now.livePrices, snapshots, spot, TIMING, 25000);

  it('reads the day and says why sides have no setups: no call sells and no put buys while spot rises fast', () => {
    const putsWritten = market({ oi: Object.fromEntries(chain.map((row) => [peToken(row.strike), 1500])) });
    const { day, gaps } = overview(putsWritten, snapshotsOf([24940, 24960, 24990], market()), 25010);
    expect(day?.lean).toBe(DayLean.Bullish);
    expect(gaps.map((gap) => [gap.side, gap.text])).toEqual([
      [Side.SELL, 'No CE sells · spot up 70 in 30 min'],
      [Side.BUY, 'No PE buys · spot up 70 in 30 min'],
    ]);
    expect(gaps[0].detail).toBe('Spot moved up 70 points in the last 30 minutes, more than a quarter of the expected move, against these options.');
  });

  it('says why no options are bought on a flat day, and agrees with the scoring', () => {
    const flat = market();
    const snapshots = snapshotsOf([25010, 25010, 25010], flat);
    const { gaps } = overview(flat, snapshots, 25010);
    const buyGaps = gaps.filter((gap) => gap.side === Side.BUY).map((gap) => gap.text);
    expect(buyGaps).toEqual(['No CE buys · no move yet', 'No PE buys · no move yet']);
    expect(computeBuyRecommendations(chain, flat.oiData, flat.livePrices, new Map(), new Map(), snapshots, 25010, TIMING, 25000)).toEqual([]);
    expect(gaps.some((gap) => gap.side === Side.SELL)).toBe(false);
    expect(computeSellRecommendations(chain, flat.oiData, flat.livePrices, new Map(), new Map(), snapshots, 25010, TIMING, 25000).length).toBeGreaterThan(0);
  });

  it('reads nothing before there are two snapshots', () => {
    expect(overview(market(), snapshotsOf([25010], market()), 25010)).toEqual({ day: null, gaps: [] });
  });
});
