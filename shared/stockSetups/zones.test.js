import { describe, it, expect } from 'vitest';
import { mergeLevels, swingLevels, zoneHistory } from './zones.js';
import { fromCloses, oscillate } from './candles.fixture.js';

describe('levels and zones', () => {
  it('finds the turning points of a swinging price', () => {
    const levels = swingLevels(fromCloses(oscillate(100, 100, 120)));
    const lows = levels.filter((l) => l.kind === 'SwingLow');
    const highs = levels.filter((l) => l.kind === 'SwingHigh');
    expect(lows.length).toBeGreaterThanOrEqual(3);
    expect(highs.length).toBeGreaterThanOrEqual(3);
    for (const l of lows) expect(l.price).toBeLessThan(101);
    for (const h of highs) expect(h.price).toBeGreaterThan(119);
  });

  it('merges nearby levels, counts repeats, and drops round-number-only zones', () => {
    const zones = mergeLevels([
      { price: 100, kind: 'SwingLow', weight: 1 },
      { price: 100.4, kind: 'SwingLow', weight: 1 },
      { price: 100.8, kind: 'Volume', weight: 1.5 },
      { price: 150, kind: 'Round', weight: 0.5 },
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
    expect(zoneHistory(held, z, 'Support', 0.03, 0.02)).toMatchObject({ tests: 4, held: 4, failed: 0 });
    // One dip that keeps falling through the zone.
    const broke = fromCloses([110, 108, 106, 104, 103, 102, 100.5, 98, 95, 92, 90, 89, 88]);
    expect(zoneHistory(broke, z, 'Support', 0.03, 0.02)).toMatchObject({ tests: 1, held: 0, failed: 1 });
  });
});
