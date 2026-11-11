import { describe, it, expect } from 'vitest';
import { canFill, parseOrder } from './paperOrders.js';
import { INTRADAY_CLOSED_MESSAGE, RULE_CODES } from './paperTradeRules.js';
import { Horizon } from './horizons.js';

const OPEN = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST
const CLOSED = new Date('2026-11-05T14:30:00Z'); // Thu 20:00 IST
const SATURDAY = new Date('2026-11-07T06:30:00Z'); // Sat 12:00 IST

const input = {
  tradingsymbol: 'NIFTY26N1024000CE',
  instrumentToken: '12345',
  strike: '24000',
  optionType: 'CE',
  side: 'BUY',
  quantity: '75',
  orderType: 'limit',
  limitPrice: '50',
  expiry: '2026-11-10',
  horizon: Horizon.Intraday,
};

describe('canFill', () => {
  it('fills a buy at its limit or lower', () => {
    expect(canFill('BUY', 50, 40)).toBe(true);
    expect(canFill('BUY', 50, 50)).toBe(true);
    expect(canFill('BUY', 50, 50.05)).toBe(false);
  });

  it('fills a sell at its limit or higher', () => {
    expect(canFill('SELL', 50, 60)).toBe(true);
    expect(canFill('SELL', 50, 50)).toBe(true);
    expect(canFill('SELL', 50, 49.95)).toBe(false);
  });
});

describe('parseOrder', () => {
  it('parses a limit order with its limit price as the entry price', () => {
    const { order } = parseOrder(input, { now: OPEN });
    expect(order).toMatchObject({ instrumentToken: 12345, instrumentType: 'CE', exchange: 'NFO', quantity: 75, orderType: 'limit', limitPrice: 50, entryPrice: 50 });
  });

  it('parses a market order with no limit price, the last price as its entry price', () => {
    const { order } = parseOrder({ ...input, orderType: 'market', limitPrice: '50' }, { now: OPEN, lastPrice: 48.5 });
    expect(order).toMatchObject({ orderType: 'market', limitPrice: null, entryPrice: 48.5 });
  });

  it('refuses an unknown or missing order type', () => {
    for (const orderType of [undefined, 'stop', '']) {
      expect(parseOrder({ ...input, orderType }, { now: OPEN }))
        .toEqual({ error: 'orderType must be one of: limit, market', code: RULE_CODES.INVALID_TRADE });
    }
  });

  it('refuses a limit order with a missing, zero or negative limit price', () => {
    for (const limitPrice of [undefined, '', '0', '-5', 'abc']) {
      expect(parseOrder({ ...input, limitPrice }, { now: OPEN }))
        .toEqual({ error: 'Limit price must be more than 0', code: RULE_CODES.INVALID_TRADE });
    }
  });

  it('applies the paper trade rules: an incomplete order is refused', () => {
    expect(parseOrder({ ...input, side: undefined }, { now: OPEN }))
      .toEqual({ error: 'Missing required fields', code: RULE_CODES.INVALID_TRADE });
  });

  it('takes an intraday order only in market hours, a positional one at any time', () => {
    expect(parseOrder(input, { now: CLOSED })).toEqual({ error: INTRADAY_CLOSED_MESSAGE, code: RULE_CODES.MARKET_CLOSED });
    expect(parseOrder({ ...input, horizon: Horizon.Positional }, { now: CLOSED }).order).toMatchObject({ horizon: Horizon.Positional, orderType: 'limit' });
    expect(parseOrder({ ...input, horizon: Horizon.Positional, orderType: 'market' }, { now: SATURDAY, lastPrice: 48 }).order)
      .toMatchObject({ orderType: 'market', limitPrice: null });
  });
});
