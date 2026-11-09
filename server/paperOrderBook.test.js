import { describe, it, expect, vi, beforeEach } from 'vitest';

// The module creates a default book on import; keep its real dependencies out.
vi.mock('./db.js', () => ({
  cancelOpenPaperOrdersPlacedBefore: vi.fn(), cancelPaperOrder: vi.fn(), cancelUnfilledPaperOrder: vi.fn(), claimPaperOrderFill: vi.fn(),
  createPaperOrder: vi.fn(), getOpenPaperOrders: vi.fn(), setPaperOrderPosition: vi.fn(),
}));
vi.mock('./paperTrading.js', () => ({ openPaperTrade: vi.fn(), NOT_FOUND: 'NOT_FOUND' }));
vi.mock('./oiHistoryScheduler.js', () => ({ findWorkingAdminSession: vi.fn() }));

const { createPaperOrderBook } = await import('./paperOrderBook.js');
const { CANCELLED_AT_CLOSE, CANCELLED_BY_USER } = await import('../shared/paperOrders.js');
const { MARKET_CLOSED_MESSAGE } = await import('../shared/paperTradeRules.js');

const NOON = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST, market open
const AFTER_CLOSE = new Date('2026-11-05T10:01:00Z'); // Thu 15:31 IST
const NEXT_NOON = new Date('2026-11-06T06:30:00Z'); // Fri 12:00 IST
const USER_KITE = { apiKey: 'key', accessToken: 'user-token' };
const ADMIN_KITE = { apiKey: 'key', accessToken: 'admin-token' };
const QUOTE_KEY = 'NFO:NIFTY26N1024000CE';

const input = (extra = {}) => ({
  tradingsymbol: 'NIFTY26N1024000CE', instrumentToken: 101, strike: 24000, optionType: 'CE', expiry: '2026-11-10',
  side: 'BUY', quantity: 75, limitPrice: 50, ...extra,
});
/** An order as the database returns it. */
const stored = (id, extra = {}) => ({
  id, userId: 'U1', tradingsymbol: 'NIFTY26N1024000CE', instrumentToken: 101, instrumentType: 'CE', exchange: 'NFO', strike: 24000,
  optionType: 'CE', expiry: '2026-11-10', side: 'BUY', quantity: 75, limitPrice: 50, status: 'open', fillPrice: null, positionId: null,
  source: 'manual', autoTradeId: null, ...extra,
});

