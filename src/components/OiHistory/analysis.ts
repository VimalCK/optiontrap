import type { StrikeBias, DailyBias, PriceTrendDirection, StrikeBiasDay, StrikeBiasSummary, PriceTrendSummary, TradeBiasSummary, ChecklistStatus, TradeSetupChecklistItem, TradeLevelRow, TradeLevelContext, TradeSetupSummary, SellingSetupSummary, StrikeHistoryEntry, PremiumDecaySide, PremiumDecaySummary, OptionMomentumSide, OptionMomentumSummary } from './types';
import { priceDirection, classifyOptionMove, patternBiasScore, pctChange, formatPct } from './helpers';
import { formatCalendarDate, formatNumericDate } from '@/utils/marketStatus';
import { OptionType, type OptionTypeId } from '../../../shared/tradeEnums.js';
import { HealthStatus } from '../../../shared/appEnums.js';
import { Bias, MoveDirection, RolloverPattern, SellingSetup, Strength, TradeSetupStatus, Trend, type MoveDirectionId, type RolloverPatternId, type SellingSetupId, type TradeSetupStatusId } from '../../../shared/analysisEnums.js';

export function summarizePriceTrend(dates: string[], spotByDate: Map<string, number>): PriceTrendSummary {
  const values = dates
    .map((date) => ({ date, price: spotByDate.get(date) || 0 }))
    .filter((value) => value.price > 0);

  if (values.length < 2) {
    return {
      direction: Trend.Unknown,
      strength: Strength.Unknown,
      startPrice: values[0]?.price ?? null,
      endPrice: values[0]?.price ?? null,
      changePct: null,
      recentChangePct: null,
      sessions: values.length,
      reason: 'Not enough spot/future price history for trend confirmation.',
    };
  }

  const startPrice = values[0].price;
  const endPrice = values[values.length - 1].price;
  const changePct = pctChange(startPrice, endPrice);
  const recentWindow = values.slice(-4);
  const recentChangePct = recentWindow.length >= 2
    ? pctChange(recentWindow[0].price, recentWindow[recentWindow.length - 1].price)
    : null;
  const absChange = Math.abs(changePct || 0);
  const direction: PriceTrendDirection = changePct === null
    ? Trend.Unknown
    : changePct > 0.5
      ? Trend.Upward
      : changePct < -0.5
        ? Trend.Downward
        : Trend.Sideways;
  const strength = direction === Trend.Unknown
    ? Strength.Unknown
    : direction === Trend.Sideways
      ? Strength.Flat
      : absChange >= 2
        ? Strength.Strong
        : absChange >= 1
          ? Strength.Moderate
          : Strength.Mild;
  const reason = direction === Trend.Upward
    ? `Underlying moved higher from ${startPrice.toFixed(2)} to ${endPrice.toFixed(2)}.`
    : direction === Trend.Downward
      ? `Underlying moved lower from ${startPrice.toFixed(2)} to ${endPrice.toFixed(2)}.`
      : direction === Trend.Sideways
        ? `Underlying stayed rangebound from ${startPrice.toFixed(2)} to ${endPrice.toFixed(2)}.`
        : 'Price trend could not be determined.';

  return {
    direction,
    strength,
    startPrice,
    endPrice,
    changePct,
    recentChangePct,
    sessions: values.length,
    reason,
  };
}

