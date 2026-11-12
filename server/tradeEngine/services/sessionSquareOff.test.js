import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Horizon } from '../../../shared/tradeEnums.js';

// Keep the real database, positions and Kite session lookup out of the default dependencies.
vi.mock('../../db.js', () => ({}));
vi.mock('../../kiteQuotes.js', () => ({ fetchQuotes: vi.fn() }));
vi.mock('../../oiHistoryScheduler.js', () => ({ findWorkingAdminSession: vi.fn() }));

const { createSessionSquareOff } = await import('./sessionSquareOff.js');
const { SESSION_SQUARE_OFF } = await import('../positions.js');

const EVENING = new Date('2026-11-05T14:30:00Z'); // Thu 20:00 IST, after the close
const THU_SESSION_END = new Date('2026-11-05T10:01:00Z'); // Thu 15:31 IST, after the closing minute
const FRI_NOON = new Date('2026-11-06T06:30:00Z'); // Fri 12:00 IST, market open
const SATURDAY = new Date('2026-11-07T06:30:00Z'); // Sat 12:00 IST
const ADMIN_KITE = { apiKey: 'key', accessToken: 'admin-token' };

/** An open intraday position as the database returns it. */
const position = (id, extra = {}) => ({
  id, userId: 'U1', tradingsymbol: `NIFTY26N10${id}CE`, instrumentToken: 101, instrumentType: 'CE', exchange: 'NFO',
  side: 'BUY', quantity: 75, entryPrice: 50, horizon: Horizon.Intraday, source: 'Manual', mode: 'Paper', ...extra,
});
const keyOf = (p) => `NFO:${p.tradingsymbol}`;

describe('the session square-off service', () => {
  let now;
  let open;
  let lastPrices;
  let kite;
  let db;
  let quotes;
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
    kite = ADMIN_KITE;
    logs = [];
    db = { getOpenIntradayPositionsBefore: vi.fn(async () => open) };
    quotes = vi.fn(async (_kite, keys) => Object.fromEntries(keys.filter((k) => k in lastPrices).map((k) => [k, { last_price: lastPrices[k] }])));
    orders = {
      squareOff: vi.fn(async () => ({ ok: true })),
      exit: vi.fn(async () => ({ ok: true })),
    };
    service = createSessionSquareOff({ db, quotes, findKiteSession: async () => kite, clock: () => now });
    start();
  });

  it('looks for leftovers every minute while the market is open', () => {
    expect(handlers.every.map(({ ms }) => ms)).toEqual([60_000]);
  });

  it("after the close squares off every user's open intraday positions from the ended session, at their last price, dated at its end", async () => {
    await close();
    expect(db.getOpenIntradayPositionsBefore).toHaveBeenCalledWith(THU_SESSION_END.toISOString());
    expect(quotes).toHaveBeenCalledWith(ADMIN_KITE, [keyOf(open[0]), keyOf(open[1])]);
    expect(orders.squareOff).toHaveBeenCalledWith(open[0], { price: 63, at: THU_SESSION_END, exitReason: SESSION_SQUARE_OFF });
    expect(orders.squareOff).toHaveBeenCalledWith(open[1], { price: 41, at: THU_SESSION_END, exitReason: SESSION_SQUARE_OFF });
    expect(orders.exit).not.toHaveBeenCalled();
    expect(service.status()).toEqual({ lastRun: { at: EVENING.getTime(), when: 'after the close', found: 2, closed: 2 } });
  });

  it('at a startup over the weekend squares off what the last session (Friday) left', async () => {
    now = SATURDAY;
    await close();
    expect(db.getOpenIntradayPositionsBefore).toHaveBeenCalledWith('2026-11-06T10:01:00.000Z'); // Fri 15:31 IST
  });

  it('in market hours exits positions left from an earlier session at the market, leaving today\'s alone', async () => {
    now = FRI_NOON;
    await marketCheck();
    // Today's session hasn't ended, so only positions opened before Thursday's end are looked for.
    expect(db.getOpenIntradayPositionsBefore).toHaveBeenCalledWith(THU_SESSION_END.toISOString());
    expect(orders.exit).toHaveBeenCalledWith('U1', 'a', { exitPrice: 63, kite: ADMIN_KITE, source: 'Auto', exitReason: SESSION_SQUARE_OFF });
    expect(orders.exit).toHaveBeenCalledWith('U2', 'b', { exitPrice: 41, kite: ADMIN_KITE, source: 'Auto', exitReason: SESSION_SQUARE_OFF });
    expect(orders.squareOff).not.toHaveBeenCalled();
    expect(service.status().lastRun).toMatchObject({ when: 'in market hours', found: 2, closed: 2 });
  });

  it('does nothing, quoting nothing, when no intraday position is left open', async () => {
    open = [];
    await close();
    await marketCheck();
    expect(quotes).not.toHaveBeenCalled();
    expect(service.status()).toEqual({ lastRun: null });
  });

  it('closes nothing without an admin Kite login to price them, saying so, and tries again later', async () => {
    kite = null;
    await close();
    expect(orders.squareOff).not.toHaveBeenCalled();
    expect(logs).toEqual([['no admin Kite login to price them', { open: 2, next: 'trying again in market hours' }]]);
    kite = ADMIN_KITE;
    now = FRI_NOON;
    await marketCheck();
    expect(orders.exit).toHaveBeenCalledTimes(2);
  });

  it('skips a position with no last price (e.g. an expired contract), logging it once', async () => {
    delete lastPrices[keyOf(open[0])];
    await close();
    now = FRI_NOON;
    await marketCheck();
    expect(orders.squareOff).toHaveBeenCalledTimes(1);
    expect(orders.squareOff).toHaveBeenCalledWith(open[1], expect.anything());
    expect(logs.filter(([event]) => event === 'no last price')).toEqual([['no last price', { position: 'a', symbol: open[0].tradingsymbol }]]);
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