describe('the order book', () => {
  let db;
  let openPosition;
  let lastPrice;
  let feeds;
  let now;
  let book;

  beforeEach(() => {
    now = NOON;
    lastPrice = 60;
    db = {
      createPaperOrder: vi.fn(async (userId, order, placedBy) => stored('o1', { userId, side: order.side, limitPrice: order.limitPrice, ...placedBy })),
      getOpenPaperOrders: vi.fn(async () => []),
      claimPaperOrderFill: vi.fn(async (id, fillPrice) => stored(id, { status: 'filled', fillPrice })),
      setPaperOrderPosition: vi.fn(async () => {}),
      cancelUnfilledPaperOrder: vi.fn(async (id, reason) => stored(id, { status: 'cancelled', statusReason: reason })),
      cancelPaperOrder: vi.fn(async (userId, id) => stored(id, { status: 'cancelled', statusReason: CANCELLED_BY_USER })),
      cancelOpenPaperOrdersPlacedBefore: vi.fn(async () => []),
    };
    openPosition = vi.fn(async () => ({ ok: true, position: { id: 'pos1' } }));
    feeds = [];
    book = createPaperOrderBook({
      db,
      openPosition,
      quotes: vi.fn(async () => ({ [QUOTE_KEY]: { last_price: lastPrice } })),
      findKiteSession: async () => ADMIN_KITE,
      createFeed: (options) => {
        const feed = { options, watching: [], watch: vi.fn((tokens) => { feed.watching = tokens; }), close: vi.fn() };
        feeds.push(feed);
        return feed;
      },
      clock: () => now,
      log: () => {},
    });
  });

  describe('placing', () => {
    it('leaves a buy above the last price open, watching its instrument on the admin feed', async () => {
      const result = await book.place('U1', input(), USER_KITE);
      expect(result).toEqual({ ok: true, order: expect.objectContaining({ id: 'o1', status: 'open' }) });
      expect(db.createPaperOrder).toHaveBeenCalledWith('U1', expect.objectContaining({ limitPrice: 50, instrumentType: 'CE', exchange: 'NFO' }), { source: 'manual' });
      expect(openPosition).not.toHaveBeenCalled();
      expect(book.waitingOrderIds()).toEqual(['o1']);
      expect(feeds[0].options.kite).toEqual(ADMIN_KITE);
      expect(feeds[0].watching).toEqual([101]);
    });

    it('fills a buy at or above the last price at once, at the last price, through the paper-trading path', async () => {
      lastPrice = 40;
      const result = await book.place('U1', input(), USER_KITE);
      expect(db.claimPaperOrderFill).toHaveBeenCalledWith('o1', 40);
      expect(openPosition).toHaveBeenCalledWith('U1', expect.objectContaining({ instrumentToken: 101, side: 'BUY', quantity: 75, entryPrice: 40 }), { now: NOON, source: 'manual' });
      expect(db.setPaperOrderPosition).toHaveBeenCalledWith('o1', 'pos1');
      expect(result).toEqual({ ok: true, order: expect.objectContaining({ status: 'filled', fillPrice: 40, positionId: 'pos1' }) });
      expect(book.waitingOrderIds()).toEqual([]);
      expect(feeds).toHaveLength(0);
    });

    it('fills a sell at once when the last price is at or above its limit', async () => {
      lastPrice = 50;
      await book.place('U1', input({ side: 'SELL' }), USER_KITE);
      expect(openPosition).toHaveBeenCalledWith('U1', expect.objectContaining({ side: 'SELL', entryPrice: 50 }), { now: NOON, source: 'manual' });
    });

    it('refuses an invalid order or one outside market hours, saving nothing', async () => {
      expect(await book.place('U1', input({ limitPrice: 0 }), USER_KITE))
        .toEqual({ ok: false, code: 'INVALID_TRADE', message: 'Limit price must be more than 0' });
      now = AFTER_CLOSE;
      expect(await book.place('U1', input(), USER_KITE)).toEqual({ ok: false, code: 'MARKET_CLOSED', message: MARKET_CLOSED_MESSAGE });
      expect(db.createPaperOrder).not.toHaveBeenCalled();
    });

    it('refuses an order with no last price to decide against', async () => {
      lastPrice = undefined;
      expect(await book.place('U1', input(), USER_KITE))
        .toEqual({ ok: false, code: 'NO_PRICE', message: 'No last price for NIFTY26N1024000CE' });
      expect(db.createPaperOrder).not.toHaveBeenCalled();
    });
  });

  describe('filling on ticks', () => {
    beforeEach(async () => {
      await book.place('U1', input(), USER_KITE); // buy at 50, last 60: open
    });

    it('fills on the first tick at or below the limit, at the limit, then stops watching it', async () => {
      await book.onTicks([{ instrumentToken: 101, lastPrice: 50.05 }]);
      expect(db.claimPaperOrderFill).not.toHaveBeenCalled();
      await book.onTicks([{ instrumentToken: 101, lastPrice: 49.5 }]);
      expect(db.claimPaperOrderFill).toHaveBeenCalledWith('o1', 50);
      expect(openPosition).toHaveBeenCalledWith('U1', expect.objectContaining({ entryPrice: 50 }), { now: NOON, source: 'manual' });
      expect(db.setPaperOrderPosition).toHaveBeenCalledWith('o1', 'pos1');
      expect(book.waitingOrderIds()).toEqual([]);
      expect(feeds[0].watching).toEqual([]);
    });

    it('fills once, however many ticks reach it while it is filling', async () => {
      await Promise.all([
        book.onTicks([{ instrumentToken: 101, lastPrice: 49 }]),
        book.onTicks([{ instrumentToken: 101, lastPrice: 48 }, { instrumentToken: 101, lastPrice: 47 }]),
      ]);
      expect(db.claimPaperOrderFill).toHaveBeenCalledTimes(1);
      expect(openPosition).toHaveBeenCalledTimes(1);
    });

    it("opens nothing when the order was no longer open (a cancel won the race)", async () => {
      db.claimPaperOrderFill.mockResolvedValueOnce(null);
      await book.onTicks([{ instrumentToken: 101, lastPrice: 49 }]);
      expect(openPosition).not.toHaveBeenCalled();
    });

    it('cancels the order with the reason when paper trading refuses the fill', async () => {
      openPosition.mockResolvedValueOnce({ ok: false, code: 'MARKET_CLOSED', message: MARKET_CLOSED_MESSAGE });
      await book.onTicks([{ instrumentToken: 101, lastPrice: 49 }]);
      expect(db.cancelUnfilledPaperOrder).toHaveBeenCalledWith('o1', MARKET_CLOSED_MESSAGE);
      expect(db.setPaperOrderPosition).not.toHaveBeenCalled();
    });

    it('ignores ticks of other instruments', async () => {
      await book.onTicks([{ instrumentToken: 202, lastPrice: 1 }]);
      expect(db.claimPaperOrderFill).not.toHaveBeenCalled();
    });
  });

  describe('cancelling', () => {
    it("cancels the user's open order and stops watching it", async () => {
      await book.place('U1', input(), USER_KITE);
      const result = await book.cancel('U1', 'o1');
      expect(db.cancelPaperOrder).toHaveBeenCalledWith('U1', 'o1', CANCELLED_BY_USER);
      expect(result).toEqual({ ok: true, order: expect.objectContaining({ status: 'cancelled' }) });
      expect(book.waitingOrderIds()).toEqual([]);
      await book.onTicks([{ instrumentToken: 101, lastPrice: 1 }]);
      expect(db.claimPaperOrderFill).not.toHaveBeenCalled();
    });

    it('answers not found for an order that is not open (or not theirs)', async () => {
      db.cancelPaperOrder.mockResolvedValueOnce(null);
      expect(await book.cancel('U1', 'nope')).toEqual({ ok: false, code: 'NOT_FOUND', message: 'Order not found or no longer open' });
    });
  });

  describe('automated orders', () => {
    it("places an order for an automated trade at the engine's last price, linked to the trade, with no quote of its own", async () => {
      const quotes = vi.fn();
      const autoBook = createPaperOrderBook({ db, openPosition, quotes, findKiteSession: async () => ADMIN_KITE,
        createFeed: () => ({ watch: vi.fn(), close: vi.fn() }), clock: () => NOON, log: () => {} });
      const result = await autoBook.placeAuto('U1', input({ limitPrice: 48 }), { lastPrice: 60, autoTradeId: 't1' });
      expect(quotes).not.toHaveBeenCalled();
      expect(db.createPaperOrder).toHaveBeenCalledWith('U1', expect.objectContaining({ limitPrice: 48 }), { source: 'auto', autoTradeId: 't1' });
      expect(result).toEqual({ ok: true, order: expect.objectContaining({ status: 'open', source: 'auto', autoTradeId: 't1' }) });
      expect(autoBook.waitingOrderIds()).toEqual(['o1']);
    });

    it('opens an automated position when it fills', async () => {
      await book.placeAuto('U1', input(), { lastPrice: 60, autoTradeId: 't1' });
      await book.onTicks([{ instrumentToken: 101, lastPrice: 49 }]);
      expect(openPosition).toHaveBeenCalledWith('U1', expect.objectContaining({ entryPrice: 50 }), { now: NOON, source: 'auto' });
    });

    it('refuses an automated order the paper trade rules refuse, saving nothing', async () => {
      now = AFTER_CLOSE;
      expect(await book.placeAuto('U1', input(), { lastPrice: 60, autoTradeId: 't1' }))
        .toEqual({ ok: false, code: 'MARKET_CLOSED', message: MARKET_CLOSED_MESSAGE });
      expect(db.createPaperOrder).not.toHaveBeenCalled();
    });
  });

  describe('telling listeners an order settled', () => {
    let settled;

    beforeEach(() => {
      settled = [];
      book.onSettled((order) => { settled.push(order); });
    });

    it('when it fills, with the position it opened', async () => {
      await book.place('U1', input(), USER_KITE);
      expect(settled).toEqual([]); // waiting is not settled
      await book.onTicks([{ instrumentToken: 101, lastPrice: 49 }]);
      expect(settled).toEqual([expect.objectContaining({ id: 'o1', status: 'filled', fillPrice: 50, positionId: 'pos1' })]);
    });

    it('when its fill is refused, cancelled with why', async () => {
      await book.place('U1', input(), USER_KITE);
      openPosition.mockResolvedValueOnce({ ok: false, code: 'MARKET_CLOSED', message: MARKET_CLOSED_MESSAGE });
      await book.onTicks([{ instrumentToken: 101, lastPrice: 49 }]);
      expect(settled).toEqual([expect.objectContaining({ status: 'cancelled', statusReason: MARKET_CLOSED_MESSAGE })]);
    });

    it('when the user cancels it, and for every order cancelled at the close', async () => {
      await book.place('U1', input(), USER_KITE);
      await book.cancel('U1', 'o1');
      db.cancelOpenPaperOrdersPlacedBefore.mockResolvedValueOnce([stored('o7', { status: 'cancelled', statusReason: CANCELLED_AT_CLOSE })]);
      now = AFTER_CLOSE;
      await book.checkMarket();
      expect(settled.map((o) => [o.id, o.statusReason])).toEqual([['o1', CANCELLED_BY_USER], ['o7', CANCELLED_AT_CLOSE]]);
    });

    it("keeps going when a listener fails: the fill itself stands", async () => {
      book.onSettled(() => { throw new Error('listener broke'); });
      await book.place('U1', input(), USER_KITE);
      await book.onTicks([{ instrumentToken: 101, lastPrice: 49 }]);
      expect(db.setPaperOrderPosition).toHaveBeenCalledWith('o1', 'pos1');
      expect(settled).toHaveLength(1);
    });
  });

  describe('the market day', () => {
    it("at the open cancels orders left from an earlier day, then watches today's open orders", async () => {
      db.getOpenPaperOrders.mockResolvedValueOnce([stored('o7'), stored('o8', { instrumentToken: 202 })]);
      await book.checkMarket();
      const todayStart = '2026-11-04T18:30:00.000Z'; // Thu 00:00 IST
      expect(db.cancelOpenPaperOrdersPlacedBefore).toHaveBeenCalledWith(todayStart, CANCELLED_AT_CLOSE);
      expect(db.getOpenPaperOrders).toHaveBeenCalledWith(todayStart);
      expect(book.waitingOrderIds()).toEqual(['o7', 'o8']);
      expect(feeds[0].watching).toEqual([101, 202]);

      await book.checkMarket();
      expect(db.getOpenPaperOrders).toHaveBeenCalledTimes(1); // once a day
    });

    it('opens no feed while nothing is waiting', async () => {
      await book.checkMarket();
      expect(feeds).toHaveLength(0);
    });

    it('after the close cancels every open order once and stops watching; loads again the next day', async () => {
      await book.place('U1', input(), USER_KITE);
      now = AFTER_CLOSE;
      await book.checkMarket();
      expect(db.cancelOpenPaperOrdersPlacedBefore).toHaveBeenCalledWith(AFTER_CLOSE.toISOString(), CANCELLED_AT_CLOSE);
      expect(feeds[0].close).toHaveBeenCalled();
      expect(book.waitingOrderIds()).toEqual([]);
      await book.checkMarket();
      expect(db.cancelOpenPaperOrdersPlacedBefore).toHaveBeenCalledTimes(1);

      now = NEXT_NOON;
      await book.checkMarket();
      expect(db.getOpenPaperOrders).toHaveBeenCalledWith('2026-11-05T18:30:00.000Z'); // Fri 00:00 IST
    });

    it('waits for an admin login before watching, and keeps the order open', async () => {
      const noLogin = createPaperOrderBook({
        db, openPosition, quotes: async () => ({ [QUOTE_KEY]: { last_price: 60 } }), findKiteSession: async () => null,
        createFeed: () => { throw new Error('no feed expected'); }, clock: () => NOON, log: () => {},
      });
      await noLogin.place('U1', input(), USER_KITE);
      expect(noLogin.waitingOrderIds()).toEqual(['o1']);
    });
  });
});
