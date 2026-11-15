import type { DailyBias, StrikeBiasSummary, PriceTrendSummary, ChecklistStatus, TradeSetupChecklistItem, TradeLevelRow, TradeLevelContext, TradeSetupSummary, StrikeHistoryEntry, OptionMomentumSide, OptionMomentumSummary } from './types';
import { pctChange, formatPct } from './helpers';
import { formatNumericDate } from '@/utils/marketStatus';
import { OptionType, type OptionTypeId } from '../../../shared/tradeEnums.js';
import { HealthStatus } from '../../../shared/appEnums.js';
import { Bias, Strength, TradeSetupStatus, Trend, type TradeSetupStatusId } from '../../../shared/analysisEnums.js';

export function checklistStatusText(status: ChecklistStatus): string {
  if (status === HealthStatus.Pass) return 'Yes';
  if (status === HealthStatus.Warn) return 'Wait';
  return 'No';
}

export function sortChecklistByStatus(items: TradeSetupChecklistItem[]): TradeSetupChecklistItem[] {
  const order: Record<ChecklistStatus, number> = { [HealthStatus.Pass]: 0, [HealthStatus.Warn]: 1, [HealthStatus.Fail]: 2 };
  return [...items].sort((a, b) => order[a.status] - order[b.status]);
}

export function readinessScore(items: TradeSetupChecklistItem[]): number {
  if (items.length === 0) return 0;
  const score = items.reduce((sum, item) => {
    if (item.status === HealthStatus.Pass) return sum + 1;
    if (item.status === HealthStatus.Warn) return sum + 0.5;
    return sum;
  }, 0);
  return Math.round((score / items.length) * 100);
}

export function setupReadinessLabel(status: TradeSetupStatusId, score: number): string {
  if (status === TradeSetupStatus.Avoid) return 'No setup';
  return `${score}%`;
}

export function setupReadinessWidth(status: TradeSetupStatusId, score: number): string {
  if (status === TradeSetupStatus.Avoid) return '0%';
  return `${score}%`;
}

export function distancePct(from: number | null, to: number | null): number | null {
  if (!from || !to) return null;
  return ((to - from) / from) * 100;
}

export function summarizeTradeLevels(rows: TradeLevelRow[], spot: number | null, selectedStrike: number): TradeLevelContext {
  if (!spot || rows.length === 0) {
    return {
      spot,
      supportStrike: null,
      resistanceStrike: null,
      maxOiStrike: null,
      selectedDistancePct: null,
      locationStatus: HealthStatus.Warn,
      riskRewardStatus: HealthStatus.Warn,
      locationAnswer: 'Spot/level data unavailable',
      riskRewardAnswer: 'Cannot estimate reward/risk from current data',
    };
  }

  const support = rows
    .filter((row) => row.strike <= spot && row.peConsolidatedOi > 0)
    .sort((a, b) => b.peConsolidatedOi - a.peConsolidatedOi)[0]?.strike ?? null;
  const resistance = rows
    .filter((row) => row.strike >= spot && row.ceConsolidatedOi > 0)
    .sort((a, b) => b.ceConsolidatedOi - a.ceConsolidatedOi)[0]?.strike ?? null;
  const maxOiStrike = [...rows]
    .sort((a, b) => (b.ceConsolidatedOi + b.peConsolidatedOi) - (a.ceConsolidatedOi + a.peConsolidatedOi))[0]?.strike ?? null;
  const selectedDistancePct = distancePct(spot, selectedStrike);
  const absSelectedDistance = Math.abs(selectedDistancePct ?? 999);
  const locationStatus: ChecklistStatus = absSelectedDistance <= 0.35 ? HealthStatus.Pass : absSelectedDistance <= 0.8 ? HealthStatus.Warn : HealthStatus.Fail;
  const supportDistance = support !== null ? Math.abs(distancePct(spot, support) ?? 999) : null;
  const resistanceDistance = resistance !== null ? Math.abs(distancePct(spot, resistance) ?? 999) : null;
  const hasNearbyBoundary = (supportDistance !== null && supportDistance <= 0.8) || (resistanceDistance !== null && resistanceDistance <= 0.8);
  const riskRewardStatus: ChecklistStatus = hasNearbyBoundary && absSelectedDistance <= 0.8 ? HealthStatus.Pass : absSelectedDistance <= 1.2 ? HealthStatus.Warn : HealthStatus.Fail;

  return {
    spot,
    supportStrike: support,
    resistanceStrike: resistance,
    maxOiStrike,
    selectedDistancePct,
    locationStatus,
    riskRewardStatus,
    locationAnswer: `Spot ${spot.toFixed(2)} is ${formatPct(selectedDistancePct)} from selected strike ${selectedStrike.toFixed(0)}`,
    riskRewardAnswer: `Support ${support ?? '-'}, resistance ${resistance ?? '-'}, max-OI magnet ${maxOiStrike ?? '-'}`,
  };
}

