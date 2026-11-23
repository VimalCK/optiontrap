import { describe, it, expect, vi } from 'vitest';

// Keep the real database out of the default dependencies.
vi.mock('../../../db.js', () => ({}));

const { manualExit } = await import('./manualPositions.js');

// Bought at 100 with a target of 120 and a stop-loss of 90, from the order popup.
const bought = { id: 'm1', userId: 'U1', instrumentToken: 505, tradingsymbol: 'NIFTY26NOV24000CE', side: 'BUY', quantity: 75, entryPrice: 100,
  targetPrice: 120, stopLossPrice: 90, trailAmount: null };
// Sold at 100 with a target of 80 and a stop-loss of 110.
const sold = { ...bought, id: 'm2', side: 'SELL', targetPrice: 80, stopLossPrice: 110 };

describe('manualExit', () => {
  it('exits at the stop-loss and at the target, the right way round for a buy and a sell', () => {
    expect(manualExit(bought, 90, 100)).toEqual({ ruleId: 'stop-loss', reason: 'Stop-loss hit (₹90)' });
    expect(manualExit(bought, 120, 120)).toEqual({ ruleId: 'target', reason: 'Target hit (₹120)' });
    expect(manualExit(sold, 110, 100)).toEqual({ ruleId: 'stop-loss', reason: 'Stop-loss hit (₹110)' });
    expect(manualExit(sold, 80, 80)).toEqual({ ruleId: 'target', reason: 'Target hit (₹80)' });
  });

  it('keeps the position between its levels, and uses only the levels it has', () => {
    expect(manualExit(bought, 90.05, 100)).toBeNull();
    expect(manualExit(bought, 119.95, 119.95)).toBeNull();
    expect(manualExit({ ...bought, targetPrice: null }, 150, 150)).toBeNull();
    expect(manualExit({ ...bought, stopLossPrice: null }, 50, 100)).toBeNull();
  });

  describe('with a trailing stop-loss of ₹5', () => {
    const trailingBuy = { ...bought, trailAmount: 5 };
    const trailingSell = { ...sold, trailAmount: 5 };

    it("doesn't exit at the target, and exits once the price falls back the trail from its best", () => {
      expect(manualExit(trailingBuy, 120, 120)).toBeNull();
      expect(manualExit(trailingBuy, 125.05, 130)).toBeNull();
      expect(manualExit(trailingBuy, 125, 130)).toEqual({ ruleId: 'target', reason: 'Trailing stop-loss hit (best ₹130, trail ₹5, target ₹120)' });
      expect(manualExit(trailingSell, 79.95, 75)).toBeNull();
      expect(manualExit(trailingSell, 80, 75)).toEqual({ ruleId: 'target', reason: 'Trailing stop-loss hit (best ₹75, trail ₹5, target ₹80)' });
    });

    it("doesn't start before the target, where the stop-loss still applies", () => {
      expect(manualExit(trailingBuy, 113, 118)).toBeNull();
      expect(manualExit(trailingBuy, 90, 118)).toEqual({ ruleId: 'stop-loss', reason: 'Stop-loss hit (₹90)' });
    });
  });
});