export function summarizeTradeBias(priceTrend: PriceTrendSummary, optionFlow: StrikeBiasSummary): TradeBiasSummary {
  const priceBullish = priceTrend.direction === Trend.Upward;
  const priceBearish = priceTrend.direction === Trend.Downward;
  const flowBullish = optionFlow.bias === Trend.Upward;
  const flowBearish = optionFlow.bias === Trend.Downward;

  if (priceBullish && flowBullish) {
    return {
      bias: Bias.Bullish,
      title: 'Bullish - Price and OI agree',
      action: 'Long bias. Prefer buy/hold on pullbacks while price holds trend.',
      reason: `Price trend is ${priceTrend.strength.toLowerCase()} upward and option flow is ${optionFlow.strength.toLowerCase()} upward.`,
    };
  }

  if (priceBearish && flowBearish) {
    return {
      bias: Bias.Bearish,
      title: 'Bearish - Price and OI agree',
      action: 'Short/avoid-long bias. Prefer confirmation on failed bounces.',
      reason: `Price trend is ${priceTrend.strength.toLowerCase()} downward and option flow is ${optionFlow.strength.toLowerCase()} downward.`,
    };
  }

  if ((priceBullish && flowBearish) || (priceBearish && flowBullish)) {
    return {
      bias: Bias.Conflict,
      title: 'Conflict - Price and OI disagree',
      action: 'Avoid blind directional entry. Wait for price confirmation or reversal failure.',
      reason: `Price is ${priceTrend.direction.toLowerCase()}, but option flow is ${optionFlow.bias.toLowerCase()}.`,
    };
  }

  if (priceBullish) {
    return {
      bias: Bias.Bullish,
      title: 'Bullish price trend, OI neutral',
      action: 'Cautious long bias. Size smaller until option flow confirms.',
      reason: `Price trend is ${priceTrend.strength.toLowerCase()} upward while option flow is neutral.`,
    };
  }

  if (priceBearish) {
    return {
      bias: Bias.Bearish,
      title: 'Bearish price trend, OI neutral',
      action: 'Cautious short/avoid-long bias until option flow confirms.',
      reason: `Price trend is ${priceTrend.strength.toLowerCase()} downward while option flow is neutral.`,
    };
  }

  return {
    bias: Bias.Neutral,
    title: 'Neutral - No clear trade edge',
    action: 'Wait. Price is not directional enough or option flow is mixed.',
    reason: `Price trend is ${priceTrend.direction.toLowerCase()} and option flow is ${optionFlow.bias.toLowerCase()}.`,
  };
}

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

export function summarizePremiumDecay(
  dates: string[],
  dateMap: Map<string, Map<string, StrikeHistoryEntry>>,
  expiries: string[],
  priceTrend: PriceTrendSummary,
  levels: TradeLevelContext,
): PremiumDecaySummary {
  const nearestExpiry = expiries[0] ?? null;
  if (!nearestExpiry || dates.length < 2) {
    return { nearestExpiry, ce: null, pe: null };
  }

  const series = dates
    .map((date) => ({ date, entry: dateMap.get(date)?.get(nearestExpiry) }))
    .filter((item): item is { date: string; entry: StrikeHistoryEntry } => Boolean(item.entry));

  if (series.length < 2) return { nearestExpiry, ce: null, pe: null };

  const expiryTime = new Date(`${nearestExpiry}T00:00:00`).getTime();
  const latestDate = new Date(`${series[series.length - 1].date}T00:00:00`).getTime();
  const daysToExpiry = Number.isFinite(expiryTime) && Number.isFinite(latestDate)
    ? Math.max(0, Math.ceil((expiryTime - latestDate) / 86400000))
    : null;

  const buildSide = (optionType: OptionTypeId): PremiumDecaySide | null => {
    const close = (entry: StrikeHistoryEntry) => optionType === OptionType.CE ? entry.ceClose : entry.peClose;
    const oi = (entry: StrikeHistoryEntry) => optionType === OptionType.CE ? entry.ceOi : entry.peOi;
    const volume = (entry: StrikeHistoryEntry) => optionType === OptionType.CE ? entry.ceVolume : entry.peVolume;
    const priced = series.filter((item) => close(item.entry) > 0);
    if (priced.length < 2) return null;

    const first = priced[0];
    const latest = priced[priced.length - 1];
    const firstClose = close(first.entry);
    const latestClose = close(latest.entry);
    const decayPct = pctChange(firstClose, latestClose) ?? 0;
    const recent = priced.slice(-Math.min(4, priced.length));
    const recentDecayPct = recent.length >= 2
      ? pctChange(close(recent[0].entry), close(recent[recent.length - 1].entry))
      : null;
    const previousOi = oi(first.entry);
    const latestOi = oi(latest.entry);
    const oiChangePct = previousOi > 0 ? pctChange(previousOi, latestOi) : null;
    const volumes = priced.map((item) => volume(item.entry)).filter((value) => value > 0);
    const latestVolume = volume(latest.entry);
    const averageVolume = volumes.length > 0 ? volumes.reduce((sum, value) => sum + value, 0) / volumes.length : 0;

    // Decay is a separate selling path: it does not require directional OI,
    // but it does require enough time-series evidence and real activity.
    const decayStrength = decayPct <= -25 ? 3 : decayPct <= -12 ? 2 : decayPct <= -6 ? 1 : 0;
    const recentDecayStrength = recentDecayPct !== null && recentDecayPct <= -8 ? 1 : 0;
    const timeStrength = daysToExpiry !== null && daysToExpiry <= 7 ? 2 : daysToExpiry !== null && daysToExpiry <= 14 ? 1 : 0;
    const activityStrength = latestVolume > 0 && averageVolume > 0 ? 1 : 0;
    const oiStrength = latestOi > 0 && (oiChangePct === null || oiChangePct >= -15) ? 1 : 0;
    const adverseTrend = (optionType === OptionType.CE && priceTrend.direction === Trend.Upward) ||
      (optionType === OptionType.PE && priceTrend.direction === Trend.Downward);
    const adversePenalty = adverseTrend && priceTrend.strength === Strength.Strong ? 3 : adverseTrend ? 1 : 0;
    const distancePctFromSpot = Math.abs(levels.selectedDistancePct ?? 999);
    const distanceStrength = distancePctFromSpot <= 2.5 ? 1 : 0;
    const score = decayStrength + recentDecayStrength + timeStrength + activityStrength + oiStrength + distanceStrength - adversePenalty;
    const reason = `${optionType} premium ${formatPct(decayPct)} since ${formatNumericDate(first.date)}` +
      `${daysToExpiry !== null ? `, ${daysToExpiry} DTE` : ''}` +
      `${latestVolume > 0 ? `, volume ${latestVolume.toLocaleString('en-IN')}` : ''}.`;

    return {
      optionType,
      firstClose,
      latestClose,
      decayPct,
      recentDecayPct,
      latestOi,
      oiChangePct,
      latestVolume,
      averageVolume,
      daysToExpiry,
      score,
      reason,
    };
  };

  return { nearestExpiry, ce: buildSide(OptionType.CE), pe: buildSide(OptionType.PE) };
}

