import { describe, it, expect, vi, afterEach } from 'vitest';
import { cancelOrder, exitPosition, fetchOpenOrders, placeMarketTrade, placeOrder, placedOrderMessage, placedOrderRefused, type PaperOrder } from './orders';
import { ApiError } from './apiClient';
import { Horizon } from '../../shared/horizons.js';

/** Make fetch answer with `status` and a JSON body, the way the server does. */
function serverReplies(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const order = (extra: Partial<PaperOrder> = {}): PaperOrder => ({
  id: 'o1', tradingsymbol: 'NIFTY26N1024000CE', instrumentToken: 101, instrumentType: 'CE', exchange: 'NFO', strike: 24000,
  optionType: 'CE', expiry: '2026-11-10', side: 'BUY', quantity: 75, orderType: 'limit', limitPrice: 50, status: 'open', statusReason: null,
  fillPrice: null, positionId: null, closesPosition: false, source: 'manual', horizon: Horizon.Intraday, autoTradeId: null, createdAt: '2026-11-05T06:30:00.000Z', updatedAt: '2026-11-05T06:30:00.000Z', ...extra,
});

describe('placeOrder', () => {
  it('posts the order with its type and limit price and returns the placed order', async () => {
    const fetchMock = serverReplies(201, { status: 'ok', data: order() });
    const placed = await placeOrder({
      tradingsymbol: 'NIFTY26N1024000CE', instrumentToken: 101, strike: 24000, optionType: 'CE', side: 'BUY', quantity: 75, orderType: 'limit', limitPrice: 50, expiry: '2026-11-10', horizon: Horizon.Intraday,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/orders');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({ orderType: 'limit', limitPrice: 50, side: 'BUY' });
    expect(placed.status).toBe('open');
  });

  it("rejects with the server's reason, e.g. the market is closed", async () => {
    serverReplies(409, { status: 'error', code: 'MARKET_CLOSED', message: 'Paper trades can only be placed during market hours' });
    const err = await placeOrder({
      tradingsymbol: 'X', instrumentToken: 1, strike: null, optionType: null, side: 'BUY', quantity: 1, orderType: 'limit', limitPrice: 5, expiry: null, horizon: Horizon.Intraday,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Paper trades can only be placed during market hours');
  });
});

describe('fetchOpenOrders and cancelOrder', () => {
  it('asks for the open orders, whenever they were placed', async () => {
    const fetchMock = serverReplies(200, { status: 'ok', data: [order()] });
    expect(await fetchOpenOrders()).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/orders?status=open');
  });

  it('cancels with a PATCH to the order, status cancelled', async () => {
    const fetchMock = serverReplies(200, { status: 'ok', data: order({ status: 'cancelled' }) });
    await cancelOrder('o1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/orders/o1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'cancelled' });
  });
});

describe('placedOrderMessage', () => {
  it('says whether the order filled at once, waits for its price, or was refused', () => {
    expect(placedOrderMessage(order({ status: 'filled', fillPrice: 40 }), 'BUY 24000CE')).toBe('BUY 24000CE filled @ 40.00');
    expect(placedOrderMessage(order(), 'BUY 24000CE')).toBe('BUY 24000CE limit @ 50.00 placed · fills when the price reaches it');
    expect(placedOrderMessage(order({ status: 'cancelled', statusReason: 'Market closed' }), 'BUY 24000CE')).toBe('BUY 24000CE not filled · Market closed');
    expect(placedOrderMessage(order({ orderType: 'market', limitPrice: null }), 'BUY 24000CE')).toBe('BUY 24000CE market order placed · fills when the market opens');
  });
});

describe('placeMarketTrade', () => {
  const trade = (horizon: 1 | 2) => ({
    tradingsymbol: 'NIFTY26N1024000CE', instrumentToken: 101, strike: 24000, optionType: 'CE' as const, side: 'BUY' as const, quantity: 75, expiry: '2026-11-10', horizon,
  });

  it('places every trade, intraday or positional, as a market order', async () => {
    for (const horizon of [Horizon.Intraday, Horizon.Positional]) {
      const fetchMock = serverReplies(201, { status: 'ok', data: order({ orderType: 'market', limitPrice: null, horizon }) });
      await placeMarketTrade(trade(horizon));
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/orders');
      expect(JSON.parse(String(init?.body))).toEqual({ ...trade(horizon), orderType: 'market' });
    }
  });

  it('says a filled market order filled at its price, and a cancelled one was refused', () => {
    const filled = order({ orderType: 'market', limitPrice: null, status: 'filled', fillPrice: 50.5 });
    expect(placedOrderMessage(filled, 'BUY 24000CE')).toBe('BUY 24000CE filled @ 50.50');
    expect(placedOrderRefused(filled)).toBe(false);
    expect(placedOrderRefused(order({ status: 'cancelled' }))).toBe(true);
  });
});

describe('exitPosition', () => {
  it('posts an order for the position with the last price shown, and returns the closing order', async () => {
    const fetchMock = serverReplies(201, { status: 'ok', data: order({ orderType: 'market', limitPrice: null, status: 'filled', fillPrice: 119.5, closesPosition: true, positionId: 'p1' }) });
    const exit = await exitPosition('p1', 120);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/orders');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ positionId: 'p1', exitPrice: 120 });
    expect(exit.closesPosition).toBe(true);
  });
});