export function summarizeOptionMomentum(
  dates: string[],
  dateMap: Map<string, Map<string, StrikeHistoryEntry>>,
  expiries: string[],
  priceTrend: PriceTrendSummary,
  levels: TradeLevelContext,
): OptionMomentumSummary {
  const nearestExpiry = expiries[0] ?? null;
  if (!nearestExpiry || dates.length < 2) return { nearestExpiry, ce: null, pe: null };
  const series = dates
    .map((date) => ({ date, entry: dateMap.get(date)?.get(nearestExpiry) }))
    .filter((item): item is { date: string; entry: StrikeHistoryEntry } => Boolean(item.entry));
  if (series.length < 2) return { nearestExpiry, ce: null, pe: null };

  const expiryTime = new Date(`${nearestExpiry}T00:00:00`).getTime();
  const latestTime = new Date(`${series[series.length - 1].date}T00:00:00`).getTime();
  const daysToExpiry = Number.isFinite(expiryTime) && Number.isFinite(latestTime)
    ? Math.max(0, Math.ceil((expiryTime - latestTime) / 86400000))
    : null;

  const buildSide = (optionType: OptionTypeId): OptionMomentumSide | null => {
    const close = (entry: StrikeHistoryEntry) => optionType === OptionType.CE ? entry.ceClose : entry.peClose;
    const oi = (entry: StrikeHistoryEntry) => optionType === OptionType.CE ? entry.ceOi : entry.peOi;
    const volume = (entry: StrikeHistoryEntry) => optionType === OptionType.CE ? entry.ceVolume : entry.peVolume;
    const priced = series.filter((item) => close(item.entry) > 0);
    if (priced.length < 2) return null;
    const first = priced[0];
    const latest = priced[priced.length - 1];
    const firstClose = close(first.entry);
    const latestClose = close(latest.entry);
    const momentumPct = pctChange(firstClose, latestClose) ?? 0;
    const recent = priced.slice(-Math.min(4, priced.length));
    const recentMomentumPct = recent.length >= 2
      ? pctChange(close(recent[0].entry), close(recent[recent.length - 1].entry))
      : null;
    const firstOi = oi(first.entry);
    const latestOi = oi(latest.entry);
    const oiChangePct = firstOi > 0 ? pctChange(firstOi, latestOi) : null;
    const volumes = priced.map((item) => volume(item.entry)).filter((value) => value > 0);
    const latestVolume = volume(latest.entry);
    const averageVolume = volumes.length ? volumes.reduce((sum, value) => sum + value, 0) / volumes.length : 0;
    const momentumScore = momentumPct >= 20 ? 3 : momentumPct >= 10 ? 2 : momentumPct >= 5 ? 1 : 0;
    const recentScore = recentMomentumPct !== null && recentMomentumPct >= 8 ? 2 : recentMomentumPct !== null && recentMomentumPct >= 4 ? 1 : 0;
    const oiScore = oiChangePct !== null && oiChangePct >= 8 ? 2 : oiChangePct !== null && oiChangePct >= 0 ? 1 : 0;
    const activityScore = latestVolume > 0 && averageVolume > 0 && latestVolume >= averageVolume * 0.6 ? 1 : 0;
    const adverseTrend = (optionType === OptionType.CE && priceTrend.direction === Trend.Downward) ||
      (optionType === OptionType.PE && priceTrend.direction === Trend.Upward);
    const adversePenalty = adverseTrend && priceTrend.strength === Strength.Strong ? 3 : adverseTrend ? 1 : 0;
    const distanceScore = Math.abs(levels.selectedDistancePct ?? 999) <= 0.8 ? 1 : 0;
    const score = momentumScore + recentScore + oiScore + activityScore + distanceScore - adversePenalty;
    const reason = `${optionType} premium ${formatPct(momentumPct)} since ${formatNumericDate(first.date)}` +
      `${recentMomentumPct !== null ? `, recent ${formatPct(recentMomentumPct)}` : ''}` +
      `${latestVolume > 0 ? `, volume ${latestVolume.toLocaleString('en-IN')}` : ''}.`;
    return { optionType, firstClose, latestClose, momentumPct, recentMomentumPct, oiChangePct, latestVolume, averageVolume, daysToExpiry, score, reason };
  };

  return { nearestExpiry, ce: buildSide(OptionType.CE), pe: buildSide(OptionType.PE) };
}

