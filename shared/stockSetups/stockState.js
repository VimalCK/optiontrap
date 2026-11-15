// @ts-check
import { MarketRelation, StockState } from '../analysisEnums.js';

/**
 * @typedef {import('../stockSetups.js').Candle} Candle
 * @typedef {import('../stockSetups.js').Indicators} Indicators
 * @typedef {import('../stockSetups.js').MarketCheck} MarketCheck
 * @typedef {import('../stockSetups.js').MarketRelationId} MarketRelationId
 * @typedef {import('../stockSetups.js').StockStateId} StockStateId
 */

const MARKET_WINDOW = 20;

/**
 * The stock's move over the last MARKET_WINDOW sessions against the market reference index over the same dates.
 * @param {Candle[]} stock
 * @param {Candle[]} market
 * @returns {MarketCheck | null}
 */
export function marketCheck(stock, market) {
  if (stock.length <= MARKET_WINDOW || market.length === 0) return null;
  const end = stock[stock.length - 1];
  const start = stock[stock.length - 1 - MARKET_WINDOW];
  const marketByDate = new Map(market.map((c) => [c.date, c.close]));
  const marketEnd = marketByDate.get(end.date);
  const marketStart = marketByDate.get(start.date);
  if (!marketEnd || !marketStart) return null;
  const stockPct = (end.close / start.close - 1) * 100;
  const marketPct = (marketEnd / marketStart - 1) * 100;
  const relativePct = stockPct - marketPct;
  /** @type {MarketRelationId} */
  let relation = MarketRelation.InLine;
  if (stockPct <= -3 && relativePct <= -3) relation = MarketRelation.Alone;
  else if (stockPct < 0 && marketPct <= -3) relation = MarketRelation.WithMarket;
  else if (relativePct >= 3) relation = MarketRelation.Stronger;
  return { stockPct, marketPct, relativePct, relation };
}

/**
 * @param {Candle[]} candles
 * @param {Indicators} ind
 * @returns {{ state: StockStateId, note: string }}
 */
export function stockState(candles, ind) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const recent = candles.slice(-20);
  const lowestIdx = recent.reduce((best, c, i) => (c.low < recent[best].low ? i : best), 0);
  const newLow = lowestIdx >= recent.length - 2;
  const stretch = ind.sma20 !== null && ind.atr ? (ind.sma20 - last.close) / ind.atr : 0;
  const down = ind.sma50 !== null && last.close < ind.sma50;
  const fell = candles.length > 20 && last.close < candles[candles.length - 21].close * 0.95;

  if (newLow) {
    if (stretch >= 2 || (ind.rsi !== null && ind.rsi < 30)) {
      return { state: StockState.Stretched, note: `Fell ${stretch.toFixed(1)} daily ranges below its 20-day average${ind.rsi !== null ? `, RSI ${ind.rsi.toFixed(0)}` : ''}. Bounces get likely, but the fall can continue.` };
    }
    return { state: StockState.Falling, note: 'Making new lows. Wait for it to stop before buying.' };
  }
  if ((down || fell) && last.close > prev.high) {
    return { state: StockState.Turning, note: `Closed above the previous session's high (${prev.high.toFixed(2)}) without a new low: the first sign the fall is pausing.` };
  }
  if (ind.sma50 !== null && last.close > ind.sma50 && ind.sma20 !== null && ind.sma20 > ind.sma50) {
    return { state: StockState.Uptrend, note: 'Above its rising 20- and 50-day averages. Dips to support are the entries.' };
  }
  if (down) return { state: StockState.Falling, note: 'Below its 50-day average, though not at a new low.' };
  return { state: StockState.Sideways, note: 'No clear trend.' };
}
