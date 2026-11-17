import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Horizon } from '../../../shared/tradeEnums.js';

// Keep the real database, positions and Kite session lookup out of the default dependencies.
vi.mock('../../db.js', () => ({}));
vi.mock('../../kiteQuotes.js', () => ({ fetchQuotes: vi.fn() }));
vi.mock('../../kiteCandles.js', () => ({ fetchDayCandles: vi.fn() }));
vi.mock('../../oiHistoryScheduler.js', () => ({ findWorkingAdminSession: vi.fn() }));

const { createSessionSquareOff } = await import('./sessionSquareOff.js');
const { SESSION_SQUARE_OFF } = await import('../positions.js');

const THU_NOON = '2026-11-05T06:30:00.000Z'; // Thu 12:00 IST, when the positions were opened
const EVENING = new Date('2026-11-05T14:30:00Z'); // Thu 20:00 IST, after the close
const THU_SESSION_END = new Date('2026-11-05T10:01:00Z'); // Thu 15:31 IST, after the closing minute
const FRI_NOON = new Date('2026-11-06T06:30:00Z'); // Fri 12:00 IST, market open
const FRI_SESSION_END = new Date('2026-11-06T10:01:00Z'); // Fri 15:31 IST
const SATURDAY = new Date('2026-11-07T06:30:00Z'); // Sat 12:00 IST
const ADMIN_KITE = { apiKey: 'key', accessToken: 'admin-token' };

const position = (id, extra = {}) => ({
  id, userId: 'U1', tradingsymbol: `NIFTY26N10${id}CE`, instrumentToken: id === 'a' ? 101 : 102, instrumentType: 'CE', exchange: 'NFO',
  side: 'BUY', quantity: 75, entryPrice: 50, entryTime: THU_NOON, horizon: Horizon.Intraday, source: 'Manual', mode: 'Paper', ...extra,
});
const keyOf = (p) => `NFO:${p.tradingsymbol}`;
/** A Kite daily candle row closing at `close`. */
const candle = (date, close) => [`${date}T00:00:00+0530`, close - 5, close + 5, close - 10, close, 1000];

