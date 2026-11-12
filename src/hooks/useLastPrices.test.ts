import { describe, it, expect } from 'vitest';
import { applyPriceTicks, applyQuotedPrices, instrumentsKey } from './useLastPrices';
import type { Tick } from '@/services/kiteTicker';

const tick = (instrumentToken: number, lastPrice: number) => ({ instrumentToken, lastPrice }) as Tick;

describe('applyPriceTicks', () => {
  it('sets each ticked instrument to its last price and keeps the rest', () => {
    const next = applyPriceTicks(new Map([[1, 10], [2, 20]]), [tick(2, 21), tick(3, 30)]);
    expect([...next]).toEqual([[1, 10], [2, 21], [3, 30]]);
  });
});

describe('applyQuotedPrices', () => {
  it('fills only instruments no tick has priced, as a tick is newer than the quote', () => {
    const next = applyQuotedPrices(new Map([[1, 11]]), new Map([[1, 10], [2, 20]]));
    expect([...next]).toEqual([[1, 11], [2, 20]]);
  });
});

describe('instrumentsKey', () => {
  it('is the same for the same set in any order or with repeats, so feeds resubscribe only when it changes', () => {
    const a = { instrumentToken: 1, exchange: 'NFO', tradingsymbol: 'A' };
    const b = { instrumentToken: 2, exchange: 'NSE', tradingsymbol: 'B' };
    expect(instrumentsKey([a, b, a])).toBe(instrumentsKey([b, a]));
    expect(instrumentsKey([a])).not.toBe(instrumentsKey([a, b]));
    expect(instrumentsKey([])).toBe('');
  });
});
