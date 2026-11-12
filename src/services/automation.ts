/**
 * Trade automation API: the user's configuration, their automated trades
 * with each one's lifecycle, and the closed trades' results (Win/Loss
 * Patterns). Names and rules are in shared/automation.js.
 */
import { apiClient } from './apiClient';

import type { AutomationConfig, HorizonId, TradeKindId } from '../../shared/automation.js';
import type { LifecycleStageId, SideId, TradingModeId } from '../../shared/tradeEnums.js';

export type { AutomationConfig, HorizonId, TradeKindId };

export interface AutoTradeEvent {
  stage: LifecycleStageId;
  at: string;
  detail: unknown;
}

export interface AutoTrade {
  id: string;
  horizon: HorizonId;
  kind: TradeKindId;
  mode: TradingModeId;
  tradingsymbol: string;
  instrumentToken: number;
  side: SideId;
  quantity: number;
  stage: LifecycleStageId;
  reason: string | null;
  /** This trade's own fills; merged trades share one position at the average price. */
  entryPrice: number | null;
  exitPrice: number | null;
  /** Its own charges once closed (null before, or if closed before charges were kept). */
  charges: number | null;
  positionId: string | null;
  createdAt: string;
  updatedAt: string;
  events: AutoTradeEvent[];
}

export function fetchAutomationConfig(signal?: AbortSignal): Promise<AutomationConfig> {
  return apiClient.get('/api/automation/config', { signal });
}

export function saveAutomationConfig(config: AutomationConfig): Promise<AutomationConfig> {
  return apiClient.put('/api/automation/config', config);
}

/**
 * One group of closed automated trades and its figures. `key` is what the
 * group shares: a strategy id, setup, exit rule id (null: exited manually),
 * entry slot (minutes after IST midnight), side or IST day.
 */
export interface ResultGroup<K = string | null> {
  key: K;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  /** Sum of the winning trades' P&L. */
  grossProfit: number;
  /** Sum of the losing trades' losses, as a positive amount. */
  grossLoss: number;
  best: number | null;
  worst: number | null;
  /** Charges paid by these trades; P&L is already after them. */
  charges: number;
}

/** Closed automated trades entered in a range, measured and grouped on the server. */
export interface AutoTradeResults {
  summary: ResultGroup<null>;
  /** The largest fall of the running P&L from a peak, trade by trade in exit order. */
  maxDrawdown: number;
  byStrategy: ResultGroup[];
  bySetup: ResultGroup[];
  byExitRule: ResultGroup[];
  byEntrySlot: ResultGroup<number>[];
  bySide: ResultGroup<SideId>[];
  byDay: ResultGroup<string>[];
}

/** Results of the closed automated trades entered from `from` to `to` (YYYY-MM-DD, IST days, inclusive). */
export function fetchAutoTradeResults(range: { from: string; to: string }, signal?: AbortSignal): Promise<AutoTradeResults> {
  const params = new URLSearchParams(range);
  return apiClient.get(`/api/automation/results?${params}`, { signal });
}

/** Automated trades created from `from` to `to` (YYYY-MM-DD, IST days, inclusive), newest first. */
export function fetchAutoTrades(range: { from: string; to: string }, signal?: AbortSignal): Promise<AutoTrade[]> {
  const params = new URLSearchParams(range);
  return apiClient.get(`/api/automation/trades?${params}`, { signal });
}
