import { describe, it, expect } from 'vitest';
import { withSpot, type OiSnapshot } from './oiSnapshots';

// One row holding two symbols: index price token 1 (24000) and stock price token 2 (1400).
const snap = (prices: Record<string, number>): OiSnapshot => ({ timestamp: 0, timeLabel: '10:00', data: { 100: 5000 }, prices });

describe('withSpot', () => {
  it("takes the analysed symbol's spot from prices, by its price token", () => {
    const rows = [snap({ 1: 24000, 2: 1400, 100: 90 })];
    expect(withSpot(rows, 1)[0].spot).toBe(24000);
    expect(withSpot(rows, 2)[0].spot).toBe(1400);
  });

  it('leaves spot unset when the symbol has no price in a row, or no price token', () => {
    const rows = [{ ...snap({ 1: 24000 }), spot: 24000 }]; // an older row with the single stored spot
    expect(withSpot(rows, 2)[0].spot).toBeUndefined();
    expect(withSpot(rows, null)[0].spot).toBeUndefined();
  });
});
