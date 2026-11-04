import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KitePosition, KitePositions, QuoteData } from './kiteApi';
import type { Tick } from './kiteTicker';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('./apiClient', () => ({ apiClient: { get: apiGet } }));

import {
  applyPositionQuotes,
  applyPositionTicks,
  fetchPricedPositions,
  openPositionTokens,
  positionPnl,
  positionsPnl,
} from './livePositions';

/** A position from its trades: bought `buy` and sold `sell` (quantity, price). */
function position(tradingsymbol: string, instrument_token: number, buy: [number, number], sell: [number, number], last_price: number,
  extra: Partial<KitePosition> = {}): KitePosition {
  const [buyQty, buyPrice] = buy;
  const [sellQty, sellPrice] = sell;
  const quantity = buyQty - sellQty;
  const p = {
    tradingsymbol, exchange: 'NFO', instrument_token, product: 'NRML', quantity, overnight_quantity: 0,
    multiplier: 1, average_price: quantity >= 0 ? buyPrice : sellPrice, close_price: 0, last_price, value: 0, pnl: 0, m2m: 0,
    unrealised: 0, realised: 0, buy_quantity: buyQty, buy_price: buyPrice, buy_value: buyQty * buyPrice, buy_m2m: 0,
    sell_quantity: sellQty, sell_price: sellPrice, sell_value: sellQty * sellPrice, sell_m2m: 0, day_buy_quantity: 0,
    day_buy_price: 0, day_buy_value: 0, day_sell_quantity: 0, day_sell_price: 0, day_sell_value: 0,
    ...extra,
  };
  return { ...p, pnl: positionPnl(p, last_price) };
}

const quote = (last_price: number): QuoteData => ({ last_price, oi: 0, volume: 0, ohlc: { open: 0, high: 0, low: 0, close: 0 } });
const tick = (instrumentToken: number, lastPrice: number) => ({ instrumentToken, lastPrice }) as Tick;

// Bought 150 at 100, sold 75 of them at 130: 2,250 booked, 75 still open.
const PARTLY_CLOSED = position('NIFTY26NOV24000CE', 1, [150, 100], [75, 130], 110);
// Sold 75 at 200, still short.
const SHORT = position('NIFTY26NOV24000PE', 2, [0, 0], [75, 200], 180);
// Bought and sold 75: closed, 1,500 booked.
const CLOSED = position('BANKNIFTY26NOV52000CE', 3, [75, 300], [75, 320], 310);

const POSITIONS: KitePositions = { net: [PARTLY_CLOSED, SHORT, CLOSED], day: [PARTLY_CLOSED] };

beforeEach(() => apiGet.mockReset());

describe('positionPnl', () => {
  it('keeps the P&L booked on the closed part of a position', () => {
    // 75 × (130 − 100) booked + 75 × (120 − 100) open = 2,250 + 1,500
    expect(positionPnl(PARTLY_CLOSED, 120)).toBe(3750);
    // The old (ltp − avg) × qty gave only the open part:
    expect((120 - PARTLY_CLOSED.average_price) * PARTLY_CLOSED.quantity).toBe(1500);
  });

  it('gains on a short position as the price falls', () => {
    expect(positionPnl(SHORT, 150)).toBe(75 * (200 - 150));
  });

  it('does not depend on the price once the position is closed', () => {
    expect(positionPnl(CLOSED, 0)).toBe(1500);
    expect(positionPnl(CLOSED, 999)).toBe(1500);
  });

  it('applies the multiplier', () => {
    const currency = position('USDINR26NOVFUT', 4, [1, 83], [0, 0], 83, { multiplier: 1000, exchange: 'CDS' });
    expect(positionPnl({ ...currency, buy_value: 83 * 1000 }, 83.5)).toBe(500);
  });
});

describe('applyPositionQuotes', () => {
  it('re-prices open positions in both lists and leaves closed ones alone', () => {
    const quotes = new Map([['NFO:NIFTY26NOV24000CE', quote(120)], ['NFO:NIFTY26NOV24000PE', quote(150)], ['NFO:BANKNIFTY26NOV52000CE', quote(999)]]);

    const priced = applyPositionQuotes(POSITIONS, quotes);

    expect(priced.net.map((p) => [p.last_price, p.pnl])).toEqual([[120, 3750], [150, 3750], [310, 1500]]);
    expect(priced.day[0]).toEqual(priced.net[0]);
  });

  it("keeps Kite's figures for a position without a quote", () => {
    expect(applyPositionQuotes(POSITIONS, new Map())).toEqual(POSITIONS);
  });
});

describe('applyPositionTicks', () => {
  it('gives the same figures as quotes for the same price, so every screen agrees', () => {
    const byTick = applyPositionTicks(POSITIONS, [tick(1, 120), tick(2, 150)]);
    const byQuote = applyPositionQuotes(POSITIONS, new Map([['NFO:NIFTY26NOV24000CE', quote(120)], ['NFO:NIFTY26NOV24000PE', quote(150)]]));
    expect(byTick).toEqual(byQuote);
    expect(positionsPnl(byTick.net)).toBe(3750 + 3750 + 1500);
  });
});

describe('openPositionTokens', () => {
  it('lists each open instrument once, across net and day', () => {
    expect(openPositionTokens(POSITIONS)).toEqual([1, 2]);
  });
});

describe('fetchPricedPositions', () => {
  it('asks for quotes for open positions only, and prices them', async () => {
    apiGet.mockResolvedValueOnce(POSITIONS).mockResolvedValueOnce({ 'NFO:NIFTY26NOV24000CE': quote(120), 'NFO:NIFTY26NOV24000PE': quote(150) });

    const priced = await fetchPricedPositions();

    const quoteUrl = apiGet.mock.calls[1][0] as string;
    expect(quoteUrl).toContain('NIFTY26NOV24000CE');
    expect(quoteUrl).toContain('NIFTY26NOV24000PE');
    expect(quoteUrl).not.toContain('BANKNIFTY');
    expect(positionsPnl(priced.net)).toBe(9000);
  });

  it('makes no quote request when nothing is open', async () => {
    apiGet.mockResolvedValueOnce({ net: [CLOSED], day: [] });
    await fetchPricedPositions();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it("falls back to Kite's figures when quotes fail", async () => {
    apiGet.mockResolvedValueOnce(POSITIONS).mockRejectedValueOnce(new Error('quote down'));
    expect(await fetchPricedPositions()).toEqual(POSITIONS);
  });
});
