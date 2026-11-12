import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrikeMode } from '../shared/appEnums.js';

vi.mock('./db.js', () => ({
  createOiHistoryTable: vi.fn(async () => {}),
  getOiHistoryDatesForExpiryMonth: vi.fn(async () => new Set()),
  getOptionsForAtm: vi.fn(async () => []),
  getOptionsForStrikes: vi.fn(async () => []),
  getUnderlying: vi.fn(async () => ({ instrumentToken: 341249 })),
  getStoredOiHistoryStrikes: vi.fn(async () => []),
  getStrikeStepSize: vi.fn(async () => 10),
  insertOiHistoryFuturesRows: vi.fn(async () => 0),
  insertOiHistoryRows: vi.fn(async () => 0),
  withNamedAdvisoryLock: vi.fn(async (_name, fn) => fn()),
}));
vi.mock('./instruments.js', () => ({ getOrFetchInstruments: vi.fn(async () => []) }));

const { fetchOiHistoryMonth, oiHistoryFetchKey } = await import('./oiHistoryFetch.js');

/** A Kite reply for the spot candles: no trading days, so the fetch ends after this one call. */
const noCandles = () => new Response(JSON.stringify({ status: 'success', data: { candles: [] } }), { status: 200 });
const badToken = () => new Response(JSON.stringify({ status: 'error', message: 'Incorrect `api_key` or `access_token`.' }), { status: 403 });

/** Kite stub answering per access token, after `release()` is called for slow tokens. */
const stubKite = (replies, slowTokens = []) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchMock = vi.fn(async (_url, { headers }) => {
    const token = headers.Authorization.split(':')[1];
    if (slowTokens.includes(token)) await gate;
    return replies[token]();
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, release };
};

const request = (accessToken, extra = {}) => ({ scrip: 'HDFCBANK', expiryMonth: '2026-11', apiKey: 'key', accessToken, ...extra });

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('fetchOiHistoryMonth sharing', () => {
  it('lets users fetching the same month at once share one fetch', async () => {
    const { fetchMock, release } = stubKite({ a: noCandles, b: noCandles }, ['a']);
    const joinerSteps = [];

    const a = fetchOiHistoryMonth(request('a'));
    const b = fetchOiHistoryMonth(request('b', { send: (event, data) => joinerSteps.push(data.message) }));
    release();

    expect(await Promise.all([a, b])).toEqual([
      expect.objectContaining({ rowCount: 0 }),
      expect.objectContaining({ rowCount: 0 }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(joinerSteps).toContain('Joining a fetch already running for this month...');
  });

  it('runs a joiner\'s own fetch when the shared one fails on someone else\'s login', async () => {
    const { fetchMock, release } = stubKite({ a: badToken, b: noCandles }, ['a']);

    const a = fetchOiHistoryMonth(request('a'));
    const b = fetchOiHistoryMonth(request('b'));
    release();

    await expect(a).rejects.toThrow('Kite answered 403');
    expect(await b).toEqual(expect.objectContaining({ rowCount: 0 }));
    expect(fetchMock.mock.calls.map(([, { headers }]) => headers.Authorization)).toEqual(['token key:a', 'token key:b']);
  });

  it('refuses a strike mode it does not know, before calling Kite', async () => {
    const { fetchMock } = stubKite({ a: noCandles });
    await expect(fetchOiHistoryMonth(request('a', { strikeMode: 'nearby' }))).rejects.toThrow(/strikeMode must be one of AtmRange, AllStored, Specific/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives the starter its own failure', async () => {
    stubKite({ a: badToken });
    await expect(fetchOiHistoryMonth(request('a'))).rejects.toMatchObject({ status: 403 });
  });

  it('marks a spot fetch Kite refused for an ended login, so the route can send the user to login', async () => {
    stubKite({ a: badToken });
    await expect(fetchOiHistoryMonth(request('a'))).rejects.toMatchObject({ status: 403, authFailure: true });
  });

  it('does not share between different strike choices', async () => {
    const { fetchMock, release } = stubKite({ a: noCandles, b: noCandles }, ['a']);

    const a = fetchOiHistoryMonth(request('a'));
    const b = fetchOiHistoryMonth(request('b', { strikeMode: StrikeMode.Specific, specificStrike: 1700 }));
    release();
    await Promise.all([a, b]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('oiHistoryFetchKey', () => {
  it('matches requests that fetch the same rows', () => {
    expect(oiHistoryFetchKey({ scrip: 'HDFCBANK', expiryMonth: '2026-11' }))
      .toBe(oiHistoryFetchKey({ scrip: 'HDFCBANK', expiryMonth: '2026-11', strikeMode: StrikeMode.AtmRange, specificStrike: 1700 }));
    expect(oiHistoryFetchKey({ scrip: 'HDFCBANK', expiryMonth: '2026-11', strikeMode: StrikeMode.Specific, specificStrike: '1700' }))
      .toBe(oiHistoryFetchKey({ scrip: 'HDFCBANK', expiryMonth: '2026-11', strikeMode: StrikeMode.Specific, specificStrike: 1700 }));
  });

  it('separates scrips, months and strike choices', () => {
    const keys = new Set([
      oiHistoryFetchKey({ scrip: 'HDFCBANK', expiryMonth: '2026-11' }),
      oiHistoryFetchKey({ scrip: 'HDFCBANK', expiryMonth: '2026-12' }),
      oiHistoryFetchKey({ scrip: 'RELIANCE', expiryMonth: '2026-11' }),
      oiHistoryFetchKey({ scrip: 'HDFCBANK', expiryMonth: '2026-11', strikeMode: StrikeMode.AllStored }),
      oiHistoryFetchKey({ scrip: 'HDFCBANK', expiryMonth: '2026-11', strikeMode: StrikeMode.Specific, specificStrike: 1700 }),
      oiHistoryFetchKey({ scrip: 'HDFCBANK', expiryMonth: '2026-11', strikeMode: StrikeMode.Specific, specificStrike: 1710 }),
    ]);
    expect(keys.size).toBe(6);
  });
});