export function summarizeSellingSetup(
  priceTrend: PriceTrendSummary,
  optionFlow: StrikeBiasSummary,
  selectedStrike: number,
  levels: TradeLevelContext,
  decay: PremiumDecaySummary,
): SellingSetupSummary {
  const flowBearish = optionFlow.bias === Trend.Downward;
  const flowBullish = optionFlow.bias === Trend.Upward;
  const priceBearish = priceTrend.direction === Trend.Downward;
  const priceBullish = priceTrend.direction === Trend.Upward;
  const priceSideways = priceTrend.direction === Trend.Sideways;
  const hasResistance = levels.resistanceStrike !== null;
  const hasSupport = levels.supportStrike !== null;
  const confidenceOk = optionFlow.confidence >= 55;
  const locationOk = levels.locationStatus !== HealthStatus.Fail;
  const callSellCandidate = flowBearish && !priceBullish && hasResistance && confidenceOk;
  const putSellCandidate = flowBullish && !priceBearish && hasSupport && confidenceOk;
  const rangeSellCandidate = priceSideways && hasSupport && hasResistance && optionFlow.confidence >= 50;
  const decaySide = [decay.ce, decay.pe]
    .filter((side): side is PremiumDecaySide => side !== null)
    .sort((a, b) => b.score - a.score || a.decayPct - b.decayPct)[0];
  const decayCandidate = decaySide && decaySide.score >= 4 && decaySide.decayPct <= -6 &&
    (decaySide.daysToExpiry === null || decaySide.daysToExpiry <= 21);
  const type: SellingSetupId = callSellCandidate
    ? SellingSetup.CallSell
    : putSellCandidate
      ? SellingSetup.PutSell
      : decayCandidate
        ? decaySide.optionType === OptionType.CE ? SellingSetup.CallSell : SellingSetup.PutSell
      : rangeSellCandidate
        ? SellingSetup.RangeSell
        : SellingSetup.NoSell;
  const decayConfirmed = Boolean(decayCandidate && locationOk && (decaySide!.score >= 5 || levels.riskRewardStatus !== HealthStatus.Fail));
  const decayWatch = Boolean(decayCandidate && !decayConfirmed);
  const status: TradeSetupStatusId = ((callSellCandidate || putSellCandidate) && locationOk && levels.riskRewardStatus !== HealthStatus.Fail) || decayConfirmed
    ? TradeSetupStatus.Confirmed
    : type !== SellingSetup.NoSell || decayWatch
      ? TradeSetupStatus.Watch
      : TradeSetupStatus.Avoid;
  const strikeLabel = selectedStrike.toFixed(0);
  const checklist: TradeSetupChecklistItem[] = [
    {
      label: 'Selling bias',
      status: type !== SellingSetup.NoSell ? HealthStatus.Pass : HealthStatus.Fail,
      answer: decayCandidate
        ? `${decaySide!.optionType} premium-decay setup: ${decaySide!.reason}`
        : type === SellingSetup.CallSell
        ? 'Bearish/sideways bias supports call selling'
        : type === SellingSetup.PutSell
          ? 'Bullish/sideways bias supports put selling'
          : type === SellingSetup.RangeSell
            ? 'Sideways action supports defined range selling'
            : 'No premium-selling edge detected',
    },
    {
      label: 'OI wall / decay',
      status: decayCandidate
        ? (decaySide!.latestOi > 0 ? HealthStatus.Pass : HealthStatus.Warn)
        : type === SellingSetup.CallSell ? (hasResistance ? HealthStatus.Pass : HealthStatus.Fail) : type === SellingSetup.PutSell ? (hasSupport ? HealthStatus.Pass : HealthStatus.Fail) : hasSupport && hasResistance ? HealthStatus.Pass : HealthStatus.Warn,
      answer: `Support ${levels.supportStrike ?? '-'}, resistance ${levels.resistanceStrike ?? '-'}`,
    },
    {
      label: 'Trend risk',
      status: (type === SellingSetup.CallSell && priceBullish) || (type === SellingSetup.PutSell && priceBearish) ? HealthStatus.Fail : priceSideways ? HealthStatus.Pass : HealthStatus.Warn,
      answer: `Price trend is ${priceTrend.direction.toLowerCase()}`,
    },
    {
      label: 'Premium decay',
      status: decayCandidate ? (decayConfirmed ? HealthStatus.Pass : HealthStatus.Warn) : HealthStatus.Fail,
      answer: decaySide
        ? `${decaySide.optionType} ${formatPct(decaySide.decayPct)} over history${decaySide.daysToExpiry !== null ? `; ${decaySide.daysToExpiry} days to expiry` : ''}`
        : 'No reliable nearest-expiry premium decay',
    },
    {
      label: 'Risk location',
      status: levels.locationStatus,
      answer: levels.locationAnswer,
    },
    {
      label: 'Defined risk',
      status: type !== SellingSetup.NoSell ? HealthStatus.Warn : HealthStatus.Fail,
      answer: type === SellingSetup.NoSell ? 'No selling structure suggested' : 'Prefer credit spread, not naked short option',
    },
  ];

  if (type === SellingSetup.CallSell) {
    const decaySell = decayCandidate && decaySide!.optionType === OptionType.CE;
    return {
      status,
      type,
      title: decaySell
        ? (status === TradeSetupStatus.Confirmed ? 'Call decay sell candidate' : 'Call decay sell watch')
        : (status === TradeSetupStatus.Confirmed ? 'Call sell candidate' : 'Call sell watch'),
      action: decaySell
        ? `Nearest-expiry CE premium has decayed ${formatPct(decaySide!.decayPct)}. Prefer a defined-risk call spread; do not treat decay as protection from a sudden rally.`
        : 'Selling calls can be considered only near resistance/rejection, not after a large breakdown chase.',
      trigger: decaySell
        ? `Enter only while CE premium remains below ${decaySide!.latestClose.toFixed(2)} and spot stays below ${levels.resistanceStrike ?? strikeLabel}.`
        : `Sell call spread near CE resistance ${levels.resistanceStrike ?? strikeLabel} after rejection/failure to reclaim.`,
      invalidation: decaySell
        ? `Exit if spot accepts above ${levels.resistanceStrike ?? strikeLabel}, CE premium reverses sharply, or volume expands with a breakout.`
        : `Exit if price accepts above ${levels.resistanceStrike ?? strikeLabel} or bullish flow expands.`,
      target: decaySell ? 'Cover after another 50-70% premium reduction or before the remaining risk becomes asymmetric.' : 'Cover at 50-70% premium decay or near support/max-OI magnet.',
      sizing: status === TradeSetupStatus.Confirmed ? 'Defined-risk small/normal size; expiry decay has gap risk.' : 'Small size or wait for rejection candle.',
      checklist,
    };
  }

  if (type === SellingSetup.PutSell) {
    const decaySell = decayCandidate && decaySide!.optionType === OptionType.PE;
    return {
      status,
      type,
      title: decaySell
        ? (status === TradeSetupStatus.Confirmed ? 'Put decay sell candidate' : 'Put decay sell watch')
        : (status === TradeSetupStatus.Confirmed ? 'Put sell candidate' : 'Put sell watch'),
      action: decaySell
        ? `Nearest-expiry PE premium has decayed ${formatPct(decaySide!.decayPct)}. Prefer a defined-risk put spread; a quiet market can still gap lower.`
        : 'Selling puts can be considered only near support/hold, not into a fresh breakdown.',
      trigger: decaySell
        ? `Enter only while PE premium remains below ${decaySide!.latestClose.toFixed(2)} and spot stays above ${levels.supportStrike ?? strikeLabel}.`
        : `Sell put spread near PE support ${levels.supportStrike ?? strikeLabel} after hold/reclaim.`,
      invalidation: decaySell
        ? `Exit if spot accepts below ${levels.supportStrike ?? strikeLabel}, PE premium reverses sharply, or volume expands with a breakdown.`
        : `Exit if price accepts below ${levels.supportStrike ?? strikeLabel} or bearish flow expands.`,
      target: decaySell ? 'Cover after another 50-70% premium reduction or before the remaining risk becomes asymmetric.' : 'Cover at 50-70% premium decay or near resistance/max-OI magnet.',
      sizing: status === TradeSetupStatus.Confirmed ? 'Defined-risk small/normal size; expiry decay has gap risk.' : 'Small size or wait for support hold.',
      checklist,
    };
  }

  if (type === SellingSetup.RangeSell) {
    return {
      status,
      type,
      title: 'Range sell watch',
      action: 'Range selling is possible only if both support and resistance hold.',
      trigger: `Use iron condor/credit spreads between ${levels.supportStrike ?? '-'} and ${levels.resistanceStrike ?? '-'}.`,
      invalidation: 'Exit the threatened side if price accepts outside the OI range.',
      target: 'Cover on premium decay or when price returns toward max-OI magnet.',
      sizing: 'Defined-risk small size until range confirms.',
      checklist,
    };
  }

  return {
    status,
    type,
    title: 'No clean selling setup',
    action: 'Do not force option selling; OI wall, trend, or location is not supportive.',
    trigger: 'Wait for price to reach support/resistance and reject/hold.',
    invalidation: 'No valid invalidation until a selling setup forms.',
    target: 'No target until premium-selling setup appears.',
    sizing: 'No short premium risk.',
    checklist,
  };
}

