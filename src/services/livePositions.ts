/**
 * Live (Kite) positions with current prices.
 *
 * Like holdings, Kite's positions reply can carry a stale last_price, so open
 * positions are re-priced from the quote API on load and from ticks while the
 * market is open, and P&L is worked out with Kite's own formula.
 */
import { fetchPositions, fetchQuotes, KitePosition, KitePositions, QuoteData } from './kiteApi';
import type { Tick } from './kiteTicker';

const quoteKey = (p: KitePosition) => `${p.exchange}:${p.tradingsymbol}`;

/**
 * Kite's P&L for a position at `lastPrice`: what was sold less what was bought,
 * plus the open quantity marked at the price. Unlike (ltp − avg) × qty, this
 * keeps the P&L already booked on the part of a position closed earlier.
 */
export function positionPnl(p: KitePosition, lastPrice: number): number {
  return p.sell_value - p.buy_value + p.quantity * lastPrice * p.multiplier;
}

function pricePosition(p: KitePosition, lastPrice: number): KitePosition {
  return { ...p, last_price: lastPrice, pnl: positionPnl(p, lastPrice) };
}

function reprice(positions: KitePositions, priceOf: (p: KitePosition) => number | undefined): KitePositions {
  // A closed position's P&L doesn't depend on the price, so only open ones change.
  const each = (p: KitePosition) => {
    const price = p.quantity !== 0 ? priceOf(p) : undefined;
    return price ? pricePosition(p, price) : p;
  };
  return { net: positions.net.map(each), day: positions.day.map(each) };
}

/** Open positions re-priced from quotes; one without a quote keeps Kite's figures. */
export function applyPositionQuotes(positions: KitePositions, quotes: Map<string, QuoteData>): KitePositions {
  return reprice(positions, (p) => quotes.get(quoteKey(p))?.last_price);
}

/** Open positions re-priced from live ticks; one without a tick is left as it was. */
export function applyPositionTicks(positions: KitePositions, ticks: Tick[]): KitePositions {
  const byToken = new Map(ticks.map((t) => [t.instrumentToken, t.lastPrice]));
  return reprice(positions, (p) => byToken.get(p.instrument_token));
}

export function openPositionTokens(positions: KitePositions): number[] {
  return [...new Set([...positions.net, ...positions.day].filter((p) => p.quantity !== 0).map((p) => p.instrument_token))];
}

export function positionsPnl(list: KitePosition[]): number {
  return list.reduce((sum, p) => sum + p.pnl, 0);
}

/** Positions with open ones priced from the quote API. If quotes can't be fetched, Kite's own figures. */
export async function fetchPricedPositions(signal?: AbortSignal): Promise<KitePositions> {
  const positions = await fetchPositions(signal);
  const keys = [...new Set([...positions.net, ...positions.day].filter((p) => p.quantity !== 0).map(quoteKey))];
  if (keys.length === 0) return positions;
  const quotes = await fetchQuotes(keys, signal).catch((err) => {
    if (signal?.aborted) throw err;
    return new Map<string, QuoteData>();
  });
  return applyPositionQuotes(positions, quotes);
}
