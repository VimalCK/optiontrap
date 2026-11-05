/**
 * Trade automation API: the user's configuration and their automated trades
 * with each one's lifecycle. Names and rules are in shared/automation.js.
 */
import { apiClient } from './apiClient';

import type {
  AutomationConfig,
  ExecutionModeId,
  HorizonId,
  LifecycleStageId,
  TradeKindId,
  TradeSide,
} from '../../shared/automation.js';

export type { AutomationConfig, ExecutionModeId, HorizonId, LifecycleStageId, TradeKindId, TradeSide };

export interface AutoTradeEvent {
  stage: LifecycleStageId;
  at: string;
  detail: unknown;
}

export interface AutoTrade {
  id: string;
  horizon: HorizonId;
  kind: TradeKindId;
  mode: ExecutionModeId;
  tradingsymbol: string;
  instrumentToken: number;
  side: TradeSide;
  quantity: number;
  stage: LifecycleStageId;
  reason: string | null;
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

export function fetchAutoTrades(signal?: AbortSignal): Promise<AutoTrade[]> {
  return apiClient.get('/api/automation/trades', { signal });
}
