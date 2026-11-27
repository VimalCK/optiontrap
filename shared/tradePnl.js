/**
 * P&L of a trade at a price, shared by the trade monitor and the
 * Automation page so both count it the same way.
 */
import { Side } from './tradeEnums.js';

/**
 * Rupees per unit the price has moved in the trade's favour from its entry price: what the stop-loss and target
 * exit rules compare, e.g. -20 for a trade sold at 100 now at 120.
 * @param {{ side: string, entryPrice: number }} trade
 * @param {number} price
 */
export function tradeGain(trade, price) {
  return trade.side === Side.BUY ? price - trade.entryPrice : trade.entryPrice - price;
}

/**
 * @param {{ side: string, quantity: number, entryPrice: number }} trade
 * @param {number} price
 */
export function tradePnl(trade, price) {
  return tradeGain(trade, price) * trade.quantity;
}

/**
 * Percentage of the entry price, e.g. -20 for a trade sold at 100 now at 120.
 * @param {{ side: string, entryPrice: number }} trade
 * @param {number} price
 */
export function tradePnlPercent(trade, price) {
  return (tradeGain(trade, price) / trade.entryPrice) * 100;
}
