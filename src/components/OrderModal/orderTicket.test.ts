import { describe, it, expect } from 'vitest';
import { ticketOrder, type OrderOption, type OrderTicketFields } from './orderTicket';
import { Horizon, OptionType, OrderType, Side } from '../../../shared/tradeEnums.js';

const option: OrderOption = {
  tradingsymbol: 'NIFTY26NOV24000CE', instrumentToken: 111, lotSize: 75, strike: 24000, optionType: OptionType.CE, expiry: '2026-11-26',
};
const fields: OrderTicketFields = { quantity: 150, price: 101.5, targetPrice: '', stopLossPrice: '', confidence: 70, note: '  why  ' };

describe('ticketOrder', () => {
  it('places a market order without a limit price, with the trimmed note and no target or stop-loss', () => {
    const order = ticketOrder(option, Side.BUY, fields, { orderType: OrderType.Market, horizon: Horizon.Intraday });
    expect(order).toEqual({
      tradingsymbol: 'NIFTY26NOV24000CE', instrumentToken: 111, strike: 24000, optionType: OptionType.CE, expiry: '2026-11-26',
      side: Side.BUY, quantity: 150, horizon: Horizon.Intraday, note: 'why', targetPrice: null, stopLossPrice: null, confidence: 70,
      orderType: OrderType.Market,
    });
  });

  it('places a limit order at the price field, positional when chosen, with target and stop-loss as numbers', () => {
    const order = ticketOrder(option, Side.SELL, { ...fields, targetPrice: '80', stopLossPrice: '120.5' }, { orderType: OrderType.Limit, horizon: Horizon.Positional });
    expect(order).toMatchObject({ side: Side.SELL, orderType: OrderType.Limit, limitPrice: 101.5, horizon: Horizon.Positional, targetPrice: 80, stopLossPrice: 120.5 });
  });
});