export function summarizeStrikeBias(
  dates: string[],
  dateMap: Map<string, Map<string, { ceOi: number; peOi: number; ceClose: number; peClose: number }>>,
  expiries: string[],
  spotByDate: Map<string, number>,
): StrikeBiasSummary {
  let score = 0;
  let bullishDays = 0;
  let bearishDays = 0;
  let neutralDays = 0;
  let previousTotals: { ceOi: number; peOi: number; ceClose: number; peClose: number } | null = null;
  const dailyBreakdown: StrikeBiasDay[] = [];

  const totalsByDate = dates.map((date) => {
    const expMap = dateMap.get(date);
    const totals = { date, ceOi: 0, peOi: 0, ceClose: 0, peClose: 0, cePriceCount: 0, pePriceCount: 0 };

    for (const exp of expiries) {
      const entry = expMap?.get(exp);
      if (!entry) continue;
      totals.ceOi += entry.ceOi;
      totals.peOi += entry.peOi;
      if (entry.ceClose > 0) {
        totals.ceClose += entry.ceClose;
        totals.cePriceCount++;
      }
      if (entry.peClose > 0) {
        totals.peClose += entry.peClose;
        totals.pePriceCount++;
      }
    }

    return {
      date,
      ceOi: totals.ceOi,
      peOi: totals.peOi,
      ceClose: totals.cePriceCount > 0 ? totals.ceClose / totals.cePriceCount : 0,
      peClose: totals.pePriceCount > 0 ? totals.peClose / totals.pePriceCount : 0,
    };
  });

  for (const totals of totalsByDate) {
    if (!previousTotals) {
      previousTotals = totals;
      continue;
    }

    const cePattern = classifyOptionMove(totals.ceOi, previousTotals.ceOi, totals.ceClose, previousTotals.ceClose);
    const pePattern = classifyOptionMove(totals.peOi, previousTotals.peOi, totals.peClose, previousTotals.peClose);
    const dayScore = patternBiasScore(cePattern, OptionType.CE) + patternBiasScore(pePattern, OptionType.PE);
    score += dayScore;

    const dayBias: DailyBias = dayScore > 0 ? Bias.Bullish : dayScore < 0 ? Bias.Bearish : Bias.Neutral;
    if (dayScore > 0) bullishDays++;
    else if (dayScore < 0) bearishDays++;
    else neutralDays++;

    dailyBreakdown.push({
      date: totals.date,
      cePattern,
      pePattern,
      bias: dayBias,
      score: dayScore,
      cumulativeScore: score,
    });

    previousTotals = totals;
  }

  const first = totalsByDate.find((v) => v.ceOi > 0 || v.peOi > 0);
  const last = [...totalsByDate].reverse().find((v) => v.ceOi > 0 || v.peOi > 0);
  const totalSignalDays = bullishDays + bearishDays + neutralDays;
  const decisiveDays = bullishDays + bearishDays;
  const confidence = totalSignalDays > 0 ? Math.round((Math.max(bullishDays, bearishDays) / totalSignalDays) * 100) : 0;
  const bias: StrikeBias = score > 1 ? Trend.Upward : score < -1 ? Trend.Downward : Trend.Neutral;
  const absScore = Math.abs(score);
  const strength = bias === Trend.Neutral
    ? decisiveDays > 0 ? Strength.Mixed : Strength.Mild
    : absScore >= 8 ? Strength.Strong : absScore >= 4 ? Strength.Moderate : Strength.Mild;
  const ceOiChangePct = first && last ? pctChange(first.ceOi, last.ceOi) : null;
  const peOiChangePct = first && last ? pctChange(first.peOi, last.peOi) : null;
  const pcrStart = first && first.ceOi > 0 ? first.peOi / first.ceOi : null;
  const pcrEnd = last && last.ceOi > 0 ? last.peOi / last.ceOi : null;
  const firstSpotDate = dates.find((date) => (spotByDate.get(date) || 0) > 0);
  const lastSpotDate = [...dates].reverse().find((date) => (spotByDate.get(date) || 0) > 0);
  const spotChangePct = firstSpotDate && lastSpotDate
    ? pctChange(spotByDate.get(firstSpotDate) || 0, spotByDate.get(lastSpotDate) || 0)
    : null;
  const recentDays = dailyBreakdown.slice(-3);
  const recentScore = recentDays.reduce((sum, day) => sum + day.score, 0);
  const recentBias: DailyBias = recentScore > 1 ? Bias.Bullish : recentScore < -1 ? Bias.Bearish : Bias.Neutral;
  const driver = ceOiChangePct !== null && peOiChangePct !== null
    ? Math.abs(peOiChangePct) > Math.abs(ceOiChangePct)
      ? `PE OI moved more than CE OI (${formatPct(peOiChangePct)} vs ${formatPct(ceOiChangePct)}).`
      : Math.abs(ceOiChangePct) > Math.abs(peOiChangePct)
        ? `CE OI moved more than PE OI (${formatPct(ceOiChangePct)} vs ${formatPct(peOiChangePct)}).`
        : 'CE and PE OI changed at a similar pace.'
    : 'OI change driver is limited because start OI is missing.';
  const warning = bias === Trend.Upward && recentBias === Bias.Bearish
    ? 'Overall bias is upward, but recent sessions show bearish pressure.'
    : bias === Trend.Downward && recentBias === Bias.Bullish
      ? 'Overall bias is downward, but recent sessions show bullish recovery.'
      : bias === Trend.Neutral && recentBias !== Bias.Neutral
        ? `Overall bias is neutral, but recent sessions lean ${recentBias.toLowerCase()}.`
        : null;
  const pcrDirection = pcrStart !== null && pcrEnd !== null
    ? pcrEnd > pcrStart ? 'rising strike PCR' : pcrEnd < pcrStart ? 'falling strike PCR' : 'flat strike PCR'
    : 'limited PCR data';
  const reason = bias === Trend.Upward
    ? `Bullish days lead bearish days with ${pcrDirection}.`
    : bias === Trend.Downward
      ? `Bearish days lead bullish days with ${pcrDirection}.`
      : `Bullish and bearish activity is balanced with ${pcrDirection}.`;

  return {
    bias,
    strength,
    confidence,
    score,
    bullishDays,
    bearishDays,
    neutralDays,
    totalDays: totalSignalDays,
    ceOiChangePct,
    peOiChangePct,
    pcrStart,
    pcrEnd,
    spotChangePct,
    recentBias,
    recentScore,
    recentDays,
    driver,
    warning,
    reason,
  };
}

