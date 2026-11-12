/**
 * P&L of a paper trade or position at a price: bought gains as the price
 * rises, sold as it falls. Shared by the trade monitor (server, exit rules on
 * the last price) and the Automation page (browser, a closed trade's P&L), so
 * both count it the same way. The percentage is of the entry price, so it is
 * the same for any quantity: what the stop-loss and target exit rules compare.
 */
import { Side } from './tradeEnums.js';

/**
 * The P&L of `trade` at `price`.
 * @param {{ side: string, quantity: number, entryPrice: number }} trade
 * @param {number} price
 */
export function paperPnl(trade, price) {
  const perUnit = trade.side === Side.BUY ? price - trade.entryPrice : trade.entryPrice - price;
  return perUnit * trade.quantity;
}

/**
 * The P&L of `trade` at `price` as a percentage of its entry price, e.g. -20
 * for a trade sold at 100 now at 120.
 * @param {{ side: string, entryPrice: number }} trade
 * @param {number} price
 */
export function paperPnlPercent(trade, price) {
  const perUnit = trade.side === Side.BUY ? price - trade.entryPrice : trade.entryPrice - price;
  return (perUnit / trade.entryPrice) * 100;
}
