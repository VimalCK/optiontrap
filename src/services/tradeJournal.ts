/**
 * Trade Journal Service
 * Trade entries and summaries from the positions API. The server filters,
 * pages and totals the trades, so the browser never loads the full history.
 *
 * Paper  → exited paper positions (GET /api/positions?status=closed, /daily-pnl, /stats)
 * Live   → not yet implemented (reserved for Kite Trades API)
 */

import { marketDate } from '../../shared/marketTime.js';
import {
  getClosedPositions,
  getDailyPnl,
  getPositionStats,
  ClosedPositionsFilter,
  DailyPnl,
  Position,
} from './positions';

export type Segment = 'stocks' | 'options' | 'futures';
export type TradingMode = 'paper' | 'live';
export type { DailyPnl };

export interface TradeEntry {
  id: string;
  date: string;       // market-zone (IST) exit day, 'YYYY-MM-DD'
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

export interface TradeStats {
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgWin: number;
  avgLoss: number;
  todayTrades: number;
  bestTrade?: TradeEntry;
  worstTrade?: TradeEntry;
}

/** By instrument type, the same rule the server's segment filter uses. */
export function positionToSegment(pos: Position): Segment {
  if (pos.instrumentType === 'CE' || pos.instrumentType === 'PE') return 'options';
  return pos.instrumentType === 'FUT' ? 'futures' : 'stocks';
}

/**
 * Convert an exited Position into a TradeEntry.
 */
export function positionToEntry(pos: Position): TradeEntry {
  const exitPrice = pos.exitPrice ?? 0;
  const pnl =
    pos.side === 'BUY'
      ? (exitPrice - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - exitPrice) * pos.quantity;

  return {
    id: pos.id,
    date: marketDate(new Date(pos.exitTime ?? pos.entryTime)),
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
 * A page of paper trades, most recently exited first.
 */
export async function getPaperTrades(filter: ClosedPositionsFilter = {}): Promise<TradeEntry[]> {
  const positions = await getClosedPositions('paper', filter);
  return positions.map(positionToEntry);
}

/**
 * Paper P&L per exit day between `from` and `to`, newest day first.
 */
export async function getPaperDailyPnl(from: string, to: string, segment?: Segment): Promise<DailyPnl[]> {
  return getDailyPnl('paper', from, to, segment);
}

/**
 * All-time paper win/loss figures.
 */
export async function getPaperTradeStats(): Promise<TradeStats> {
  const { bestTrade, worstTrade, ...counts } = await getPositionStats('paper');
  return {
    ...counts,
    bestTrade: bestTrade ? positionToEntry(bestTrade) : undefined,
    worstTrade: worstTrade ? positionToEntry(worstTrade) : undefined,
  };
}

/**
 * Load live trade entries — not yet implemented.
 * Returns empty array until Kite Trades API is wired up.
 */
export async function getLiveTradeEntries(): Promise<TradeEntry[]> {
  return [];
}
