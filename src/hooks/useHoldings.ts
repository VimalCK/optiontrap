/**
 * Holdings for every screen (Portfolio, Dashboard), so they always agree.
 * Figures come from src/services/holdings.ts.
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
