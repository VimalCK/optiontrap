/**
 * P&L of a trade at a price, shared by the trade monitor and the
 * Automation page so both count it the same way. The percentage is of the
 * entry price, so it is the same for any quantity: what the stop-loss and
 * target exit rules compare.
 */
import { Side } from './tradeEnums.js';

/**
 * @param {{ side: string, quantity: number, entryPrice: number }} trade
 * @param {number} price
 */
export function tradePnl(trade, price) {
  const perUnit = trade.side === Side.BUY ? price - trade.entryPrice : trade.entryPrice - price;
  return perUnit * trade.quantity;
}

/**
 * Percentage of the entry price, e.g. -20 for a trade sold at 100 now at 120.
 * @param {{ side: string, entryPrice: number }} trade
 * @param {number} price
 */
export function tradePnlPercent(trade, price) {
  const perUnit = trade.side === Side.BUY ? price - trade.entryPrice : trade.entryPrice - price;
  return (perUnit / trade.entryPrice) * 100;
}
