/**
 * The one source of holdings for every screen (Portfolio, Dashboard): loaded
 * once, priced from quotes, then kept live from ticks while the market is
 * open. Every figure comes from src/services/holdings.ts, so two screens
 * showing holdings always agree.
 */
import { useMemo } from 'react';
import type { Holding } from '@/services/kiteApi';
import { applyTicks, fetchPricedHoldings, holdingTotals } from '@/services/holdings';
import { useLivePriced } from './useLivePriced';

const NONE: Holding[] = [];
const tokensOf = (holdings: Holding[]) => holdings.map((h) => h.instrument_token);

export function useHoldings() {
  const { data: holdings, ...rest } = useLivePriced({
    name: 'holdings',
    initial: NONE,
    load: fetchPricedHoldings,
    tokensOf,
    applyTicks,
  });
  const totals = useMemo(() => holdingTotals(holdings), [holdings]);
  return { holdings, totals, ...rest };
}