describe('the session square-off service', () => {
  let now;
  let open;
  let lastPrices;
  let closes;
  let kite;
  let db;
  let quotes;
  let dayCandles;
  let orders;
  let logs;
  let service;
  let handlers;

  /** Start the service on a fake market clock, and give its close / repeat handlers to call. */
  function start() {
    handlers = { close: [], every: [] };
    service.start({
      market: {
        isOpen: () => false,
        onOpen: () => () => {},
        onClose: (fn) => handlers.close.push(fn),
        every: (ms, fn) => handlers.every.push({ ms, fn }),
      },
      services: { orders },
      log: (event, details) => logs.push([event, details]),
    });
  }
  const close = () => Promise.all(handlers.close.map((fn) => fn()));
  const marketCheck = () => Promise.all(handlers.every.map(({ fn }) => fn()));

  beforeEach(() => {
    now = EVENING;
    open = [position('a'), position('b', { userId: 'U2', source: 'Auto' })];
    lastPrices = { [keyOf(open[0])]: 63, [keyOf(open[1])]: 41 };
    closes = { '101|2026-11-05': 60, '102|2026-11-05': 40 };
    kite = ADMIN_KITE;
    logs = [];
    db = { getOpenIntradayPositionsBefore: vi.fn(async () => open) };
    quotes = vi.fn(async (_kite, keys) => Object.fromEntries(keys.filter((k) => k in lastPrices).map((k) => [k, { last_price: lastPrices[k] }])));
    dayCandles = vi.fn(async (_kite, token, from) => {
      const closePrice = closes[`${token}|${from}`];
      return closePrice === undefined ? [] : [candle(from, closePrice)];
    });
    orders = { squareOff: vi.fn(async () => ({ ok: true })) };
    service = createSessionSquareOff({ db, quotes, dayCandles, findKiteSession: async () => kite, clock: () => now });
    start();
  });

  it('looks for leftovers every minute while the market is open', () => {
    expect(handlers.every.map(({ ms }) => ms)).toEqual([60_000]);
  });

  it("after the close squares off every user's open intraday positions from the ended session, at their last price, dated at its end", async () => {
    await close();
    expect(db.getOpenIntradayPositionsBefore).toHaveBeenCalledWith(THU_SESSION_END.toISOString());
    expect(quotes).toHaveBeenCalledWith(ADMIN_KITE, [keyOf(open[0]), keyOf(open[1])]);
    expect(dayCandles).not.toHaveBeenCalled();
    expect(orders.squareOff).toHaveBeenCalledWith(open[0], { price: 63, at: THU_SESSION_END, exitReason: SESSION_SQUARE_OFF });
    expect(orders.squareOff).toHaveBeenCalledWith(open[1], { price: 41, at: THU_SESSION_END, exitReason: SESSION_SQUARE_OFF });
    expect(service.status()).toEqual({ lastRun: { at: EVENING.getTime(), when: 'after the close', found: 2, closed: 2 } });
  });

  it("in market hours squares off positions left from an earlier session at that session's candle close, dated at its end", async () => {
    now = FRI_NOON;
    await marketCheck();
    // Today's session hasn't ended, so only positions opened before Thursday's end are looked for.
    expect(db.getOpenIntradayPositionsBefore).toHaveBeenCalledWith(THU_SESSION_END.toISOString());
    expect(dayCandles).toHaveBeenCalledWith(ADMIN_KITE, 101, '2026-11-05', '2026-11-05');
    expect(quotes).not.toHaveBeenCalled();
    expect(orders.squareOff).toHaveBeenCalledWith(open[0], { price: 60, at: THU_SESSION_END, exitReason: SESSION_SQUARE_OFF });
    expect(orders.squareOff).toHaveBeenCalledWith(open[1], { price: 40, at: THU_SESSION_END, exitReason: SESSION_SQUARE_OFF });
    expect(service.status().lastRun).toMatchObject({ when: 'in market hours', found: 2, closed: 2 });
  });

  it('at a startup over the weekend prices each position at its own session\'s close: Friday\'s last price, Thursday\'s candle', async () => {
    now = SATURDAY;
    open = [position('a'), position('b', { entryTime: '2026-11-06T06:30:00.000Z' })]; // a: Thu, b: Fri 12:00 IST
    await close();
    expect(db.getOpenIntradayPositionsBefore).toHaveBeenCalledWith(FRI_SESSION_END.toISOString());
    expect(quotes).toHaveBeenCalledWith(ADMIN_KITE, [keyOf(open[1])]);
    expect(orders.squareOff).toHaveBeenCalledWith(open[0], { price: 60, at: THU_SESSION_END, exitReason: SESSION_SQUARE_OFF });
    expect(orders.squareOff).toHaveBeenCalledWith(open[1], { price: 41, at: FRI_SESSION_END, exitReason: SESSION_SQUARE_OFF });
  });

  it('does nothing, pricing nothing, when no intraday position is left open', async () => {
    open = [];
    await close();
    await marketCheck();
    expect(quotes).not.toHaveBeenCalled();
    expect(dayCandles).not.toHaveBeenCalled();
    expect(service.status()).toEqual({ lastRun: null });
  });

  it('closes nothing without an admin Kite login, saying so, and closes at the old session\'s close once there is one', async () => {
    kite = null;
    await close();
    expect(orders.squareOff).not.toHaveBeenCalled();
    expect(logs).toEqual([['no admin Kite login to price them', { open: 2, next: 'trying again in market hours' }]]);
    kite = ADMIN_KITE;
    now = FRI_NOON;
    await marketCheck();
    expect(orders.squareOff).toHaveBeenCalledWith(open[0], { price: 60, at: THU_SESSION_END, exitReason: SESSION_SQUARE_OFF });
    expect(orders.squareOff).toHaveBeenCalledTimes(2);
  });

  it('skips a position with no closing price, logging it once, and tries again at the next check', async () => {
    delete lastPrices[keyOf(open[0])];
    delete closes['101|2026-11-05'];
    await close();
    now = FRI_NOON;
    await marketCheck();
    expect(orders.squareOff).toHaveBeenCalledTimes(2);
    expect(orders.squareOff).not.toHaveBeenCalledWith(open[0], expect.anything());
    expect(logs.filter(([event]) => event === 'no closing price')).toEqual([['no closing price', { position: 'a', symbol: open[0].tradingsymbol }]]);
  });

  it('logs a candle Kite refused and still closes the others', async () => {
    now = FRI_NOON;
    dayCandles.mockRejectedValueOnce(new Error('Too many requests'));
    await marketCheck();
    expect(logs).toContainEqual(['could not fetch the closing price', { symbol: open[0].tradingsymbol, date: '2026-11-05', reason: 'Too many requests' }]);
    expect(orders.squareOff).toHaveBeenCalledTimes(1);
    expect(orders.squareOff).toHaveBeenCalledWith(open[1], expect.anything());
  });

  it('counts a refused square-off as left open and logs why, but not a position another exit closed first', async () => {
    orders.squareOff
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_TRADE', message: 'exitPrice is required' })
      .mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND', message: 'Position not found or already exited' });
    await close();
    expect(logs.filter(([event]) => event === 'could not square off')).toEqual([['could not square off', { position: 'a', reason: 'exitPrice is required' }]]);
    expect(service.status().lastRun).toMatchObject({ found: 2, closed: 0 });
  });
});
