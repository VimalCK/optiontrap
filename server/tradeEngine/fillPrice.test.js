import { describe, it, expect, vi } from 'vitest';
import { marketFillPrice, quotedFillPrice } from './fillPrice.js';

const quote = { last_price: 60, depth: { buy: [{ price: 59.8, quantity: 750 }], sell: [{ price: 60.25, quantity: 300 }] } };

describe('marketFillPrice', () => {
  it('fills a buy at the best ask and a sell at the best bid, not the last price', () => {
    expect(marketFillPrice(quote, 'BUY')).toBe(60.25);
    expect(marketFillPrice(quote, 'SELL')).toBe(59.8);
  });

  it('has no fill when the quote has no bid / ask (empty depth, zero prices, or no quote)', () => {
    expect(marketFillPrice({ last_price: 60, depth: { buy: [], sell: [] } }, 'BUY')).toBeNull();
    expect(marketFillPrice({ depth: { buy: [{ price: 0 }], sell: [{ price: 0 }] } }, 'SELL')).toBeNull();
    expect(marketFillPrice(undefined, 'BUY')).toBeNull();
  });
});

describe('quotedFillPrice', () => {
  it("quotes the instrument by its exchange key with the session given", async () => {
    const quotes = vi.fn().mockResolvedValue({ 'NFO:NIFTY26N1024000PE': quote });
    const kite = { apiKey: 'k', accessToken: 't' };
    expect(await quotedFillPrice(kite, { exchange: 'NFO', tradingsymbol: 'NIFTY26N1024000PE' }, 'SELL', quotes)).toBe(59.8);
    expect(quotes).toHaveBeenCalledWith(kite, ['NFO:NIFTY26N1024000PE']);
  });
});
