import { describe, it, expect, vi, afterEach } from 'vitest';
import { cancelPaperOrder, fetchPaperOrders, placeLimitOrder, placedOrderMessage, type PaperOrder } from './paperOrders';
import { ApiError } from './apiClient';

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
  optionType: 'CE', expiry: '2026-11-10', side: 'BUY', quantity: 75, limitPrice: 50, status: 'open', statusReason: null,
  fillPrice: null, positionId: null, createdAt: '2026-11-05T06:30:00.000Z', updatedAt: '2026-11-05T06:30:00.000Z', ...extra,
});

describe('placeLimitOrder', () => {
  it('posts the order with its limit price and returns the placed order', async () => {
    const fetchMock = serverReplies(201, { status: 'ok', data: order() });
    const placed = await placeLimitOrder({
      tradingsymbol: 'NIFTY26N1024000CE', instrumentToken: 101, strike: 24000, optionType: 'CE', side: 'BUY', quantity: 75, limitPrice: 50, expiry: '2026-11-10',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/paper-orders');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({ limitPrice: 50, side: 'BUY' });
    expect(placed.status).toBe('open');
  });

  it("rejects with the server's reason, e.g. the market is closed", async () => {
    serverReplies(409, { status: 'error', code: 'MARKET_CLOSED', message: 'Paper trades can only be placed during market hours' });
    const err = await placeLimitOrder({
      tradingsymbol: 'X', instrumentToken: 1, strike: null, optionType: null, side: 'BUY', quantity: 1, limitPrice: 5, expiry: null,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Paper trades can only be placed during market hours');
  });
});

describe('fetchPaperOrders and cancelPaperOrder', () => {
  it('asks for exactly the range picked', async () => {
    const fetchMock = serverReplies(200, { status: 'ok', data: [order()] });
    expect(await fetchPaperOrders({ from: '2026-11-05', to: '2026-11-05' })).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/paper-orders?from=2026-11-05&to=2026-11-05');
  });

  it('cancels with a PATCH to the order, status cancelled', async () => {
    const fetchMock = serverReplies(200, { status: 'ok', data: order({ status: 'cancelled' }) });
    await cancelPaperOrder('o1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/paper-orders/o1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'cancelled' });
  });
});

describe('placedOrderMessage', () => {
  it('says whether the order filled at once, waits for its price, or was refused', () => {
    expect(placedOrderMessage(order({ status: 'filled', fillPrice: 40 }), 'BUY 24000CE')).toBe('BUY 24000CE filled @ 40.00');
    expect(placedOrderMessage(order(), 'BUY 24000CE')).toBe('BUY 24000CE limit @ 50.00 placed · fills when the price reaches it');
    expect(placedOrderMessage(order({ status: 'cancelled', statusReason: 'Market closed' }), 'BUY 24000CE')).toBe('BUY 24000CE not filled · Market closed');
  });
});
