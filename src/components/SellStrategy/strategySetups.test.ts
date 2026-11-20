import { describe, it, expect } from 'vitest';
import { allReasons, breakevenLabel, scorePartsOf, type StrategySetup } from './strategySetups';
import { OptionSetup, SetupPattern } from '../../../shared/analysisEnums.js';

const sell = (type: StrategySetup['type'], strikes: number[], premium: number): StrategySetup => ({
  type,
  strikes,
  premium,
  score: 70,
  pattern: SetupPattern.Mixed,
  winChance: 60,
  breakdown: { direction: 30, today: 20, oiWall: 10, velocity: 5, regime: 5 },
  reasons: { direction: ['Day leans bullish (+0.60) · with this trade'], today: ['62% chance'], oiWall: [], velocity: [], regime: ['Balanced PCR'] },
} as StrategySetup);

describe('breakevenLabel', () => {
  it('gives a call its strike plus the premium, and the distance from spot', () => {
    expect(breakevenLabel(sell(OptionSetup.SellCe, [25100], 35), 25010)).toBe('BE 25,135 · +125');
  });

  it('gives a put its strike minus the premium', () => {
    expect(breakevenLabel(sell(OptionSetup.SellPe, [24900], 40), 25010)).toBe('BE 24,860 · −150');
  });

  it('gives a straddle and a strangle both breakevens', () => {
    expect(breakevenLabel(sell(OptionSetup.SellStraddle, [25000], 200), 25010)).toBe('BE 24,800 – 25,200');
    expect(breakevenLabel(sell(OptionSetup.SellStrangle, [25200, 24800], 60), 25010)).toBe('BE 24,740 – 25,260');
  });

  it('leaves the distance out without a spot price', () => {
    expect(breakevenLabel(sell(OptionSetup.SellCe, [25100], 35), 0)).toBe('BE 25,135');
  });
});

describe('scorePartsOf', () => {
  it('pairs each sell part with its points and reasons, in display order', () => {
    const parts = scorePartsOf(sell(OptionSetup.SellCe, [25100], 35));
    expect(parts.map((part) => [part.label, part.points, part.max])).toEqual([
      ['Direction', 30, 40], ['Today', 20, 25], ['OI Wall', 10, 15], ['Velocity', 5, 10], ['Regime', 5, 10],
    ]);
    expect(parts[4].reasons).toEqual(['Balanced PCR']);
  });

  it('lists every reason part by part', () => {
    expect(allReasons(sell(OptionSetup.SellCe, [25100], 35))).toEqual(['Day leans bullish (+0.60) · with this trade', '62% chance', 'Balanced PCR']);
  });
});