/** Each directional rollover pattern by the premiums' direction: rising (Long), falling (Short), or flat. */
const ROLLING_OVER: Record<MoveDirectionId, RolloverPatternId> = {
  [MoveDirection.Up]: RolloverPattern.RollingOverLong,
  [MoveDirection.Down]: RolloverPattern.RollingOverShort,
  [MoveDirection.Neutral]: RolloverPattern.RollingOver,
};
const FRESH_BUILD: Record<MoveDirectionId, RolloverPatternId> = {
  [MoveDirection.Up]: RolloverPattern.FreshBuildLong,
  [MoveDirection.Down]: RolloverPattern.FreshBuildShort,
  [MoveDirection.Neutral]: RolloverPattern.FreshBuild,
};
const DOUBLING_DOWN: Record<MoveDirectionId, RolloverPatternId> = {
  [MoveDirection.Up]: RolloverPattern.DoublingDownLong,
  [MoveDirection.Down]: RolloverPattern.DoublingDownShort,
  [MoveDirection.Neutral]: RolloverPattern.DoublingDown,
};
/** Exiting with falling premiums is longs unwinding; with rising ones, shorts covering. */
const EXITING: Record<MoveDirectionId, RolloverPatternId> = {
  [MoveDirection.Down]: RolloverPattern.ExitingLongUnwind,
  [MoveDirection.Up]: RolloverPattern.ExitingShortCover,
  [MoveDirection.Neutral]: RolloverPattern.Exiting,
};

