import { describe, it, expect } from 'vitest';
import { paperPnl } from './paperPnl.js';

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
