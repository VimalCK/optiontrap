import type { BuyScoreBreakdown, ScoreBreakdown } from '@/services/sellStrategy';
import type { OiSnapshot } from '@/services/oiSnapshots';
import { OptionType, type OptionTypeId } from '../../../shared/tradeEnums.js';
import { OptionSetup, type OptionSetupId } from '../../../shared/analysisEnums.js';

export function scoreColorClass(score: number): string {
  if (score >= 80) return 'very-high';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

export const SINGLE_OPTION_SETUPS: Partial<Record<OptionSetupId, OptionTypeId>> = {
  [OptionSetup.SellCe]: OptionType.CE,
  [OptionSetup.BuyCe]: OptionType.CE,
  [OptionSetup.SellPe]: OptionType.PE,
  [OptionSetup.BuyPe]: OptionType.PE,
};

export const STRADDLE_SETUPS: OptionSetupId[] = [OptionSetup.SellStraddle, OptionSetup.BuyStraddle];

export const STRANGLE_SETUPS: OptionSetupId[] = [OptionSetup.SellStrangle, OptionSetup.BuyStrangle];

export function strikeLabel(strikes: number[]): string {
  if (strikes.length === 2) return `${strikes[0]} / ${strikes[1]}`;
  return String(strikes[0]);
}

export function actionBtnClass(type: OptionSetupId): string {
  const optionType = SINGLE_OPTION_SETUPS[type];
  if (optionType) return optionType.toLowerCase();
  return STRADDLE_SETUPS.includes(type) ? 'straddle' : 'strangle';
}

export interface BreakdownItem<Breakdown> {
  label: string;
  key: keyof Breakdown;
  max: number;
}

export const SELL_BREAKDOWN_LABELS: BreakdownItem<ScoreBreakdown>[] = [
  { label: 'Pinning', key: 'pinning', max: 25 },
  { label: 'OI Wall', key: 'oiWall', max: 25 },
  { label: 'Velocity', key: 'velocity', max: 20 },
  { label: 'PCR', key: 'pcrExtreme', max: 15 },
  { label: 'Theta', key: 'timeDecay', max: 15 },
];

export const BUY_BREAKDOWN_LABELS: BreakdownItem<BuyScoreBreakdown>[] = [
  { label: 'Breakout', key: 'breakout', max: 25 },
  { label: 'Direction', key: 'directionalOi', max: 25 },
  { label: 'Momentum', key: 'momentum', max: 20 },
  { label: 'PCR Shift', key: 'pcrShift', max: 15 },
  { label: 'Risk/Rwd', key: 'riskReward', max: 15 },
];

/** The live OI, prices and spot, or the latest snapshot's while the market is closed (no live OI). */
export function effectiveMarketData(oiData: Map<number, number>, livePrices: Map<number, number>, spotPrice: number, snapshots: OiSnapshot[]) {
  let oi = oiData;
  let prices = livePrices;
  let spot = spotPrice;

  if (oiData.size === 0 && snapshots.length > 0) {
    const latest = snapshots[snapshots.length - 1];
    oi = new Map(Object.entries(latest.data).map(([k, v]) => [Number(k), v]));
    if (latest.prices) {
      prices = new Map(Object.entries(latest.prices).map(([k, v]) => [Number(k), v]));
    }
    if (spot === 0 && latest.spot) {
      spot = latest.spot;
    }
  }
  return { effectiveOi: oi, effectivePrices: prices, effectiveSpot: spot };
}