export function classifyPattern(
  oiByExpiry: Map<string, { oi: number; prevOi: number | undefined; close: number; prevClose: number | undefined }>,
  expiries: string[],
): RolloverPatternId {
  // Single expiry (monthly scrips like BANKNIFTY): use OI + Price signal
  if (expiries.length < 2) {
    let entry: { oi: number; prevOi: number | undefined; close: number; prevClose: number | undefined } | undefined;
    for (const exp of expiries) {
      if (oiByExpiry.has(exp)) { entry = oiByExpiry.get(exp); break; }
    }
    if (!entry) return RolloverPattern.None;
    return classifyOptionMove(entry.oi, entry.prevOi, entry.close, entry.prevClose);
  }

  let nearestIdx = -1;
  for (let i = 0; i < expiries.length; i++) {
    if (oiByExpiry.has(expiries[i])) { nearestIdx = i; break; }
  }
  if (nearestIdx < 0) return RolloverPattern.None;

  const nearest = oiByExpiry.get(expiries[nearestIdx])!;
  const nearestChg = nearest.prevOi !== undefined && nearest.prevOi > 0
    ? (nearest.oi - nearest.prevOi) / nearest.prevOi
    : 0;

  let anyRising = false;
  let anyFalling = false;
  let farCount = 0;

  for (let i = nearestIdx + 1; i < expiries.length; i++) {
    const entry = oiByExpiry.get(expiries[i]);
    if (!entry || entry.oi === 0) continue;
    farCount++;
    const chg = entry.prevOi !== undefined && entry.prevOi > 0
      ? (entry.oi - entry.prevOi) / entry.prevOi
      : (entry.oi > 0 ? 1 : 0); // new position = rising
    if (chg > 0.02) anyRising = true;
    if (chg < -0.02) anyFalling = true;
  }

  const nearFalling = nearestChg < -0.02;
  const nearRising = nearestChg > 0.02;

  // Premium direction: rising premiums mean longs, falling ones shorts (or, exiting, the side that is leaving)
  const pDir = priceDirection(oiByExpiry, expiries);

  if (farCount === 0) {
    if (nearFalling) return EXITING[pDir];
    if (nearRising) return FRESH_BUILD[pDir];
    return RolloverPattern.Stable;
  }

  if (nearFalling && anyRising) return ROLLING_OVER[pDir];
  if (nearFalling && !anyRising && anyFalling) return RolloverPattern.Unwinding;
  if (nearFalling && !anyRising) return EXITING[pDir];
  if (nearRising && anyRising) return DOUBLING_DOWN[pDir];
  if (!nearFalling && !nearRising && anyRising) return FRESH_BUILD[pDir];
  if (!nearFalling && !nearRising && anyFalling) return RolloverPattern.Unwinding;
  return RolloverPattern.Stable;
}

