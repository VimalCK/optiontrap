/**
 * Market fills for paper trades: the price a real market order would get, not
 * the last traded price. A buy pays the best ask (the lowest seller), a sell
 * gets the best bid (the highest buyer), from a Kite quote taken when the
 * order is placed, as on Zerodha.
 *
 * Used by server/paperTrading.js for market entries and exits. Limit orders
 * (server/paperOrderBook.js) still fill at their limit. When a quote has no
 * bid or ask (no depth, or the quote call failed), the caller's price is kept.
 */
import { fetchQuotes } from './kiteQuotes.js';

/**
 * The best opposite-side price in a Kite quote: the ask for a buy, the bid
 * for a sell; null when there is none.
 * @param {any} quote  a Kite quote (with depth.buy / depth.sell)
 * @param {'BUY' | 'SELL'} side
 * @returns {number | null}
 */
export function marketFillPrice(quote, side) {
  const level = side === 'BUY' ? quote?.depth?.sell?.[0] : quote?.depth?.buy?.[0];
  const price = Number(level?.price);
  return price > 0 ? price : null;
}

/**
 * The market fill price for an order, from a fresh quote with this Kite
 * session; null when the quote has no bid / ask for it.
 * @param {{ apiKey: string, accessToken: string }} kite
 * @param {{ exchange: string, tradingsymbol: string }} instrument
 * @param {'BUY' | 'SELL'} side
 * @param {typeof fetchQuotes} [quotes]
 */
export async function quotedFillPrice(kite, instrument, side, quotes = fetchQuotes) {
  const key = `${instrument.exchange}:${instrument.tradingsymbol}`;
  const quoted = await quotes(kite, [key]);
  return marketFillPrice(quoted[key], side);
}