export function summarizeTradeSetup(
  priceTrend: PriceTrendSummary,
  optionFlow: StrikeBiasSummary,
  selectedStrike: number,
  levels: TradeLevelContext,
  momentum: OptionMomentumSummary,
): TradeSetupSummary {
  const flowBullish = optionFlow.bias === Trend.Upward;
  const flowBearish = optionFlow.bias === Trend.Downward;
  const priceBullish = priceTrend.direction === Trend.Upward;
  const priceBearish = priceTrend.direction === Trend.Downward;
  const sideMomentumPass = (side: OptionMomentumSide | null) => Boolean(side && side.score >= 4 && side.momentumPct >= 5 &&
    (side.recentMomentumPct === null || side.recentMomentumPct >= 0));
  const sideMomentumWatch = (side: OptionMomentumSide | null) => Boolean(side && side.score >= 3 && side.momentumPct >= 3);
  const ceMomentumPass = sideMomentumPass(momentum.ce);
  const peMomentumPass = sideMomentumPass(momentum.pe);
  const cePriceSupport = priceTrend.direction !== Trend.Downward;
  const pePriceSupport = priceTrend.direction !== Trend.Upward;
  const expiryPassFor = (side: OptionMomentumSide | null) => side?.daysToExpiry === null || (side?.daysToExpiry !== undefined && side.daysToExpiry >= 3);
  const ceCandidate = Boolean(ceMomentumPass && cePriceSupport && expiryPassFor(momentum.ce) && levels.riskRewardStatus !== HealthStatus.Fail);
  const peCandidate = Boolean(peMomentumPass && pePriceSupport && expiryPassFor(momentum.pe) && levels.riskRewardStatus !== HealthStatus.Fail);
  const selectedSide = ceCandidate ? momentum.ce : peCandidate ? momentum.pe :
    (momentum.ce?.score ?? -Infinity) >= (momentum.pe?.score ?? -Infinity) ? momentum.ce : momentum.pe;
  const directionalFlow = ceCandidate || peCandidate || flowBullish || flowBearish;
  const direction: DailyBias = ceCandidate ? Bias.Bullish : peCandidate ? Bias.Bearish : flowBullish ? Bias.Bullish : flowBearish ? Bias.Bearish : Bias.Neutral;
  const priceAligned = ceCandidate ? priceBullish : peCandidate ? priceBearish : (flowBullish && priceBullish) || (flowBearish && priceBearish);
  const priceConflicts = ceCandidate ? priceBearish : peCandidate ? priceBullish : (flowBullish && priceBearish) || (flowBearish && priceBullish);
  const recentAligned = ceCandidate
    ? momentum.ce?.recentMomentumPct !== null && momentum.ce?.recentMomentumPct !== undefined && momentum.ce.recentMomentumPct >= 0
    : peCandidate
      ? momentum.pe?.recentMomentumPct !== null && momentum.pe?.recentMomentumPct !== undefined && momentum.pe.recentMomentumPct >= 0
      : (flowBullish && optionFlow.recentBias === Bias.Bullish) || (flowBearish && optionFlow.recentBias === Bias.Bearish);
  const recentConflicts = ceCandidate
    ? Boolean(momentum.ce?.recentMomentumPct !== null && momentum.ce?.recentMomentumPct !== undefined && momentum.ce.recentMomentumPct < 0)
    : peCandidate
      ? Boolean(momentum.pe?.recentMomentumPct !== null && momentum.pe?.recentMomentumPct !== undefined && momentum.pe.recentMomentumPct < 0)
      : (flowBullish && optionFlow.recentBias === Bias.Bearish) || (flowBearish && optionFlow.recentBias === Bias.Bullish);
  const momentumSide = selectedSide;
  const momentumAvailable = Boolean(momentumSide);
  const momentumPass = ceCandidate || peCandidate || sideMomentumPass(momentumSide);
  const momentumWatch = sideMomentumWatch(momentumSide);
  const volumePass = Boolean(momentumSide && momentumSide.latestVolume > 0 && momentumSide.averageVolume > 0 && momentumSide.latestVolume >= momentumSide.averageVolume * 0.6);
  const oiPass = Boolean(momentumSide && momentumSide.oiChangePct !== null && momentumSide.oiChangePct >= 0);
  const expiryPass = expiryPassFor(momentumSide);
  const confidenceStatus: ChecklistStatus = optionFlow.confidence >= 65 ? HealthStatus.Pass : optionFlow.confidence >= 55 ? HealthStatus.Warn : HealthStatus.Fail;
  const priceStatus: ChecklistStatus = priceAligned ? HealthStatus.Pass : priceConflicts ? HealthStatus.Fail : HealthStatus.Warn;
  const recentStatus: ChecklistStatus = recentAligned ? HealthStatus.Pass : recentConflicts ? HealthStatus.Fail : HealthStatus.Warn;
  const flowStatus: ChecklistStatus = directionalFlow ? HealthStatus.Pass : HealthStatus.Fail;
  const ready = (ceCandidate || peCandidate) && priceAligned && momentumPass && !recentConflicts && levels.locationStatus !== HealthStatus.Fail && expiryPass;
  const watch = directionalFlow && !ready && !priceConflicts && momentumWatch && levels.locationStatus !== HealthStatus.Fail;
  const status: TradeSetupStatusId = ready ? TradeSetupStatus.Confirmed : watch ? TradeSetupStatus.Watch : TradeSetupStatus.Avoid;
  const strikeLabel = selectedStrike.toFixed(0);
  const sideLabel = direction === Bias.Bullish ? 'upside' : direction === Bias.Bearish ? 'downside' : 'range';
  const oppositeLabel = direction === Bias.Bullish ? 'below' : direction === Bias.Bearish ? 'above' : 'outside';

  const checklist: TradeSetupChecklistItem[] = [
    {
      label: 'Buying flow',
      status: flowStatus,
      answer: directionalFlow ? `${optionFlow.bias} ${optionFlow.strength.toLowerCase()} flow` : 'Flow is neutral or mixed',
    },
    {
      label: 'Confidence',
      status: confidenceStatus,
      answer: `${optionFlow.confidence}% buying flow agreement ${optionFlow.confidence >= 65 ? 'is tradeable' : optionFlow.confidence >= 55 ? 'needs confirmation' : 'is too low'}`,
    },
    {
      label: 'Price confirms',
      status: priceStatus,
      answer: priceAligned
        ? `Price trend agrees: ${priceTrend.direction}`
        : priceConflicts
          ? `Conflict: price is ${priceTrend.direction}`
          : `Price is ${priceTrend.direction.toLowerCase()}, wait for break`,
    },
    {
      label: 'Recent sessions',
      status: recentStatus,
      answer: recentAligned
        ? `Recent 3 sessions support ${direction.toLowerCase()}`
        : recentConflicts
          ? `Recent flow opposes ${direction.toLowerCase()}`
          : 'Recent flow is not decisive',
    },
    {
      label: 'Premium momentum',
      status: momentumPass ? HealthStatus.Pass : momentumWatch ? HealthStatus.Warn : HealthStatus.Fail,
      answer: momentumSide
        ? `${momentumSide.optionType} ${formatPct(momentumSide.momentumPct)} overall${momentumSide.recentMomentumPct !== null ? `, ${formatPct(momentumSide.recentMomentumPct)} recent` : ''}`
        : 'No nearest-expiry momentum evidence',
    },
    {
      label: 'Volume confirms',
      status: volumePass ? HealthStatus.Pass : momentumAvailable ? HealthStatus.Warn : HealthStatus.Fail,
      answer: momentumSide && momentumSide.latestVolume > 0
        ? `Latest volume ${momentumSide.latestVolume.toLocaleString('en-IN')} vs average ${Math.round(momentumSide.averageVolume).toLocaleString('en-IN')}`
        : 'Volume is unavailable or too thin',
    },
    {
      label: 'OI confirms',
      status: oiPass ? HealthStatus.Pass : momentumAvailable ? HealthStatus.Warn : HealthStatus.Fail,
      answer: momentumSide?.oiChangePct !== null && momentumSide?.oiChangePct !== undefined
        ? `OI ${formatPct(momentumSide.oiChangePct)} across the nearest-expiry history`
        : 'OI change is unavailable',
    },
    {
      label: 'Expiry risk',
      status: expiryPass ? HealthStatus.Pass : HealthStatus.Fail,
      answer: momentumSide?.daysToExpiry === null || momentumSide?.daysToExpiry === undefined
        ? 'DTE unavailable'
        : `${momentumSide.daysToExpiry} DTE; avoid fresh buying too close to expiry`,
    },
    {
      label: 'Risk location',
      status: levels.locationStatus,
      answer: levels.locationAnswer,
    },
    {
      label: 'Reward/risk proxy',
      status: levels.riskRewardStatus,
      answer: levels.riskRewardAnswer,
    },
  ];

  if (status === TradeSetupStatus.Confirmed) {
    return {
      status,
      direction,
      title: `${direction} setup confirmed`,
      action: `Option buying ${sideLabel} trade is allowed: nearest-expiry ${momentumSide?.reason ?? 'premium momentum is confirmed'}`,
      strategy: direction === Bias.Bullish ? 'Prefer call debit spread or long futures on pullback.' : 'Prefer put debit spread or short futures on failed bounce.',
      trigger: direction === Bias.Bullish ? `Enter only above/holding ${strikeLabel}; stronger if price clears CE wall ${levels.resistanceStrike ?? '-'}.` : `Enter only below/rejecting ${strikeLabel}; stronger if PE support ${levels.supportStrike ?? '-'} weakens.`,
      invalidation: `Exit if price closes back ${oppositeLabel} ${strikeLabel}; also respect VWAP/previous-day levels if live chart provides them.`,
      target: direction === Bias.Bullish ? `Book near next resistance/max-OI zone ${levels.resistanceStrike ?? levels.maxOiStrike ?? '-'}.` : `Book near next support/max-OI zone ${levels.supportStrike ?? levels.maxOiStrike ?? '-'}.`,
      sizing: 'Normal risk only. Keep max loss predefined before entry.',
      checklist,
    };
  }

  if (status === TradeSetupStatus.Watch) {
    return {
      status,
      direction,
      title: `${direction} watchlist, not entry yet`,
      action: `Directional bias exists, but nearest-expiry premium momentum is not fully confirmed. Wait for continuation.`,
      strategy: direction === Bias.Bullish ? 'Wait for breakout/hold before call spread.' : 'Wait for breakdown/rejection before put spread.',
      trigger: direction === Bias.Bullish ? `Need price acceptance above ${strikeLabel}, VWAP, or CE resistance ${levels.resistanceStrike ?? '-'}.` : `Need price acceptance below ${strikeLabel}, VWAP, or failed bounce from CE resistance ${levels.resistanceStrike ?? '-'}.`,
      invalidation: 'No trade until invalidation is close and obvious.',
      target: `Plan target around support/resistance/max-OI zones: ${levels.supportStrike ?? '-'} / ${levels.resistanceStrike ?? '-'} / ${levels.maxOiStrike ?? '-'}.`,
      sizing: 'Half size or no trade until confirmation improves.',
      checklist,
    };
  }

  return {
    status,
    direction: Bias.Neutral,
    title: 'No clean trade setup',
    action: 'Skip fresh option buying entry. Signals are neutral, weak, or conflicting.',
    strategy: 'Avoid naked option buying. If trading, use only clearly defined range strategies.',
    trigger: 'Wait for price and option flow to align in the same direction.',
    invalidation: 'No valid invalidation because there is no confirmed setup.',
    target: 'No target until an option buying setup appears.',
    sizing: 'No option buying risk.',
    checklist,
  };
}
