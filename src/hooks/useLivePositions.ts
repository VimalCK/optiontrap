/**
 * Live Kite positions for every screen (Positions, Dashboard), so they always
 * agree. Figures come from src/services/livePositions.ts.
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
