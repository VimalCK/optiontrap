import type { NewOrder } from '@/services/orders';
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

const optionalPrice = (text: string): number | null => (text ? Number(text) : null);

/** A limit order is placed at the price field; a market order is priced by the server. */
export function ticketOrder(
  option: OrderOption,
  side: SideId,
  fields: OrderTicketFields,
  choices: { orderType: OrderTypeId; horizon: HorizonId },
): NewOrder {
  const trade = {
    tradingsymbol: option.tradingsymbol,
    instrumentToken: option.instrumentToken,
    strike: option.strike,
    optionType: option.optionType,
    expiry: option.expiry,
    side,
    quantity: fields.quantity,
    horizon: choices.horizon,
    note: fields.note.trim(),
    targetPrice: optionalPrice(fields.targetPrice),
    stopLossPrice: optionalPrice(fields.stopLossPrice),
    confidence: fields.confidence,
  };
  return choices.orderType === OrderType.Limit
    ? { ...trade, orderType: OrderType.Limit, limitPrice: fields.price }
    : { ...trade, orderType: OrderType.Market };
}
