/**
 * Test data: the trade engine's strategies as GET /api/strategies describes
 * them (server/tradeEngine/strategies/), for frontend tests.
 */
import type { StrategyInfo } from './strategies';

export const TEST_STRATEGIES: StrategyInfo[] = [{
  id: 'option-analyzer-setups',
  label: 'Option Analyzer setups',
  description: 'Trades the Option Analyzer Strategy card suggestions.',
  params: [
    { key: 'minScore', label: 'Min score (of 100)', type: 'count' },
    { key: 'minPremium', label: 'Min premium (₹)', type: 'amount' },
  ],
}];
