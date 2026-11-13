/**
 * The trade engine's strategies (GET /api/strategies), as the Automation pages
 * show and configure them: each one's id, name, description and settings.
 * Strategies live on the server only (server/tradeEngine/strategies/); the
 * list is fetched once and shared by every screen (useStrategies).
 */
import { apiClient } from './apiClient';
import type { RuleInfo } from '../../shared/rules/ruleSettings.js';

export type StrategyInfo = RuleInfo;

function fetchStrategies(signal?: AbortSignal): Promise<StrategyInfo[]> {
  return apiClient.get<StrategyInfo[]>('/api/strategies', { signal });
}

let shared: Promise<StrategyInfo[]> | null = null;
let sharedValue: StrategyInfo[] | null = null;

/** The strategies, fetched once and shared. A failed fetch is retried on the next call. */
export function loadStrategies(): Promise<StrategyInfo[]> {
  shared ??= fetchStrategies().then((list) => (sharedValue = list), (err) => { shared = null; throw err; });
  return shared;
}

export function loadedStrategies(): StrategyInfo[] | null {
  return sharedValue;
}
