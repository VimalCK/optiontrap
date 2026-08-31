/**
 * Trade Journal Service
 * Derives trade entries from existing IndexedDB data sources.
 *
 * Paper  → exited positions from positions.ts (open_positions key)
 * Live   → not yet implemented (reserved for Kite Trades API)
 */

import { getPositions, Position } from './positions';

export type Segment = 'stocks' | 'options';
export type TradingMode = 'paper' | 'live';

export interface TradeEntry {
  id: string;
  date: string;       // 'YYYY-MM-DD'
  segment: Segment;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  note?: string;
  targetPrice?: number | null;
  stopLossPrice?: number | null;
  strategyTag?: string;
  confidence?: number | null;
}

/**
 * Derive segment from a Position.
 * Options have optionType (CE/PE). Everything else is stocks.
 */
function positionToSegment(_pos: Position): Segment {
  // All current paper positions are options (CE/PE).
  // When stocks are added, check optionType or a future `segment` field.
  return 'options';
}

/**
 * Convert an exited Position into a TradeEntry.
 */
function positionToEntry(pos: Position): TradeEntry {
  const exitPrice = pos.exitPrice ?? 0;
  const pnl =
    pos.side === 'BUY'
      ? (exitPrice - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - exitPrice) * pos.quantity;

  const date = pos.exitTime
    ? pos.exitTime.slice(0, 10)
    : pos.entryTime.slice(0, 10);

  return {
    id: pos.id,
    date,
    segment: positionToSegment(pos),
    symbol: pos.tradingsymbol,
    side: pos.side,
    quantity: pos.quantity,
    entryPrice: pos.entryPrice,
    exitPrice,
    pnl: Number(pnl.toFixed(2)),
    note: pos.note,
    targetPrice: pos.targetPrice,
    stopLossPrice: pos.stopLossPrice,
    strategyTag: pos.strategyTag,
    confidence: pos.confidence,
  };
}

/**
 * Load paper trade entries — all exited positions from IndexedDB.
 */
export async function getPaperTradeEntries(): Promise<TradeEntry[]> {
  const positions = await getPositions();
  return positions
    .filter((p) => p.exited && p.exitPrice !== undefined)
    .map(positionToEntry)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Load live trade entries — not yet implemented.
 * Returns empty array until Kite Trades API is wired up.
 */
export async function getLiveTradeEntries(): Promise<TradeEntry[]> {
  return [];
}

/**
 * Aggregate daily P&L for a set of entries.
 * Returns a map of 'YYYY-MM-DD' → total P&L.
 */
export function aggregateDailyPnL(entries: TradeEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of entries) {
    map.set(e.date, (map.get(e.date) ?? 0) + e.pnl);
  }
  return map;
}
