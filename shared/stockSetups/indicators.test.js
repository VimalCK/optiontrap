import { describe, it, expect } from 'vitest';
import { averageTrueRange, relativeStrengthIndex } from './indicators.js';
import { roundStep } from './zones.js';
import { day } from './candles.fixture.js';

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
