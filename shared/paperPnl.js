/**
 * P&L of a paper trade or position at a price: bought gains as the price
 * rises, sold as it falls. Shared by the trade monitor (server, exit rules on
 * the last price) and the Automation page (browser, a closed trade's P&L), so
 * both count it the same way.
 */

/**
 * The P&L of `trade` at `price`.
 * @param {{ side: string, quantity: number, entryPrice: number }} trade
 * @param {number} price
 */
export function paperPnl(trade, price) {
  const perUnit = trade.side === 'BUY' ? price - trade.entryPrice : trade.entryPrice - price;
  return perUnit * trade.quantity;
}