/** Rollover patterns that read bullish for the option (green), bearish (red), or a roll (accent). */
const GREEN_PATTERNS: RolloverPatternId[] = [
  RolloverPattern.FreshBuildLong, RolloverPattern.FreshBuildShort, RolloverPattern.FreshBuild,
  RolloverPattern.DoublingDownLong, RolloverPattern.DoublingDownShort, RolloverPattern.DoublingDown,
  RolloverPattern.LongBuildup, RolloverPattern.ShortCovering,
];
const RED_PATTERNS: RolloverPatternId[] = [
  RolloverPattern.ExitingLongUnwind, RolloverPattern.ExitingShortCover, RolloverPattern.Exiting,
  RolloverPattern.ShortBuildup, RolloverPattern.LongUnwinding, RolloverPattern.Unwinding,
];
const ROLL_PATTERNS: RolloverPatternId[] = [RolloverPattern.RollingOverLong, RolloverPattern.RollingOverShort, RolloverPattern.RollingOver];

export function patternColor(p: RolloverPatternId): string {
  if (ROLL_PATTERNS.includes(p)) return 'var(--accent)';
  if (RED_PATTERNS.includes(p)) return '#ef4444';
  if (GREEN_PATTERNS.includes(p)) return '#22c55e';
  return 'var(--text-secondary)';
}

/** Short expiry label, day first: '2026-07-07' → '7 Jul', with ' (M)' for a monthly expiry */
export function expiryLabel(expiry: string, isMonthly: boolean): string {
  return `${formatCalendarDate(expiry, { day: 'numeric', month: 'short' })}${isMonthly ? ' (M)' : ''}`;
}

/**
 * Build the set of monthly expiries from a list of expiry dates.
 * A monthly expiry is the last (latest) expiry within its calendar month.
 * This is data-driven and robust to exchange weekday changes (Thu → Tue, etc.).
 */
export function computeMonthlyExpiries(allExpiries: string[]): Set<string> {
  const lastPerMonth = new Map<string, string>();
  for (const exp of allExpiries) {
    const key = exp.slice(0, 7);
    const cur = lastPerMonth.get(key);
    if (!cur || exp > cur) lastPerMonth.set(key, exp);
  }
  return new Set(lastPerMonth.values());
}
