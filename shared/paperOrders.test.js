import { describe, it, expect } from 'vitest';
import { canFill, parseLimitOrder } from './paperOrders.js';
import { MARKET_CLOSED_MESSAGE, RULE_CODES } from './paperTradeRules.js';

const OPEN = new Date('2026-11-05T06:30:00Z'); // Thu 12:00 IST
const CLOSED = new Date('2026-11-05T14:30:00Z'); // Thu 20:00 IST

const input = {
  tradingsymbol: 'NIFTY26N1024000CE',
  instrumentToken: '12345',
  strike: '24000',
  optionType: 'CE',
  side: 'BUY',
  quantity: '75',
  limitPrice: '50',
  expiry: '2026-11-10',
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

describe('parseLimitOrder', () => {
  it('parses the trade with its limit price as the entry price', () => {
    const { order } = parseLimitOrder(input, { now: OPEN });
    expect(order).toMatchObject({ instrumentToken: 12345, instrumentType: 'CE', exchange: 'NFO', quantity: 75, limitPrice: 50, entryPrice: 50 });
  });

  it('refuses a missing, zero or negative limit price', () => {
    for (const limitPrice of [undefined, '', '0', '-5', 'abc']) {
      expect(parseLimitOrder({ ...input, limitPrice }, { now: OPEN }))
        .toEqual({ error: 'Limit price must be more than 0', code: RULE_CODES.INVALID_TRADE });
    }
  });

  it('applies the paper trade rules: an incomplete order, or one while the market is closed', () => {
    expect(parseLimitOrder({ ...input, side: undefined }, { now: OPEN }))
      .toEqual({ error: 'Missing required fields', code: RULE_CODES.INVALID_TRADE });
    expect(parseLimitOrder(input, { now: CLOSED })).toEqual({ error: MARKET_CLOSED_MESSAGE, code: RULE_CODES.MARKET_CLOSED });
  });
});
