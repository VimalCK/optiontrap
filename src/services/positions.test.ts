import { describe, it, expect, vi, afterEach } from 'vitest';
import { addPosition, exitPosition, instrumentName, positionQuoteKey, tradeErrorMessage } from './positions';
import { ApiError, isLoginEnded } from './apiClient';

const MARKET_CLOSED = 'The market is closed. Paper trades can be placed and exited 9:15–15:30 IST on trading days.';

/** Make fetch answer with `status` and a JSON body, the way the server does. */
function serverReplies(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const trade = {
  tradingsymbol: 'NIFTY26NOV24000CE',
  instrumentToken: 1001,
  strike: 24000,
  optionType: 'CE' as const,
  side: 'BUY' as const,
  quantity: 75,
  entryPrice: 100,
  expiry: '2026-11-24',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('placing a paper trade while the market is closed', () => {
  it('rejects with the server’s reason, which the toast then shows', async () => {
    serverReplies(409, { status: 'error', code: 'MARKET_CLOSED', message: MARKET_CLOSED });

    const err = await addPosition(trade).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect(tradeErrorMessage(err)).toBe(MARKET_CLOSED);
  });

  it('does not treat the refusal as an expired login', async () => {
    const body = { status: 'error', code: 'MARKET_CLOSED', message: MARKET_CLOSED };
    expect(isLoginEnded(409, body)).toBe(false);

    serverReplies(409, body);
    const err = await addPosition(trade).catch((e: unknown) => e);
    expect((err as ApiError).message).toBe(MARKET_CLOSED); // not "Session expired. Please login again."
  });
});

describe('exiting a paper trade while the market is closed', () => {
  it('sends PATCH /api/positions/:id and rejects with the server’s reason', async () => {
    const fetchMock = serverReplies(409, { status: 'error', code: 'MARKET_CLOSED', message: MARKET_CLOSED });

    const err = await exitPosition('p1', 120).catch((e: unknown) => e);

    expect(fetchMock).toHaveBeenCalledWith('/api/positions/p1', expect.objectContaining({ method: 'PATCH' }));
    expect(tradeErrorMessage(err, 'Failed to exit position')).toBe(MARKET_CLOSED);
  });
});

describe('tradeErrorMessage', () => {
  it('uses the server’s message from an API error', () => {
    expect(tradeErrorMessage(new ApiError('Missing required fields', 400))).toBe('Missing required fields');
  });

  it('falls back when the request never reached the server', () => {
    expect(tradeErrorMessage(new TypeError('Failed to fetch'))).toBe('Failed to add position');
    expect(tradeErrorMessage(new TypeError('Failed to fetch'), 'Failed to exit position')).toBe('Failed to exit position');
  });

  it('falls back for anything that is not an error', () => {
    expect(tradeErrorMessage(undefined)).toBe('Failed to add position');
  });
});

describe('positionQuoteKey', () => {
  it("uses the position's own exchange", () => {
    expect(positionQuoteKey({ exchange: 'NFO', tradingsymbol: 'NIFTY26NOV24000CE' })).toBe('NFO:NIFTY26NOV24000CE');
    expect(positionQuoteKey({ exchange: 'NSE', tradingsymbol: 'RELIANCE' })).toBe('NSE:RELIANCE');
  });
});

describe('instrumentName', () => {
  it("shows a stock's full symbol and an F&O contract's underlying", () => {
    expect(instrumentName({ instrumentType: 'EQ', tradingsymbol: 'M&M' })).toBe('M&M');
    expect(instrumentName({ instrumentType: 'EQ', tradingsymbol: '360ONE' })).toBe('360ONE'); // starts with a digit
    expect(instrumentName({ instrumentType: 'CE', tradingsymbol: 'NIFTY26NOV24000CE' })).toBe('NIFTY');
    expect(instrumentName({ instrumentType: 'FUT', tradingsymbol: 'RELIANCE26NOVFUT' })).toBe('RELIANCE');
  });
});
