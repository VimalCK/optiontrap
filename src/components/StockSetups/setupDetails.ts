import type { StockAnalysis, Zone } from '../../../shared/stockSetups.js';
import { LevelSide, MarketRelation, MoveDirection, type MarketRelationId, type MoveDirectionId } from '../../../shared/analysisEnums.js';
import { addDays, isTradingDay, marketDate } from '../../../shared/marketTime.js';
import { realizedVol, REALIZED_WINDOW, TRADING_DAYS } from '@/services/fairValue';

export const LADDER_ZONES = 3;

export const MARKET_LABEL: Record<MarketRelationId, string> = {
  [MarketRelation.Alone]: 'Falling on its own',
  [MarketRelation.WithMarket]: 'Falling with the market',
  [MarketRelation.Stronger]: 'Stronger than market',
  [MarketRelation.InLine]: 'In line with market',
};

/** `market`: the market reference index's label. */
export const marketText = (relation: MarketRelationId, market: string): string => ({
  [MarketRelation.Alone]: 'Stock-specific selling while the market holds: higher risk.',
  [MarketRelation.WithMarket]: 'Moving down with the market: it often recovers when the market does.',
  [MarketRelation.Stronger]: `Holding up better than ${market}.`,
  [MarketRelation.InLine]: `Moving with ${market}.`,
})[relation];

export const rupees = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const signedPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

/** The price range a ± move spans around the price, e.g. "₹323 – ₹361". Whole rupees above ₹100. */
export const priceBand = (price: number, move: number) => {
  const format = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: price >= 100 ? 0 : 2 })}`;
  return `${format(price - move)} – ${format(price + move)}`;
};

/** A daily rupee move with its share of the price, e.g. "≈ ±₹6 a day (1.7%)". */
export const perDayMove = (price: number, move: number) => `≈ ±₹${move.toFixed(move >= 10 ? 0 : 1)} a day (${((move / price) * 100).toFixed(1)}%)`;

/** Trading sessions after today (IST) up to and including the expiry. */
export function sessionsTo(expiry: string, now = new Date()): number {
  let sessions = 0;
  for (let day = addDays(marketDate(now), 1); day <= expiry; day = addDays(day, 1)) {
    if (isTradingDay(day)) sessions++;
  }
  return sessions;
}

/** "2026-11-24" → "24 Nov" */
export const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const moveDirection = (v: number): MoveDirectionId => (v >= 0 ? MoveDirection.Up : MoveDirection.Down);

/** RSI as words: under 30 oversold, over 70 overbought, 45–55 neutral, normal otherwise. */
export function rsiLabel(rsi: number): { text: string; tone: MoveDirectionId } {
  if (rsi < 30) return { text: 'Oversold', tone: MoveDirection.Down };
  if (rsi > 70) return { text: 'Overbought', tone: MoveDirection.Up };
  if (rsi >= 45 && rsi <= 55) return { text: 'Neutral', tone: MoveDirection.Neutral };
  return { text: 'Normal', tone: MoveDirection.Neutral };
}

export function zoneHistoryText(zone: Zone): string {
  const { tests, held, failed, avgMovePct } = zone.history;
  if (!tests) return 'No past tests';
  const verb = zone.side === LevelSide.Support ? 'Held' : 'Rejected';
  const broke = failed ? ` · broke ${failed}` : '';
  const move = avgMovePct !== null ? ` · avg move ${avgMovePct.toFixed(1)}%` : '';
  return `${verb} ${held} of ${tests}${broke}${move}`;
}

/** The nearest zones on each side and where a price sits on the ladder (as a CSS %), with 6% margin past the outermost. */
export function ladderLayout(analysis: StockAnalysis): { zones: Zone[]; at: (price: number) => string } | null {
  const zones = [...analysis.supports.slice(0, LADDER_ZONES), ...analysis.resistances.slice(0, LADDER_ZONES)];
  if (!zones.length) return null;
  const lo = Math.min(analysis.price, ...zones.map((z) => z.low));
  const hi = Math.max(analysis.price, ...zones.map((z) => z.high));
  const pad = (hi - lo) * 0.06 || analysis.price * 0.01;
  const min = lo - pad;
  const span = hi + pad - min;
  return { zones, at: (v: number) => `${((v - min) / span) * 100}%` };
}

export interface Volatility { annual: number; daily: number; monthly: number }

/** The realised volatility of the closes, a yearly rate, with the rupee move it means per day and per 20 sessions at `price`. */
export function realisedVolatility(closes: number[], price: number): Volatility | null {
  const annual = realizedVol(closes);
  if (annual === null) return null;
  return {
    annual,
    daily: price * annual / Math.sqrt(TRADING_DAYS),
    monthly: price * annual * Math.sqrt(REALIZED_WINDOW / TRADING_DAYS),
  };
}

/**
 * The daily move a straddle prices in, comparable with the usual daily move. A straddle pays the average absolute
 * move, √(2/π) ≈ 0.8 of a standard move, spread over √sessions. Null when the expiry has no session left.
 */
export function straddleDailyMove(straddle: number, sessions: number): number | null {
  return sessions > 0 ? straddle / Math.sqrt(2 / Math.PI) / Math.sqrt(sessions) : null;
}
