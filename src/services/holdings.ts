/**
 * Holdings with current prices.
 *
 * Kite's holdings reply can carry a stale last_price: two sessions on the same
 * account were seen getting different prices at the same moment. So the
 * prices are taken from the quote API, the authoritative source, and P&L and
 * day change are worked out from them.
 */
import { fetchHoldings, fetchQuotes, Holding, QuoteData } from './kiteApi';

/** Shares the holding's P&L is counted on: settled, or pledged when none are settled. */
const pnlQuantity = (h: Holding) => (h.quantity > 0 ? h.quantity : h.collateral_quantity);

/** The holding at `lastPrice`, with P&L and day change worked out from it. */
export function priceHolding(h: Holding, lastPrice: number, closePrice: number = h.close_price): Holding {
  const dayChange = lastPrice - closePrice;
  return {
    ...h,
    last_price: lastPrice,
    close_price: closePrice,
    pnl: (lastPrice - h.average_price) * pnlQuantity(h),
    day_change: dayChange,
    day_change_percentage: closePrice > 0 ? (dayChange / closePrice) * 100 : 0,
  };
}

/** Holdings re-priced from quotes; one without a quote keeps Kite's figures. */
export function applyQuotes(holdings: Holding[], quotes: Map<string, QuoteData>): Holding[] {
  return holdings.map((h) => {
    const quote = quotes.get(`${h.exchange}:${h.tradingsymbol}`);
    return quote?.last_price ? priceHolding(h, quote.last_price) : h;
  });
}

/** Holdings priced from the quote API. If quotes can't be fetched, Kite's own figures. */
export async function fetchPricedHoldings(): Promise<Holding[]> {
  const holdings = await fetchHoldings();
  if (holdings.length === 0) return holdings;
  const quotes = await fetchQuotes(holdings.map((h) => `${h.exchange}:${h.tradingsymbol}`)).catch(() => new Map());
  return applyQuotes(holdings, quotes);
}
