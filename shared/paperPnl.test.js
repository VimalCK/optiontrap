import { describe, it, expect } from 'vitest';
import { paperPnl, paperPnlPercent } from './paperPnl.js';

describe('paperPnl', () => {
  const bought = { side: 'BUY', quantity: 50, entryPrice: 200 };
  const sold = { side: 'SELL', quantity: 75, entryPrice: 100 };

  it('gains for a bought trade as the price rises, and for a sold one as it falls', () => {
    expect(paperPnl(bought, 210)).toBe(500);
    expect(paperPnl(bought, 190)).toBe(-500);
    expect(paperPnl(sold, 90)).toBe(750);
    expect(paperPnl(sold, 120)).toBe(-1500);
  });

  it('is 0 at the entry price', () => {
    expect(paperPnl(sold, 100)).toBe(0);
  });
});

describe('paperPnlPercent', () => {
  it('is the P&L as a percentage of the entry price, the same for any quantity', () => {
    expect(paperPnlPercent({ side: 'SELL', entryPrice: 100 }, 120)).toBe(-20);
    expect(paperPnlPercent({ side: 'SELL', entryPrice: 100 }, 70)).toBe(30);
    expect(paperPnlPercent({ side: 'BUY', entryPrice: 200 }, 210)).toBe(5);
    expect(paperPnlPercent({ side: 'BUY', entryPrice: 200 }, 200)).toBe(0);
  });

  it('can lose more than 100% on a sold option whose price more than doubles', () => {
    expect(paperPnlPercent({ side: 'SELL', entryPrice: 50 }, 130)).toBe(-160);
  });
});
