import { shimmerKeys } from '@/components/Shimmer/Shimmer';
import type { Position } from '@/services/positions';
import type { TradeEntry } from '@/services/tradeJournal';
import { Side, type TradingModeId } from '../../../shared/tradeEnums.js';
import { Tone, type ToneId } from '@/utils/uiEnums';

/** Rows in the Top Holdings and Recent Journal lists. */
export const DASHBOARD_LIST_SIZE = 5;
export const PLACEHOLDER_ROWS = shimmerKeys(DASHBOARD_LIST_SIZE);

export type DashboardTradeEntry = TradeEntry & { mode: TradingModeId };

export interface DashboardMetrics {
  tradePnl: number;
  todayTrades: number;
  watchlistCount: number;
  watchlistLists: number;
  openPaperPositions: number;
  activeAlerts: number;
  triggeredAlerts: number;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  bestTrade?: TradeEntry;
  worstTrade?: TradeEntry;
  recentTrades: DashboardTradeEntry[];
}

export const emptyMetrics: DashboardMetrics = {
  tradePnl: 0,
  todayTrades: 0,
  watchlistCount: 0,
  watchlistLists: 0,
  openPaperPositions: 0,
  activeAlerts: 0,
  triggeredAlerts: 0,
  closedTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  winRate: 0,
  avgWin: 0,
  avgLoss: 0,
  recentTrades: [],
};

export const formatMoney = (value: number, signed = false) => {
  const prefix = signed && value > 0 ? '+' : '';
  return `${prefix}${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const formatCompactMoney = (value: number, signed = false) => {
  const prefix = signed && value > 0 ? '+' : '';
  const abs = Math.abs(value);
  if (abs >= 10000000) return `${prefix}${(value / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${prefix}${(value / 100000).toFixed(2)} L`;
  return formatMoney(value, signed);
};

export const getTone = (value: number): ToneId => value > 0 ? Tone.Positive : value < 0 ? Tone.Negative : Tone.Neutral;

/** A paper position's booked P&L, after charges once it has closed (open ones count 0). */
export const getPaperPositionPnl = (position: Position) => {
  const exitPrice = position.exitPrice ?? position.entryPrice;
  const gross = position.side === Side.BUY
    ? (exitPrice - position.entryPrice) * position.quantity
    : (position.entryPrice - exitPrice) * position.quantity;
  return gross - (position.charges ?? 0);
};
