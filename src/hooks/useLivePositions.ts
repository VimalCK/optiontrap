/**
 * The one source of live (Kite) positions for every screen (Positions,
 * Dashboard): loaded once, open positions priced from quotes, then kept live
 * from ticks while the market is open. Every figure comes from
 * src/services/livePositions.ts, so two screens always agree.
 */
import { useMemo } from 'react';
import type { KitePositions } from '@/services/kiteApi';
import { applyPositionTicks, fetchPricedPositions, openPositionTokens, positionsPnl } from '@/services/livePositions';
import { useLivePriced } from './useLivePriced';

const NONE: KitePositions = { net: [], day: [] };

export function useLivePositions() {
  const { data: positions, ...rest } = useLivePriced({
    name: 'live-positions',
    initial: NONE,
    load: fetchPricedPositions,
    tokensOf: openPositionTokens,
    applyTicks: applyPositionTicks,
  });
  const netPnl = useMemo(() => positionsPnl(positions.net), [positions]);
  const openCount = useMemo(() => positions.net.filter((p) => p.quantity !== 0).length, [positions]);
  return { positions, netPnl, openCount, ...rest };
}
