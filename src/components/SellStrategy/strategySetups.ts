import { BUY_SCORE_MAX, SELL_SCORE_MAX, SINGLE_OPTION_SETUPS, setupSide, type BuyRecommendation, type SellRecommendation } from '@/services/sellStrategy';
import type { OiSnapshot } from '@/services/oiSnapshots';
import { OptionType, Side } from '../../../shared/tradeEnums.js';
import { OptionSetup, type OptionSetupId } from '../../../shared/analysisEnums.js';

export type StrategySetup = SellRecommendation | BuyRecommendation;

export function scoreColorClass(score: number): string {
  if (score >= 80) return 'very-high';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

export const STRADDLE_SETUPS: OptionSetupId[] = [OptionSetup.SellStraddle, OptionSetup.BuyStraddle];

export const STRANGLE_SETUPS: OptionSetupId[] = [OptionSetup.SellStrangle, OptionSetup.BuyStrangle];

export function strikeLabel(strikes: number[]): string {
  if (strikes.length === 2) return `${strikes[0]} / ${strikes[1]}`;
  return String(strikes[0]);
}

export function actionBtnClass(type: OptionSetupId): string {
  const single = SINGLE_OPTION_SETUPS[type];
  if (single) return single.optionType.toLowerCase();
  return STRADDLE_SETUPS.includes(type) ? 'straddle' : 'strangle';
}

/** One part of a setup's score: its label, its key in the breakdown and reasons, and its maximum. */
export interface ScorePart {
  label: string;
  key: string;
  max: number;
}

export const SELL_SCORE_PARTS: ScorePart[] = [
  { label: 'Direction', key: 'direction', max: SELL_SCORE_MAX.direction },
  { label: 'Today', key: 'today', max: SELL_SCORE_MAX.today },
  { label: 'OI Wall', key: 'oiWall', max: SELL_SCORE_MAX.oiWall },
  { label: 'Velocity', key: 'velocity', max: SELL_SCORE_MAX.velocity },
  { label: 'Regime', key: 'regime', max: SELL_SCORE_MAX.regime },
];

export const BUY_SCORE_PARTS: ScorePart[] = [
  { label: 'Direction', key: 'direction', max: BUY_SCORE_MAX.direction },
  { label: 'Today', key: 'today', max: BUY_SCORE_MAX.today },
  { label: 'OI Flow', key: 'flow', max: BUY_SCORE_MAX.flow },
  { label: 'Breakout', key: 'breakout', max: BUY_SCORE_MAX.breakout },
];

/** A setup's score parts with their points and reasons, in display order. */
export function scorePartsOf(setup: StrategySetup): (ScorePart & { points: number; reasons: string[] })[] {
  const parts = setupSide(setup.type) === Side.SELL ? SELL_SCORE_PARTS : BUY_SCORE_PARTS;
  const breakdown = setup.breakdown as unknown as Record<string, number>;
  const reasons = setup.reasons as unknown as Record<string, string[]>;
  return parts.map((part) => ({ ...part, points: breakdown[part.key] ?? 0, reasons: reasons[part.key] ?? [] }));
}

/** Every reason behind a setup, part by part. */
export const allReasons = (setup: StrategySetup): string[] => scorePartsOf(setup).flatMap((part) => part.reasons);

const points = (value: number): string => Math.round(value).toLocaleString('en-IN');

const signedPoints = (value: number): string => `${value >= 0 ? '+' : '−'}${points(Math.abs(value))}`;

/**
 * Where a setup breaks even at expiry: one price for a single option, with its
 * distance from spot ("BE 25,135 · +125"); the lower and upper for a straddle
 * or strangle ("BE 24,780 – 25,220"). Strangles list their strikes [CE, PE].
 */
export function breakevenLabel(setup: StrategySetup, spot: number): string {
  const single = SINGLE_OPTION_SETUPS[setup.type];
  if (single) {
    const breakeven = single.optionType === OptionType.CE ? setup.strikes[0] + setup.premium : setup.strikes[0] - setup.premium;
    return spot > 0 ? `BE ${points(breakeven)} · ${signedPoints(breakeven - spot)}` : `BE ${points(breakeven)}`;
  }
  const [callStrike, putStrike = callStrike] = setup.strikes;
  return `BE ${points(putStrike - setup.premium)} – ${points(callStrike + setup.premium)}`;
}

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
