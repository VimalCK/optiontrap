/**
 * Holdings with current prices.
 *
 * Kite's holdings reply can carry a stale last_price: two sessions on the same
 * account were seen getting different prices at the same moment. So the
 * prices are taken from the quote API, the authoritative source, and P&L and
 * day change are worked out from them.
 */
import { fetchHoldings, fetchQuotes, Holding, QuoteData } from './kiteApi';
import type { Tick } from './kiteTicker';
import { CollateralType } from '../../shared/tradeEnums.js';

/**
 * Shares held, the one count used for P&L, value and day change: settled,
 * plus bought but not yet settled (T1), plus pledged (Kite keeps pledged
 * shares out of `quantity`: a fully pledged holding has quantity 0), less
 * any sold today.
 */
export const heldQuantity = (h: Holding) =>
  h.quantity + h.t1_quantity + h.collateral_quantity - h.used_quantity;

/** Whether a holding is pledged as collateral (Kite's collateral_type). */
export const isPledged = (h: Holding) => h.collateral_quantity > 0 && h.collateral_type === CollateralType.pledge;

/** The holding at `lastPrice`, with P&L and day change worked out from it. */
export function priceHolding(h: Holding, lastPrice: number, closePrice: number = h.close_price): Holding {
  const dayChange = lastPrice - closePrice;
  return {
    ...h,
    last_price: lastPrice,
    close_price: closePrice,
    pnl: (lastPrice - h.average_price) * heldQuantity(h),
    day_change: dayChange,
    day_change_percentage: closePrice > 0 ? (dayChange / closePrice) * 100 : 0,
  };
}

/** Portfolio totals, every one counted on heldQuantity. */
export function holdingTotals(holdings: Holding[]) {
  return holdings.reduce(
    (t, h) => {
      const qty = heldQuantity(h);
      return {
        investment: t.investment + h.average_price * qty,
        currentValue: t.currentValue + h.last_price * qty,
        pnl: t.pnl + h.pnl,
        dayChange: t.dayChange + h.day_change * qty,
      };
    },
    { investment: 0, currentValue: 0, pnl: 0, dayChange: 0 },
  );
}

/** Holdings re-priced from live ticks; one without a tick is left as it was. */
export function applyTicks(holdings: Holding[], ticks: Tick[]): Holding[] {
  const byToken = new Map(ticks.map((t) => [t.instrumentToken, t]));
  return holdings.map((h) => {
    const tick = byToken.get(h.instrument_token);
    return tick ? priceHolding(h, tick.lastPrice, tick.closePrice ?? h.close_price) : h;
  });
}

/** Holdings re-priced from quotes; one without a quote keeps Kite's figures. */
export function applyQuotes(holdings: Holding[], quotes: Map<string, QuoteData>): Holding[] {
  return holdings.map((h) => {
    const quote = quotes.get(`${h.exchange}:${h.tradingsymbol}`);
    return quote?.last_price ? priceHolding(h, quote.last_price) : h;
  });
}

/** Holdings priced from the quote API. If quotes can't be fetched, Kite's own figures. */
export async function fetchPricedHoldings(signal?: AbortSignal): Promise<Holding[]> {
  const holdings = await fetchHoldings(signal);
  if (holdings.length === 0) return holdings;
  const quotes = await fetchQuotes(holdings.map((h) => `${h.exchange}:${h.tradingsymbol}`), signal).catch((err) => {
    if (signal?.aborted) throw err;
    return new Map<string, QuoteData>();
  });
  return applyQuotes(holdings, quotes);
}
