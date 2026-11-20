import { describe, it, expect } from 'vitest';
import type { PaperOrder } from '@/services/orders';
import { pendingOrderFields, pendingOrderOption, ticketChanges, ticketOrder, type OrderOption, type OrderTicketFields } from './orderTicket';
import { Horizon, InstrumentType, OptionType, OrderStatus, OrderType, Side, TradeSource } from '../../../shared/tradeEnums.js';

const option: OrderOption = {
  tradingsymbol: 'NIFTY26NOV24000CE', instrumentToken: 111, lotSize: 75, strike: 24000, optionType: OptionType.CE, expiry: '2026-11-26',
};
const pending = (extra: Partial<PaperOrder> = {}): PaperOrder => ({
  id: 'o1', tradingsymbol: 'NIFTY26NOV24000PE', instrumentToken: 222, instrumentType: OptionType.PE, exchange: 'NFO', strike: 24000,
  optionType: OptionType.PE, expiry: '2026-11-26', side: Side.SELL, quantity: 150, orderType: OrderType.Limit, limitPrice: 55, status: OrderStatus.Open,
  statusReason: null, fillPrice: null, positionId: null, closesPosition: false, note: 'fade the spike', targetPrice: 40, stopLossPrice: null,
  confidence: 60, source: TradeSource.Manual, horizon: Horizon.Intraday, autoTradeId: null,
  createdAt: '2026-11-05T06:30:00.000Z', updatedAt: '2026-11-05T06:30:00.000Z', // Thu 12:00 IST
  ...extra,
});
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

describe('ticketChanges', () => {
  it("is the ticket's terms without the contract, side or trade type: what a modify sends", () => {
    expect(ticketChanges({ ...fields, targetPrice: '80' }, OrderType.Limit)).toEqual({
      quantity: 150, orderType: OrderType.Limit, limitPrice: 101.5, note: 'why', targetPrice: 80, stopLossPrice: null, confidence: 70,
    });
    expect(ticketChanges(fields, OrderType.Market)).not.toHaveProperty('limitPrice');
  });
});

describe('pendingOrderOption', () => {
  it("is the order's option contract with the lot size, or null for a stock or future", () => {
    expect(pendingOrderOption(pending(), 75)).toEqual({
      tradingsymbol: 'NIFTY26NOV24000PE', instrumentToken: 222, lotSize: 75, strike: 24000, optionType: OptionType.PE, expiry: '2026-11-26',
    });
    expect(pendingOrderOption(pending({ instrumentType: InstrumentType.FUT, strike: null, optionType: null }), 75)).toBeNull();
  });
});

describe('pendingOrderFields', () => {
  it("fills the ticket from the order's terms, empty where it has no target or stop-loss", () => {
    expect(pendingOrderFields(pending(), 61.4)).toEqual({
      quantity: 150, price: 55, targetPrice: '40', stopLossPrice: '', confidence: 60, note: 'fade the spike',
    });
  });

  it('starts a market order at the price given, and confidence at the default when the order has none', () => {
    expect(pendingOrderFields(pending({ orderType: OrderType.Market, limitPrice: null, confidence: null }), 61.4))
      .toMatchObject({ price: 61.4, confidence: 70 });
  });
});
