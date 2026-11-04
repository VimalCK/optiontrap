import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Holding, QuoteData } from './kiteApi';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('./apiClient', () => ({ apiClient: { get: apiGet } }));

import { applyQuotes, fetchPricedHoldings, priceHolding } from './holdings';

function holding(tradingsymbol: string, exchange: string, quantity: number, average_price: number,
  last_price: number, close_price: number, collateral_quantity = 0): Holding {
  return {
    tradingsymbol, exchange, instrument_token: 1, isin: '', product: 'CNC',
    quantity, opening_quantity: quantity || collateral_quantity, t1_quantity: 0, realised_quantity: quantity, used_quantity: 0,
    average_price, last_price, close_price,
    pnl: (last_price - average_price) * (quantity || collateral_quantity),
    day_change: last_price - close_price, day_change_percentage: 0,
    collateral_quantity, collateral_type: collateral_quantity ? 'pledge' : '',
  };
}

// Prod's Kite reply on 2026-11-05, with a stale last_price…
const STALE = [
  holding('AWL', 'BSE', 1000, 348.725, 163.7, 164.35),
  holding('BAJAJHFL', 'BSE', 2500, 101.90288, 79.4, 78.2),
  holding('IRCTC', 'NSE', 300, 705.15, 447.75, 447.5),
  holding('JIOFIN', 'NSE', 1500, 285.155766, 214.65, 214.27),
  holding('LICI', 'NSE', 0, 472.445, 405, 395.5, 500),
  holding('NSDL', 'BSE', 110, 812.551363, 744.05, 730.65),
  holding('TATAPOWER', 'NSE', 1000, 376.975, 355.7, 356.55),
  holding('TATSILV', 'NSE', 10000, 25.524436, 17.94, 16.99),
];
// …and the actual prices at the same moment.
const PRICES: Record<string, number> = {
  'BSE:AWL': 163.85, 'BSE:BAJAJHFL': 81.37, 'NSE:IRCTC': 450, 'NSE:JIOFIN': 222.27,
  'NSE:LICI': 408, 'BSE:NSDL': 748.6, 'NSE:TATAPOWER': 360, 'NSE:TATSILV': 18,
};
const quote = (last_price: number): QuoteData => ({ last_price, oi: 0, volume: 0, ohlc: { open: 0, high: 0, low: 0, close: 0 } });
const quotes = new Map(Object.entries(PRICES).map(([key, price]) => [key, quote(price)]));

const qty = (h: Holding) => h.quantity || h.collateral_quantity;
const dayChangeTotal = (hs: Holding[]) => hs.reduce((sum, h) => sum + h.day_change * qty(h), 0);
const pnlTotal = (hs: Holding[]) => hs.reduce((sum, h) => sum + h.pnl, 0);

beforeEach(() => apiGet.mockReset());

describe('applyQuotes', () => {
  it('replaces a stale holdings price with the quote, fixing day change and P&L', () => {
    expect(dayChangeTotal(STALE)).toBeCloseTo(17869, 2);

    const priced = applyQuotes(STALE, quotes);

    expect(priced.map((h) => h.last_price)).toEqual(Object.values(PRICES));
    expect(dayChangeTotal(priced)).toBeCloseTo(41949.5, 2);
    expect(priced.find((h) => h.tradingsymbol === 'AWL')!.pnl).toBeCloseTo(-184875, 2);
    expect(priced.find((h) => h.tradingsymbol === 'LICI')!.pnl).toBeCloseTo(-32222.5, 2); // pledged shares
    expect(pnlTotal(priced)).toBeGreaterThan(pnlTotal(STALE));
  });

  it("keeps Kite's figures for a holding without a quote", () => {
    expect(applyQuotes(STALE, new Map())).toEqual(STALE);
  });
});

describe('priceHolding', () => {
  it('works out day change from the close it is given', () => {
    const h = priceHolding(STALE[2], 450, 440);
    expect(h).toMatchObject({ last_price: 450, close_price: 440, day_change: 10 });
    expect(h.day_change_percentage).toBeCloseTo(2.2727, 3);
  });
});

describe('fetchPricedHoldings', () => {
  it('asks for a quote for every holding and prices them from it', async () => {
    apiGet.mockImplementation(async (url: string) =>
      url === '/api/portfolio/holdings' ? STALE : Object.fromEntries(Object.entries(PRICES).map(([k, p]) => [k, quote(p)])));

    const priced = await fetchPricedHoldings();

    const quoteUrl = apiGet.mock.calls.map(([url]) => url as string).find((url) => url.startsWith('/api/quote?'))!;
    expect(quoteUrl).toContain('i=BSE%3AAWL');
    expect(quoteUrl).toContain('i=NSE%3ATATSILV');
    expect(dayChangeTotal(priced)).toBeCloseTo(41949.5, 2);
  });

  // A fetch given an aborted signal rejects without sending anything.
  it('passes the signal to both requests and stops, without a fallback, once cancelled', async () => {
    const controller = new AbortController();
    apiGet.mockImplementation(async (url: string, options?: { signal?: AbortSignal }) => {
      if (url === '/api/portfolio/holdings') {
        controller.abort(); // the page closed while holdings were loading
        return STALE;
      }
      if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return {};
    });

    await expect(fetchPricedHoldings(controller.signal)).rejects.toThrow('Aborted');
    expect(apiGet).toHaveBeenCalledWith('/api/portfolio/holdings', { signal: controller.signal });
    expect(apiGet.mock.calls.filter(([url]) => (url as string).startsWith('/api/quote'))).toHaveLength(1);
  });

  it("falls back to Kite's figures when quotes fail", async () => {
    apiGet.mockResolvedValueOnce(STALE).mockRejectedValueOnce(new Error('quote down'));

    expect(await fetchPricedHoldings()).toEqual(STALE);
  });
});
