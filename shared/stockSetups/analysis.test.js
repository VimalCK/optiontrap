import { describe, it, expect } from 'vitest';
import { analyzeStock } from './analysis.js';
import { fromCloses, oscillate } from './candles.fixture.js';

describe('analyzeStock', () => {
  it('puts a tested support zone under a range-bound stock and plans around it', () => {
    const closes = [...oscillate(200, 100, 120), 104, 103];
    const analysis = analyzeStock(fromCloses(closes));
    const support = analysis.supports[0];
    expect(support.low).toBeLessThan(101);
    expect(support.high).toBeGreaterThan(99);
    expect(support.history.tests).toBeGreaterThan(3);
    // Every resolved test held; the latest dip can still be unresolved.
    expect(support.history.failed).toBe(0);
    expect(support.history.held).toBeGreaterThanOrEqual(support.history.tests - 1);
    expect(analysis.resistances[0].low).toBeGreaterThan(103);
    expect(analysis.resistances.some((r) => r.high > 119)).toBe(true);
    expect(analysis.plan).toContain('held');
  });

  it('needs enough history', () => {
    expect(analyzeStock(fromCloses(oscillate(30, 100, 120)))).toBeNull();
  });
});
