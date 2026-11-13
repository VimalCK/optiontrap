import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Horizon } from '../../../shared/tradeEnums.js';

// Keep the real database, positions and Kite session lookup out of the default dependencies.
vi.mock('../../db.js', () => ({}));
vi.mock('../positions.js', () => ({ NOT_FOUND: 'NOT_FOUND', MANUAL_EXIT: { ruleId: null, reason: 'Exited manually' }, squareOffable: vi.fn() }));
vi.mock('../../oiHistoryScheduler.js', () => ({ findWorkingAdminSession: vi.fn() }));

const { createOrderService } = await import('./orders.js');
const { CANCELLED_AT_CLOSE, CANCELLED_BY_USER } = await import('../../../shared/paperOrders.js');
const { INTRADAY_CLOSED_MESSAGE, MARKET_CLOSED_MESSAGE } = await import('../../../shared/paperTradeRules.js');

const NOON = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST, market open
const AFTER_CLOSE = new Date('2026-11-05T10:01:00Z'); // Thu 15:31 IST
const NEXT_NOON = new Date('2026-11-06T06:30:00Z'); // Fri 12:00 IST
const EVENING = new Date('2026-11-05T14:30:00Z'); // Thu 20:00 IST
const THU_SESSION_END = '2026-11-05T10:01:00.000Z'; // Thu 15:31 IST, after the closing minute
const WED_SESSION_END = '2026-11-04T10:01:00.000Z'; // Wed 15:31 IST
const USER_KITE = { apiKey: 'key', accessToken: 'user-token' };
const ADMIN_KITE = { apiKey: 'key', accessToken: 'admin-token' };
const QUOTE_KEY = 'NFO:NIFTY26N1024000CE';

const input = (extra = {}) => ({
  tradingsymbol: 'NIFTY26N1024000CE', instrumentToken: 101, strike: 24000, optionType: 'CE', expiry: '2026-11-10',
  side: 'BUY', quantity: 75, orderType: 'Limit', limitPrice: 50, horizon: Horizon.Intraday, ...extra,
});
const positional = (extra = {}) => input({ horizon: Horizon.Positional, ...extra });
const positionalMarket = (extra = {}) => positional({ orderType: 'Market', limitPrice: undefined, ...extra });
const stored = (id, extra = {}) => ({
  id, userId: 'U1', tradingsymbol: 'NIFTY26N1024000CE', instrumentToken: 101, instrumentType: 'CE', exchange: 'NFO', strike: 24000,
  optionType: 'CE', expiry: '2026-11-10', side: 'BUY', quantity: 75, orderType: 'Limit', limitPrice: 50, status: 'Open', fillPrice: null, positionId: null,
  closesPosition: false, source: 'Manual', horizon: Horizon.Intraday, autoTradeId: null, ...extra,
});
const openPositionRow = (extra = {}) => ({
  id: 'pos9', userId: 'U1', tradingsymbol: 'NIFTY26N1024000CE', instrumentToken: 101, instrumentType: 'CE', exchange: 'NFO',
  side: 'BUY', quantity: 75, entryPrice: 50, horizon: Horizon.Intraday, source: 'Manual', mode: 'Paper', ...extra,
});

