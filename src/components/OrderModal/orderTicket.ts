import type { OrderChanges, NewOrder, PaperOrder } from '@/services/orders';
import { OrderType, type HorizonId, type OptionTypeId, type OrderTypeId, type SideId } from '../../../shared/tradeEnums.js';

/** The option contract a popup places orders for. */
export interface OrderOption {
  tradingsymbol: string;
  instrumentToken: number;
  lotSize: number;
  strike: number;
  optionType: OptionTypeId;
  expiry: string;
}

/** What the user filled in; target and stop-loss are the inputs' text, empty when not set. */
export interface OrderTicketFields {
  quantity: number;
  price: number;
  targetPrice: string;
  stopLossPrice: string;
  confidence: number;
  note: string;
}

export const DEFAULT_CONFIDENCE = 70;

const optionalPrice = (text: string): number | null => (text ? Number(text) : null);
const priceText = (price: number | null): string => (price === null ? '' : String(price));

/** The order's terms from the ticket: what a new order is placed with, and what a modify changes. */
export function ticketChanges(fields: OrderTicketFields, orderType: OrderTypeId): OrderChanges {
  const terms = {
    quantity: fields.quantity,
    note: fields.note.trim(),
    targetPrice: optionalPrice(fields.targetPrice),
    stopLossPrice: optionalPrice(fields.stopLossPrice),
    confidence: fields.confidence,
  };
  return orderType === OrderType.Limit
    ? { ...terms, orderType: OrderType.Limit, limitPrice: fields.price }
    : { ...terms, orderType: OrderType.Market };
}

/** A limit order is placed at the price field; a market order is priced by the server. */
export function ticketOrder(
  option: OrderOption,
  side: SideId,
  fields: OrderTicketFields,
  choices: { orderType: OrderTypeId; horizon: HorizonId },
): NewOrder {
  return {
    tradingsymbol: option.tradingsymbol,
    instrumentToken: option.instrumentToken,
    strike: option.strike,
    optionType: option.optionType,
    expiry: option.expiry,
    side,
    horizon: choices.horizon,
    ...ticketChanges(fields, choices.orderType),
  };
}

/**
 * The contract of a pending order, to open the popup on it; null for an order that isn't for an option
 * (the popup is the option chain's).
 */
export function pendingOrderOption(order: PaperOrder, lotSize: number): OrderOption | null {
  const { optionType, strike, expiry } = order;
  if (optionType === null || strike === null || expiry === null) return null;
  return { tradingsymbol: order.tradingsymbol, instrumentToken: order.instrumentToken, lotSize, strike, optionType, expiry };
}

/** A pending order's terms as the popup's fields; a market order's price field starts at `price` (its last price). */
export function pendingOrderFields(order: PaperOrder, price: number): OrderTicketFields {
  return {
    quantity: order.quantity,
    price: order.limitPrice ?? price,
    targetPrice: priceText(order.targetPrice),
    stopLossPrice: priceText(order.stopLossPrice),
    confidence: order.confidence ?? DEFAULT_CONFIDENCE,
    note: order.note,
  };
}
