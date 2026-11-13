import { describe, it, expect } from 'vitest';
import { tradePnl, tradePnlPercent } from './tradePnl.js';

describe('tradePnl', () => {
  const bought = { side: 'BUY', quantity: 50, entryPrice: 200 };
  const sold = { side: 'SELL', quantity: 75, entryPrice: 100 };

  it('gains for a bought trade as the price rises, and for a sold one as it falls', () => {
    expect(tradePnl(bought, 210)).toBe(500);
    expect(tradePnl(bought, 190)).toBe(-500);
    expect(tradePnl(sold, 90)).toBe(750);
    expect(tradePnl(sold, 120)).toBe(-1500);
  });

  it('is 0 at the entry price', () => {
    expect(tradePnl(sold, 100)).toBe(0);
  });
});

describe('tradePnlPercent', () => {
  it('is the P&L as a percentage of the entry price, the same for any quantity', () => {
    expect(tradePnlPercent({ side: 'SELL', entryPrice: 100 }, 120)).toBe(-20);
    expect(tradePnlPercent({ side: 'SELL', entryPrice: 100 }, 70)).toBe(30);
    expect(tradePnlPercent({ side: 'BUY', entryPrice: 200 }, 210)).toBe(5);
    expect(tradePnlPercent({ side: 'BUY', entryPrice: 200 }, 200)).toBe(0);
  });

  it('can lose more than 100% on a sold option whose price more than doubles', () => {
    expect(tradePnlPercent({ side: 'SELL', entryPrice: 50 }, 130)).toBe(-160);
  });
});