describe('the order service', () => {
  let db;
  let positions;
  let lastPrice;
  let depth;
  let quotes;
  let feeds;
  let now;
  let service;
  let market;

  /** Start the service on a fake market clock, and give its open / close handlers to call. */
  function start(target = service) {
    const handlers = { open: [], close: [], every: [] };
    target.start({
      market: {
        isOpen: () => true,
        onOpen: (fn) => handlers.open.push(fn),
        onClose: (fn) => handlers.close.push(fn),
        every: (ms, fn) => handlers.every.push(fn),
      },
      services: {},
      log: () => {},
    });
    return {
      open: () => Promise.all(handlers.open.map((fn) => fn())),
      close: () => Promise.all(handlers.close.map((fn) => fn())),
      beat: () => Promise.all(handlers.every.map((fn) => fn())),
    };
  }

  beforeEach(() => {
    now = NOON;
    lastPrice = 60;
    depth = undefined;
    db = {
      createOrder: vi.fn(async (userId, order, placedBy) => stored('o1', {
        userId, side: order.side, orderType: order.orderType, limitPrice: order.limitPrice, horizon: order.horizon, ...placedBy,
      })),
      getOpenOrders: vi.fn(async () => []),
      claimOrderFill: vi.fn(async (id, fillPrice) => stored(id, { status: 'Filled', fillPrice })),
      setOrderPosition: vi.fn(async () => {}),
      cancelUnfilledOrder: vi.fn(async (id, reason) => stored(id, { status: 'Cancelled', statusReason: reason })),
      cancelOrder: vi.fn(async (userId, id) => stored(id, { status: 'Cancelled', statusReason: CANCELLED_BY_USER })),
      cancelOpenOrdersPlacedBefore: vi.fn(async () => []),
      recordClosingOrder: vi.fn(async (userId, position, fillPrice, source) => stored('x1', {
        side: position.side === 'BUY' ? 'SELL' : 'BUY', orderType: 'Market', limitPrice: null, status: 'Filled', fillPrice,
        positionId: position.id, closesPosition: true, source,
      })),
    };
    positions = {
      openPosition: vi.fn(async () => ({ ok: true, position: { id: 'pos1' } })),
      closablePosition: vi.fn(async () => ({ ok: true, position: openPositionRow() })),
      closePosition: vi.fn(async (userId, position, fill) => ({ ok: true, position: { ...position, exited: true, exitPrice: fill } })),
      squareOffable: vi.fn((position) => ({ ok: true, position })),
    };
    feeds = [];
    quotes = vi.fn(async () => ({ [QUOTE_KEY]: { last_price: lastPrice, depth } }));
    service = createOrderService({
      db,
      positions,
      quotes,
      findKiteSession: async () => ADMIN_KITE,
      createFeed: (options) => {
        const feed = { options, watching: [], watch: vi.fn((tokens) => { feed.watching = tokens; }), close: vi.fn() };
        feeds.push(feed);
        return feed;
      },
      clock: () => now,
      log: () => {},
    });
    market = start();
  });

  describe('placing', () => {
    it('leaves a buy above the last price open, watching its instrument on the admin feed', async () => {
      const result = await service.place('U1', input(), USER_KITE);
      expect(result).toEqual({ ok: true, order: expect.objectContaining({ id: 'o1', status: 'Open' }) });
      expect(db.createOrder).toHaveBeenCalledWith('U1', expect.objectContaining({ limitPrice: 50, instrumentType: 'CE', exchange: 'NFO' }), { source: 'Manual' });
      expect(positions.openPosition).not.toHaveBeenCalled();
      expect(service.waitingOrderIds()).toEqual(['o1']);
      expect(feeds[0].options.kite).toEqual(ADMIN_KITE);
      expect(feeds[0].watching).toEqual([101]);
    });

    it('fills a buy at or above the last price at once, at the last price, opening its position', async () => {
      lastPrice = 40;
      const result = await service.place('U1', input(), USER_KITE);
      expect(db.claimOrderFill).toHaveBeenCalledWith('o1', 40);
      expect(positions.openPosition).toHaveBeenCalledWith('U1', expect.objectContaining({ instrumentToken: 101, side: 'BUY', quantity: 75, entryPrice: 40 }), { now: NOON, source: 'Manual' });
      expect(db.setOrderPosition).toHaveBeenCalledWith('o1', 'pos1');
      expect(result).toEqual({ ok: true, order: expect.objectContaining({ status: 'Filled', fillPrice: 40, positionId: 'pos1' }) });
      expect(service.waitingOrderIds()).toEqual([]);
      expect(feeds).toHaveLength(0);
    });

    it('fills a sell at once when the last price is at or above its limit', async () => {
      lastPrice = 50;
      await service.place('U1', input({ side: 'SELL' }), USER_KITE);
      expect(positions.openPosition).toHaveBeenCalledWith('U1', expect.objectContaining({ side: 'SELL', entryPrice: 50 }), { now: NOON, source: 'Manual' });
    });

    it('refuses an invalid limit order or one outside market hours before quoting, saving nothing', async () => {
      expect(await service.place('U1', input({ limitPrice: 0 }), USER_KITE))
        .toEqual({ ok: false, code: 'INVALID_TRADE', message: 'Limit price must be more than 0' });
      expect(await service.place('U1', input({ orderType: 'stop' }), USER_KITE))
        .toEqual({ ok: false, code: 'INVALID_TRADE', message: 'orderType must be one of: Limit, Market' });
      now = AFTER_CLOSE;
      expect(await service.place('U1', input(), USER_KITE)).toEqual({ ok: false, code: 'MARKET_CLOSED', message: INTRADAY_CLOSED_MESSAGE });
      expect(quotes).not.toHaveBeenCalled(); // a failing quote can't hide why the order was refused
      expect(db.createOrder).not.toHaveBeenCalled();
    });

    it("fills a market order at once in market hours, at the ask from a quote with the user's session", async () => {
      depth = { sell: [{ price: 61.5 }], buy: [{ price: 59.5 }] };
      const result = await service.place('U1', positionalMarket(), USER_KITE);
      expect(db.createOrder).toHaveBeenCalledWith('U1', expect.objectContaining({ orderType: 'Market', limitPrice: null, entryPrice: 60 }), { source: 'Manual' });
      expect(quotes).toHaveBeenLastCalledWith(USER_KITE, [QUOTE_KEY]);
      expect(db.claimOrderFill).toHaveBeenCalledWith('o1', 61.5);
      expect(result).toEqual({ ok: true, order: expect.objectContaining({ status: 'Filled', fillPrice: 61.5 }) });
    });

    it('takes a positional order while the market is closed and leaves it waiting, never filling it then', async () => {
      now = EVENING;
      lastPrice = 40; // a limit buy at 50 could fill at 40, but not while closed
      expect(await service.place('U1', positional(), USER_KITE))
        .toEqual({ ok: true, order: expect.objectContaining({ status: 'Open', horizon: Horizon.Positional }) });
      expect(await service.place('U1', positionalMarket(), USER_KITE))
        .toEqual({ ok: true, order: expect.objectContaining({ status: 'Open', orderType: 'Market' }) });
      expect(db.claimOrderFill).not.toHaveBeenCalled();
      expect(positions.openPosition).not.toHaveBeenCalled();
      expect(feeds).toHaveLength(0); // no feed outside market hours
    });

    it('refuses an order with no last price to decide against', async () => {
      lastPrice = undefined;
      expect(await service.place('U1', input(), USER_KITE))
        .toEqual({ ok: false, code: 'NO_PRICE', message: 'No last price for NIFTY26N1024000CE' });
      expect(db.createOrder).not.toHaveBeenCalled();
    });

    it('takes orders while the engine does not run it, but watches no ticks for them', async () => {
      const idle = createOrderService({ db, positions, quotes, findKiteSession: async () => ADMIN_KITE,
        createFeed: () => { throw new Error('no feed expected'); }, clock: () => NOON, log: () => {} });
      expect(await idle.place('U1', input(), USER_KITE)).toEqual({ ok: true, order: expect.objectContaining({ status: 'Open' }) });
    });
  });

  describe('filling on ticks', () => {
    beforeEach(async () => {
      await service.place('U1', input(), USER_KITE); // buy at 50, last 60: open
    });

    it('fills on the first tick at or below the limit, at the limit, then stops watching it', async () => {
      await service.onTicks([{ instrumentToken: 101, lastPrice: 50.05 }]);
      expect(db.claimOrderFill).not.toHaveBeenCalled();
      await service.onTicks([{ instrumentToken: 101, lastPrice: 49.5 }]);
      expect(db.claimOrderFill).toHaveBeenCalledWith('o1', 50);
      expect(positions.openPosition).toHaveBeenCalledWith('U1', expect.objectContaining({ entryPrice: 50 }), { now: NOON, source: 'Manual' });
      expect(db.setOrderPosition).toHaveBeenCalledWith('o1', 'pos1');
      expect(service.waitingOrderIds()).toEqual([]);
      expect(feeds[0].watching).toEqual([]);
    });

    it('fills once, however many ticks reach it while it is filling', async () => {
      await Promise.all([
        service.onTicks([{ instrumentToken: 101, lastPrice: 49 }]),
        service.onTicks([{ instrumentToken: 101, lastPrice: 48 }, { instrumentToken: 101, lastPrice: 47 }]),
      ]);
      expect(db.claimOrderFill).toHaveBeenCalledTimes(1);
      expect(positions.openPosition).toHaveBeenCalledTimes(1);
    });

    it('opens nothing when the order was no longer open (a cancel won the race)', async () => {
      db.claimOrderFill.mockResolvedValueOnce(null);
      await service.onTicks([{ instrumentToken: 101, lastPrice: 49 }]);
      expect(positions.openPosition).not.toHaveBeenCalled();
    });

    it('cancels the order with the reason when the position rules refuse the fill', async () => {
      positions.openPosition.mockResolvedValueOnce({ ok: false, code: 'MARKET_CLOSED', message: MARKET_CLOSED_MESSAGE });
      await service.onTicks([{ instrumentToken: 101, lastPrice: 49 }]);
      expect(db.cancelUnfilledOrder).toHaveBeenCalledWith('o1', MARKET_CLOSED_MESSAGE);
      expect(db.setOrderPosition).not.toHaveBeenCalled();
    });

    it('ignores ticks of other instruments', async () => {
      await service.onTicks([{ instrumentToken: 202, lastPrice: 1 }]);
      expect(db.claimOrderFill).not.toHaveBeenCalled();
    });
  });

  describe('exiting', () => {
    it('closes the whole position at once at the bid quoted with the session given, recorded as a filled closing order', async () => {
      depth = { sell: [{ price: 61.5 }], buy: [{ price: 59.5 }] };
      const result = await service.exit('U1', 'pos9', { exitPrice: 60, kite: USER_KITE });
      expect(positions.closablePosition).toHaveBeenCalledWith('U1', 'pos9', 60, NOON);
      // A bought position exits by selling, so it gets the bid.
      expect(positions.closePosition).toHaveBeenCalledWith('U1', openPositionRow(), 59.5, { now: NOON, exitReason: { ruleId: null, reason: 'Exited manually' } });
      expect(db.recordClosingOrder).toHaveBeenCalledWith('U1', openPositionRow(), 59.5, 'Manual');
      expect(result).toEqual({
        ok: true,
        order: expect.objectContaining({ side: 'SELL', status: 'Filled', fillPrice: 59.5, closesPosition: true, positionId: 'pos9' }),
        position: expect.objectContaining({ exited: true, exitPrice: 59.5 }),
      });
    });

    it("closes at the price sent when there is no bid / ask, and records an exit rule's reason", async () => {
      const reason = { ruleId: 'stop-loss', reason: 'Stop-loss hit' };
      await service.exit('U1', 'pos9', { exitPrice: 42, kite: ADMIN_KITE, source: 'Auto', exitReason: reason });
      expect(positions.closePosition).toHaveBeenCalledWith('U1', openPositionRow(), 42, { now: NOON, exitReason: reason });
      expect(db.recordClosingOrder).toHaveBeenCalledWith('U1', openPositionRow(), 42, 'Auto');
    });

    it('records nothing when the position may not be closed, or another request closed it first', async () => {
      positions.closablePosition.mockResolvedValueOnce({ ok: false, code: 'MARKET_CLOSED', message: MARKET_CLOSED_MESSAGE });
      expect(await service.exit('U1', 'pos9', { exitPrice: 60 })).toEqual({ ok: false, code: 'MARKET_CLOSED', message: MARKET_CLOSED_MESSAGE });
      expect(quotes).not.toHaveBeenCalled();
      positions.closePosition.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND', message: 'Position not found or already exited' });
      expect(await service.exit('U1', 'pos9', { exitPrice: 60 })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
      expect(db.recordClosingOrder).not.toHaveBeenCalled();
    });
  });

  describe('squaring off after the close', () => {
    const SQUARE_OFF = { ruleId: 'session-square-off', reason: 'Squared off after the market close' };
    const SESSION_END = new Date(THU_SESSION_END);

    it('closes the position at the price given, dated at the session end, recorded as a filled auto closing order', async () => {
      now = EVENING;
      const listener = vi.fn();
      service.onSettled(listener);
      const result = await service.squareOff(openPositionRow(), { price: 63, at: SESSION_END, exitReason: SQUARE_OFF });
      expect(positions.squareOffable).toHaveBeenCalledWith(openPositionRow(), 63, SESSION_END);
      expect(positions.closePosition).toHaveBeenCalledWith('U1', openPositionRow(), 63, { now: SESSION_END, exitReason: SQUARE_OFF });
      expect(db.recordClosingOrder).toHaveBeenCalledWith('U1', openPositionRow(), 63, 'Auto');
      expect(quotes).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true, order: expect.objectContaining({ status: 'Filled', fillPrice: 63, closesPosition: true, source: 'Auto' }), position: expect.objectContaining({ exited: true }) });
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ closesPosition: true }));
    });

    it('records nothing when the square-off is refused, or the position was already closed', async () => {
      positions.squareOffable.mockReturnValueOnce({ ok: false, code: 'INVALID_TRADE', message: 'exitPrice is required' });
      expect(await service.squareOff(openPositionRow(), { price: null, at: SESSION_END, exitReason: SQUARE_OFF }))
        .toEqual({ ok: false, code: 'INVALID_TRADE', message: 'exitPrice is required' });
      expect(positions.closePosition).not.toHaveBeenCalled();
      positions.closePosition.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND', message: 'Position not found or already exited' });
      expect(await service.squareOff(openPositionRow(), { price: 63, at: SESSION_END, exitReason: SQUARE_OFF })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
      expect(db.recordClosingOrder).not.toHaveBeenCalled();
    });
  });

  describe('cancelling', () => {
    it("cancels the user's open order and stops watching it", async () => {
      await service.place('U1', input(), USER_KITE);
      const result = await service.cancel('U1', 'o1');
      expect(db.cancelOrder).toHaveBeenCalledWith('U1', 'o1', CANCELLED_BY_USER);
      expect(result).toEqual({ ok: true, order: expect.objectContaining({ status: 'Cancelled' }) });
      expect(service.waitingOrderIds()).toEqual([]);
      await service.onTicks([{ instrumentToken: 101, lastPrice: 1 }]);
      expect(db.claimOrderFill).not.toHaveBeenCalled();
    });

    it('answers not found for an order that is not open (or not theirs)', async () => {
      db.cancelOrder.mockResolvedValueOnce(null);
      expect(await service.cancel('U1', 'nope')).toEqual({ ok: false, code: 'NOT_FOUND', message: 'Order not found or no longer open' });
    });
  });

  describe('automated orders', () => {
    it("places a limit order for an automated trade at the engine's last price, linked to the trade, with no quote of its own", async () => {
      const result = await service.placeAuto('U1', input({ limitPrice: 48 }), { lastPrice: 60, autoTradeId: 't1' });
      expect(quotes).not.toHaveBeenCalled();
      expect(db.createOrder).toHaveBeenCalledWith('U1', expect.objectContaining({ limitPrice: 48 }), { source: 'Auto', autoTradeId: 't1' });
      expect(result).toEqual({ ok: true, order: expect.objectContaining({ status: 'Open', source: 'Auto', autoTradeId: 't1' }) });
      expect(service.waitingOrderIds()).toEqual(['o1']);
    });

    it("fills an automated market order at once at the engine's quoted bid / ask, else its last price", async () => {
      const market = input({ orderType: 'Market', limitPrice: undefined });
      await service.placeAuto('U1', market, { lastPrice: 60, fillPrice: 60.5, autoTradeId: 't1' });
      expect(db.claimOrderFill).toHaveBeenLastCalledWith('o1', 60.5);
      expect(positions.openPosition).toHaveBeenLastCalledWith('U1', expect.objectContaining({ entryPrice: 60.5 }), { now: NOON, source: 'Auto' });
      await service.placeAuto('U1', market, { lastPrice: 60, autoTradeId: 't2' });
      expect(db.claimOrderFill).toHaveBeenLastCalledWith('o1', 60);
      expect(quotes).not.toHaveBeenCalled();
    });

    it('opens an automated position when its limit order fills', async () => {
      await service.placeAuto('U1', input(), { lastPrice: 60, autoTradeId: 't1' });
      await service.onTicks([{ instrumentToken: 101, lastPrice: 49 }]);
      expect(positions.openPosition).toHaveBeenCalledWith('U1', expect.objectContaining({ entryPrice: 50 }), { now: NOON, source: 'Auto' });
    });

    it('refuses an automated order the paper trade rules refuse, saving nothing', async () => {
      now = AFTER_CLOSE;
      expect(await service.placeAuto('U1', input(), { lastPrice: 60, autoTradeId: 't1' }))
        .toEqual({ ok: false, code: 'MARKET_CLOSED', message: INTRADAY_CLOSED_MESSAGE });
      expect(db.createOrder).not.toHaveBeenCalled();
    });
  });

  describe('telling listeners an order settled', () => {
    let settled;

    beforeEach(() => {
      settled = [];
      service.onSettled((order) => { settled.push(order); });
    });

    it('when it fills, with the position it opened', async () => {
      await service.place('U1', input(), USER_KITE);
      expect(settled).toEqual([]); // waiting is not settled
      await service.onTicks([{ instrumentToken: 101, lastPrice: 49 }]);
      expect(settled).toEqual([expect.objectContaining({ id: 'o1', status: 'Filled', fillPrice: 50, positionId: 'pos1' })]);
    });

    it('when its fill is refused, cancelled with why', async () => {
      await service.place('U1', input(), USER_KITE);
      positions.openPosition.mockResolvedValueOnce({ ok: false, code: 'MARKET_CLOSED', message: MARKET_CLOSED_MESSAGE });
      await service.onTicks([{ instrumentToken: 101, lastPrice: 49 }]);
      expect(settled).toEqual([expect.objectContaining({ status: 'Cancelled', statusReason: MARKET_CLOSED_MESSAGE })]);
    });

    it('when the user cancels it, for every order cancelled at the close, and for an exit', async () => {
      await service.place('U1', input(), USER_KITE);
      await service.cancel('U1', 'o1');
      await service.exit('U1', 'pos9', { exitPrice: 60 });
      db.cancelOpenOrdersPlacedBefore.mockResolvedValueOnce([stored('o7', { status: 'Cancelled', statusReason: CANCELLED_AT_CLOSE })]);
      now = AFTER_CLOSE;
      await market.close();
      expect(settled.map((o) => [o.id, o.statusReason ?? o.status])).toEqual([['o1', CANCELLED_BY_USER], ['x1', 'Filled'], ['o7', CANCELLED_AT_CLOSE]]);
    });

    it('keeps going when a listener fails: the fill itself stands', async () => {
      service.onSettled(() => { throw new Error('listener broke'); });
      await service.place('U1', input(), USER_KITE);
      await service.onTicks([{ instrumentToken: 101, lastPrice: 49 }]);
      expect(db.setOrderPosition).toHaveBeenCalledWith('o1', 'pos1');
      expect(settled).toHaveLength(1);
    });
  });

  describe('the market day', () => {
    it('at the open cancels orders left from an earlier session, then watches the open ones placed since it ended', async () => {
      db.getOpenOrders.mockResolvedValueOnce([stored('o7'), stored('o8', { instrumentToken: 202 })]);
      await market.open();
      expect(db.cancelOpenOrdersPlacedBefore).toHaveBeenCalledWith(WED_SESSION_END, CANCELLED_AT_CLOSE);
      expect(db.getOpenOrders).toHaveBeenCalledWith(WED_SESSION_END);
      expect(service.waitingOrderIds()).toEqual(['o7', 'o8']);
      expect(feeds[0].watching).toEqual([101, 202]);
    });

    it('opens no feed while nothing is waiting', async () => {
      await market.open();
      await market.beat();
      expect(feeds).toHaveLength(0);
    });

    it('after the close cancels the open orders placed during the session and stops watching; the next open loads the ones placed since', async () => {
      await service.place('U1', input(), USER_KITE);
      now = AFTER_CLOSE;
      await market.close();
      expect(db.cancelOpenOrdersPlacedBefore).toHaveBeenCalledWith(THU_SESSION_END, CANCELLED_AT_CLOSE);
      expect(feeds[0].close).toHaveBeenCalled();
      expect(service.waitingOrderIds()).toEqual([]);

      now = NEXT_NOON;
      await market.open();
      expect(db.getOpenOrders).toHaveBeenCalledWith(THU_SESSION_END); // orders placed after Thursday's close
    });

    it('after a restart in the evening still cancels only orders placed during the session', async () => {
      now = EVENING;
      await market.close();
      expect(db.cancelOpenOrdersPlacedBefore).toHaveBeenCalledWith(THU_SESSION_END, CANCELLED_AT_CLOSE);
    });

    it("fills a market order placed while closed on the first tick after the open, at the ask quoted with the feed's session", async () => {
      db.getOpenOrders.mockResolvedValueOnce([stored('o9', { orderType: 'Market', limitPrice: null, horizon: Horizon.Positional })]);
      depth = { sell: [{ price: 52 }], buy: [{ price: 51 }] };
      await market.open();
      await service.onTicks([{ instrumentToken: 101, lastPrice: 51.5 }]);
      expect(quotes).toHaveBeenLastCalledWith(ADMIN_KITE, [QUOTE_KEY]);
      expect(db.claimOrderFill).toHaveBeenCalledWith('o9', 52);
      expect(positions.openPosition).toHaveBeenCalledWith('U1', expect.objectContaining({ entryPrice: 52, horizon: Horizon.Positional }), { now: NOON, source: 'Manual' });
      expect(service.waitingOrderIds()).toEqual([]);
    });

    it("fills a waiting market order at the tick's last price when the quote has no ask", async () => {
      db.getOpenOrders.mockResolvedValueOnce([stored('o9', { orderType: 'Market', limitPrice: null, horizon: Horizon.Positional })]);
      await market.open();
      await service.onTicks([{ instrumentToken: 101, lastPrice: 51.5 }]);
      expect(db.claimOrderFill).toHaveBeenCalledWith('o9', 51.5);
    });

    it('fills a positional limit order placed while closed at its limit once a tick in market hours reaches it', async () => {
      db.getOpenOrders.mockResolvedValueOnce([stored('o9', { horizon: Horizon.Positional })]);
      await market.open();
      await service.onTicks([{ instrumentToken: 101, lastPrice: 55 }]);
      expect(db.claimOrderFill).not.toHaveBeenCalled();
      await service.onTicks([{ instrumentToken: 101, lastPrice: 49 }]);
      expect(db.claimOrderFill).toHaveBeenCalledWith('o9', 50);
    });

    it('waits for an admin login before watching, keeps the order open, and watches once a check finds one', async () => {
      let kite = null;
      const noLogin = createOrderService({
        db, positions, quotes, findKiteSession: async () => kite,
        createFeed: (options) => { const feed = { options, watch: vi.fn(), close: vi.fn() }; feeds.push(feed); return feed; },
        clock: () => NOON, log: () => {},
      });
      const clock = start(noLogin);
      await noLogin.place('U1', input(), USER_KITE);
      expect(noLogin.waitingOrderIds()).toEqual(['o1']);
      expect(feeds).toHaveLength(0);
      kite = ADMIN_KITE;
      await clock.beat();
      expect(feeds).toHaveLength(1);
    });

    it('stops watching when the engine stops it', async () => {
      await service.place('U1', input(), USER_KITE);
      service.stop();
      expect(feeds[0].close).toHaveBeenCalled();
      expect(service.waitingOrderIds()).toEqual([]);
    });
  });
});
