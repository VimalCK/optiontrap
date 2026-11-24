import { describe, it, expect, vi, afterEach } from 'vitest';
import { algoTradingSwitch, fetchAutoTradeResults, fetchAutoTrades, setAutomationEnabled, setStrategyActive } from './automation';
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

describe('setAutomationEnabled', () => {
  it('patches only the switch and returns the configuration as saved', async () => {
    const fetchMock = serverReplies(200, { status: 'ok', data: { enabled: true } });

    expect(await setAutomationEnabled(true)).toEqual({ enabled: true });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/automation/config');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ enabled: true });
  });
});

describe('algoTradingSwitch', () => {
  it('follows every configuration the server sends back and tells its listeners', async () => {
    const listener = vi.fn();
    const unsubscribe = algoTradingSwitch.subscribe(listener);
    serverReplies(200, { status: 'ok', data: { enabled: false } });
    await setAutomationEnabled(false);
    expect(algoTradingSwitch.current()).toBe(false);
    serverReplies(200, { status: 'ok', data: { enabled: true } });
    await setStrategyActive('option-analyzer-setups', true);
    expect(algoTradingSwitch.current()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});

describe('setStrategyActive', () => {
  it('patches only that strategy\'s switch', async () => {
    const fetchMock = serverReplies(200, { status: 'ok', data: { enabled: true } });

    await setStrategyActive('option-analyzer-setups', false);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/automation/strategies/option-analyzer-setups');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ active: false });
  });

  it("rejects with the server's reason, e.g. a value the strategy needs is unset", async () => {
    serverReplies(400, { status: 'error', message: 'Option Analyzer setups: set Min score to make it active' });
    const err = await setStrategyActive('option-analyzer-setups', true).catch((e: unknown) => e);
    expect((err as ApiError).message).toBe('Option Analyzer setups: set Min score to make it active');
  });
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
