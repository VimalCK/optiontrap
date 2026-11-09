import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchAutoTradeResults, fetchAutoTrades } from './automation';
import { ApiError } from './apiClient';

/** Make fetch answer with `status` and a JSON body, the way the server does. */
function serverReplies(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchAutoTrades', () => {
  it('asks for exactly the range picked and returns the trades', async () => {
    const fetchMock = serverReplies(200, { status: 'ok', data: [{ id: 't1' }] });

    const trades = await fetchAutoTrades({ from: '2026-11-01', to: '2026-11-05' });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/automation/trades?from=2026-11-01&to=2026-11-05');
    expect(trades).toEqual([{ id: 't1' }]);
  });

  it("rejects with the server's reason for a bad range", async () => {
    serverReplies(400, { status: 'error', message: 'from must not be after to' });

    const err = await fetchAutoTrades({ from: '2026-11-05', to: '2026-11-01' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('from must not be after to');
  });
});

describe('fetchAutoTradeResults', () => {
  it('asks for the results of exactly the range picked', async () => {
    const fetchMock = serverReplies(200, { status: 'ok', data: { summary: { trades: 0 } } });

    const results = await fetchAutoTradeResults({ from: '2026-10-11', to: '2026-11-09' });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/automation/results?from=2026-10-11&to=2026-11-09');
    expect(results).toEqual({ summary: { trades: 0 } });
  });
});
