import type { RolloverPattern, StrikeBias, DailyBias, PriceTrendDirection, StrikeBiasDay, StrikeBiasSummary, PriceTrendSummary, TradeBiasSummary, TradeSetupStatus, ChecklistStatus, TradeSetupChecklistItem, TradeLevelRow, TradeLevelContext, TradeSetupSummary, SellingSetupType, SellingSetupSummary, StrikeHistoryEntry, PremiumDecaySide, PremiumDecaySummary, OptionMomentumSide, OptionMomentumSummary } from './types';
import { priceDirection, classifyOptionMove, patternBiasScore, pctChange, formatPct } from './helpers';

export function summarizePriceTrend(dates: string[], spotByDate: Map<string, number>): PriceTrendSummary {
  const values = dates
    .map((date) => ({ date, price: spotByDate.get(date) || 0 }))
    .filter((value) => value.price > 0);

  if (values.length < 2) {
    return {
      direction: 'Unknown',
      strength: 'Unknown',
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
    ? 'Unknown'
    : changePct > 0.5
      ? 'Upward'
      : changePct < -0.5
        ? 'Downward'
        : 'Sideways';
  const strength = direction === 'Unknown'
    ? 'Unknown'
    : direction === 'Sideways'
      ? 'Flat'
      : absChange >= 2
        ? 'Strong'
        : absChange >= 1
          ? 'Moderate'
          : 'Mild';
  const reason = direction === 'Upward'
    ? `Underlying moved higher from ${startPrice.toFixed(2)} to ${endPrice.toFixed(2)}.`
    : direction === 'Downward'
      ? `Underlying moved lower from ${startPrice.toFixed(2)} to ${endPrice.toFixed(2)}.`
      : direction === 'Sideways'
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
  const priceBullish = priceTrend.direction === 'Upward';
  const priceBearish = priceTrend.direction === 'Downward';
  const flowBullish = optionFlow.bias === 'Upward';
  const flowBearish = optionFlow.bias === 'Downward';

  if (priceBullish && flowBullish) {
    return {
      bias: 'Bullish',
      title: 'Bullish - Price and OI agree',
      action: 'Long bias. Prefer buy/hold on pullbacks while price holds trend.',
      reason: `Price trend is ${priceTrend.strength.toLowerCase()} upward and option flow is ${optionFlow.strength.toLowerCase()} upward.`,
    };
  }

  if (priceBearish && flowBearish) {
    return {
      bias: 'Bearish',
      title: 'Bearish - Price and OI agree',
      action: 'Short/avoid-long bias. Prefer confirmation on failed bounces.',
      reason: `Price trend is ${priceTrend.strength.toLowerCase()} downward and option flow is ${optionFlow.strength.toLowerCase()} downward.`,
    };
  }

  if ((priceBullish && flowBearish) || (priceBearish && flowBullish)) {
    return {
      bias: 'Conflict',
      title: 'Conflict - Price and OI disagree',
      action: 'Avoid blind directional entry. Wait for price confirmation or reversal failure.',
      reason: `Price is ${priceTrend.direction.toLowerCase()}, but option flow is ${optionFlow.bias.toLowerCase()}.`,
    };
  }

  if (priceBullish) {
    return {
      bias: 'Bullish',
      title: 'Bullish price trend, OI neutral',
      action: 'Cautious long bias. Size smaller until option flow confirms.',
      reason: `Price trend is ${priceTrend.strength.toLowerCase()} upward while option flow is neutral.`,
    };
  }

  if (priceBearish) {
    return {
      bias: 'Bearish',
      title: 'Bearish price trend, OI neutral',
      action: 'Cautious short/avoid-long bias until option flow confirms.',
      reason: `Price trend is ${priceTrend.strength.toLowerCase()} downward while option flow is neutral.`,
    };
  }

  return {
    bias: 'Neutral',
    title: 'Neutral - No clear trade edge',
    action: 'Wait. Price is not directional enough or option flow is mixed.',
    reason: `Price trend is ${priceTrend.direction.toLowerCase()} and option flow is ${optionFlow.bias.toLowerCase()}.`,
  };
}

export function checklistStatusText(status: ChecklistStatus): string {
  if (status === 'pass') return 'Yes';
  if (status === 'warn') return 'Wait';
  return 'No';
}

export function sortChecklistByStatus(items: TradeSetupChecklistItem[]): TradeSetupChecklistItem[] {
  const order: Record<ChecklistStatus, number> = { pass: 0, warn: 1, fail: 2 };
  return [...items].sort((a, b) => order[a.status] - order[b.status]);
}

export function readinessScore(items: TradeSetupChecklistItem[]): number {
  if (items.length === 0) return 0;
  const score = items.reduce((sum, item) => {
    if (item.status === 'pass') return sum + 1;
    if (item.status === 'warn') return sum + 0.5;
    return sum;
  }, 0);
  return Math.round((score / items.length) * 100);
}

export function setupReadinessLabel(status: TradeSetupStatus, score: number): string {
  if (status === 'Avoid') return 'No setup';
  return `${score}%`;
}

export function setupReadinessWidth(status: TradeSetupStatus, score: number): string {
  if (status === 'Avoid') return '0%';
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
      locationStatus: 'warn',
      riskRewardStatus: 'warn',
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
  const locationStatus: ChecklistStatus = absSelectedDistance <= 0.35 ? 'pass' : absSelectedDistance <= 0.8 ? 'warn' : 'fail';
  const supportDistance = support !== null ? Math.abs(distancePct(spot, support) ?? 999) : null;
  const resistanceDistance = resistance !== null ? Math.abs(distancePct(spot, resistance) ?? 999) : null;
  const hasNearbyBoundary = (supportDistance !== null && supportDistance <= 0.8) || (resistanceDistance !== null && resistanceDistance <= 0.8);
  const riskRewardStatus: ChecklistStatus = hasNearbyBoundary && absSelectedDistance <= 0.8 ? 'pass' : absSelectedDistance <= 1.2 ? 'warn' : 'fail';

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

  const buildSide = (optionType: 'CE' | 'PE'): OptionMomentumSide | null => {
    const close = (entry: StrikeHistoryEntry) => optionType === 'CE' ? entry.ceClose : entry.peClose;
    const oi = (entry: StrikeHistoryEntry) => optionType === 'CE' ? entry.ceOi : entry.peOi;
    const volume = (entry: StrikeHistoryEntry) => optionType === 'CE' ? entry.ceVolume : entry.peVolume;
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
    const adverseTrend = (optionType === 'CE' && priceTrend.direction === 'Downward') ||
      (optionType === 'PE' && priceTrend.direction === 'Upward');
    const adversePenalty = adverseTrend && priceTrend.strength === 'Strong' ? 3 : adverseTrend ? 1 : 0;
    const distanceScore = Math.abs(levels.selectedDistancePct ?? 999) <= 0.8 ? 1 : 0;
    const score = momentumScore + recentScore + oiScore + activityScore + distanceScore - adversePenalty;
    const reason = `${optionType} premium ${formatPct(momentumPct)} since ${first.date}` +
      `${recentMomentumPct !== null ? `, recent ${formatPct(recentMomentumPct)}` : ''}` +
      `${latestVolume > 0 ? `, volume ${latestVolume.toLocaleString('en-IN')}` : ''}.`;
    return { optionType, firstClose, latestClose, momentumPct, recentMomentumPct, oiChangePct, latestVolume, averageVolume, daysToExpiry, score, reason };
  };

  return { nearestExpiry, ce: buildSide('CE'), pe: buildSide('PE') };
}

export function summarizeTradeSetup(
  priceTrend: PriceTrendSummary,
  optionFlow: StrikeBiasSummary,
  selectedStrike: number,
  levels: TradeLevelContext,
  momentum: OptionMomentumSummary,
): TradeSetupSummary {
  const flowBullish = optionFlow.bias === 'Upward';
  const flowBearish = optionFlow.bias === 'Downward';
  const priceBullish = priceTrend.direction === 'Upward';
  const priceBearish = priceTrend.direction === 'Downward';
  const sideMomentumPass = (side: OptionMomentumSide | null) => Boolean(side && side.score >= 4 && side.momentumPct >= 5 &&
    (side.recentMomentumPct === null || side.recentMomentumPct >= 0));
  const sideMomentumWatch = (side: OptionMomentumSide | null) => Boolean(side && side.score >= 3 && side.momentumPct >= 3);
  const ceMomentumPass = sideMomentumPass(momentum.ce);
  const peMomentumPass = sideMomentumPass(momentum.pe);
  const cePriceSupport = priceTrend.direction !== 'Downward';
  const pePriceSupport = priceTrend.direction !== 'Upward';
  const expiryPassFor = (side: OptionMomentumSide | null) => side?.daysToExpiry === null || (side?.daysToExpiry !== undefined && side.daysToExpiry >= 3);
  const ceCandidate = Boolean(ceMomentumPass && cePriceSupport && expiryPassFor(momentum.ce) && levels.riskRewardStatus !== 'fail');
  const peCandidate = Boolean(peMomentumPass && pePriceSupport && expiryPassFor(momentum.pe) && levels.riskRewardStatus !== 'fail');
  const selectedSide = ceCandidate ? momentum.ce : peCandidate ? momentum.pe :
    (momentum.ce?.score ?? -Infinity) >= (momentum.pe?.score ?? -Infinity) ? momentum.ce : momentum.pe;
  const directionalFlow = ceCandidate || peCandidate || flowBullish || flowBearish;
  const direction = ceCandidate ? 'Bullish' : peCandidate ? 'Bearish' : flowBullish ? 'Bullish' : flowBearish ? 'Bearish' : 'Neutral';
  const priceAligned = ceCandidate ? priceBullish : peCandidate ? priceBearish : (flowBullish && priceBullish) || (flowBearish && priceBearish);
  const priceConflicts = ceCandidate ? priceBearish : peCandidate ? priceBullish : (flowBullish && priceBearish) || (flowBearish && priceBullish);
  const recentAligned = ceCandidate
    ? momentum.ce?.recentMomentumPct !== null && momentum.ce?.recentMomentumPct !== undefined && momentum.ce.recentMomentumPct >= 0
    : peCandidate
      ? momentum.pe?.recentMomentumPct !== null && momentum.pe?.recentMomentumPct !== undefined && momentum.pe.recentMomentumPct >= 0
      : (flowBullish && optionFlow.recentBias === 'Bullish') || (flowBearish && optionFlow.recentBias === 'Bearish');
  const recentConflicts = ceCandidate
    ? Boolean(momentum.ce?.recentMomentumPct !== null && momentum.ce?.recentMomentumPct !== undefined && momentum.ce.recentMomentumPct < 0)
    : peCandidate
      ? Boolean(momentum.pe?.recentMomentumPct !== null && momentum.pe?.recentMomentumPct !== undefined && momentum.pe.recentMomentumPct < 0)
      : (flowBullish && optionFlow.recentBias === 'Bearish') || (flowBearish && optionFlow.recentBias === 'Bullish');
  const momentumSide = selectedSide;
  const momentumAvailable = Boolean(momentumSide);
  const momentumPass = ceCandidate || peCandidate || sideMomentumPass(momentumSide);
  const momentumWatch = sideMomentumWatch(momentumSide);
  const volumePass = Boolean(momentumSide && momentumSide.latestVolume > 0 && momentumSide.averageVolume > 0 && momentumSide.latestVolume >= momentumSide.averageVolume * 0.6);
  const oiPass = Boolean(momentumSide && momentumSide.oiChangePct !== null && momentumSide.oiChangePct >= 0);
  const expiryPass = expiryPassFor(momentumSide);
  const confidenceStatus: ChecklistStatus = optionFlow.confidence >= 65 ? 'pass' : optionFlow.confidence >= 55 ? 'warn' : 'fail';
  const priceStatus: ChecklistStatus = priceAligned ? 'pass' : priceConflicts ? 'fail' : 'warn';
  const recentStatus: ChecklistStatus = recentAligned ? 'pass' : recentConflicts ? 'fail' : 'warn';
  const flowStatus: ChecklistStatus = directionalFlow ? 'pass' : 'fail';
  const ready = (ceCandidate || peCandidate) && priceAligned && momentumPass && !recentConflicts && levels.locationStatus !== 'fail' && expiryPass;
  const watch = directionalFlow && !ready && !priceConflicts && momentumWatch && levels.locationStatus !== 'fail';
  const status: TradeSetupStatus = ready ? 'Confirmed' : watch ? 'Watch' : 'Avoid';
  const strikeLabel = selectedStrike.toFixed(0);
  const sideLabel = direction === 'Bullish' ? 'upside' : direction === 'Bearish' ? 'downside' : 'range';
  const oppositeLabel = direction === 'Bullish' ? 'below' : direction === 'Bearish' ? 'above' : 'outside';

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
      status: momentumPass ? 'pass' : momentumWatch ? 'warn' : 'fail',
      answer: momentumSide
        ? `${momentumSide.optionType} ${formatPct(momentumSide.momentumPct)} overall${momentumSide.recentMomentumPct !== null ? `, ${formatPct(momentumSide.recentMomentumPct)} recent` : ''}`
        : 'No nearest-expiry momentum evidence',
    },
    {
      label: 'Volume confirms',
      status: volumePass ? 'pass' : momentumAvailable ? 'warn' : 'fail',
      answer: momentumSide && momentumSide.latestVolume > 0
        ? `Latest volume ${momentumSide.latestVolume.toLocaleString('en-IN')} vs average ${Math.round(momentumSide.averageVolume).toLocaleString('en-IN')}`
        : 'Volume is unavailable or too thin',
    },
    {
      label: 'OI confirms',
      status: oiPass ? 'pass' : momentumAvailable ? 'warn' : 'fail',
      answer: momentumSide?.oiChangePct !== null && momentumSide?.oiChangePct !== undefined
        ? `OI ${formatPct(momentumSide.oiChangePct)} across the nearest-expiry history`
        : 'OI change is unavailable',
    },
    {
      label: 'Expiry risk',
      status: expiryPass ? 'pass' : 'fail',
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

  if (status === 'Confirmed') {
    return {
      status,
      direction,
      title: `${direction} setup confirmed`,
      action: `Option buying ${sideLabel} trade is allowed: nearest-expiry ${momentumSide?.reason ?? 'premium momentum is confirmed'}`,
      strategy: direction === 'Bullish' ? 'Prefer call debit spread or long futures on pullback.' : 'Prefer put debit spread or short futures on failed bounce.',
      trigger: direction === 'Bullish' ? `Enter only above/holding ${strikeLabel}; stronger if price clears CE wall ${levels.resistanceStrike ?? '-'}.` : `Enter only below/rejecting ${strikeLabel}; stronger if PE support ${levels.supportStrike ?? '-'} weakens.`,
      invalidation: `Exit if price closes back ${oppositeLabel} ${strikeLabel}; also respect VWAP/previous-day levels if live chart provides them.`,
      target: direction === 'Bullish' ? `Book near next resistance/max-OI zone ${levels.resistanceStrike ?? levels.maxOiStrike ?? '-'}.` : `Book near next support/max-OI zone ${levels.supportStrike ?? levels.maxOiStrike ?? '-'}.`,
      sizing: 'Normal risk only. Keep max loss predefined before entry.',
      checklist,
    };
  }

  if (status === 'Watch') {
    return {
      status,
      direction,
      title: `${direction} watchlist, not entry yet`,
      action: `Directional bias exists, but nearest-expiry premium momentum is not fully confirmed. Wait for continuation.`,
      strategy: direction === 'Bullish' ? 'Wait for breakout/hold before call spread.' : 'Wait for breakdown/rejection before put spread.',
      trigger: direction === 'Bullish' ? `Need price acceptance above ${strikeLabel}, VWAP, or CE resistance ${levels.resistanceStrike ?? '-'}.` : `Need price acceptance below ${strikeLabel}, VWAP, or failed bounce from CE resistance ${levels.resistanceStrike ?? '-'}.`,
      invalidation: 'No trade until invalidation is close and obvious.',
      target: `Plan target around support/resistance/max-OI zones: ${levels.supportStrike ?? '-'} / ${levels.resistanceStrike ?? '-'} / ${levels.maxOiStrike ?? '-'}.`,
      sizing: 'Half size or no trade until confirmation improves.',
      checklist,
    };
  }

  return {
    status,
    direction: 'Neutral',
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

  const buildSide = (optionType: 'CE' | 'PE'): PremiumDecaySide | null => {
    const close = (entry: StrikeHistoryEntry) => optionType === 'CE' ? entry.ceClose : entry.peClose;
    const oi = (entry: StrikeHistoryEntry) => optionType === 'CE' ? entry.ceOi : entry.peOi;
    const volume = (entry: StrikeHistoryEntry) => optionType === 'CE' ? entry.ceVolume : entry.peVolume;
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
    const adverseTrend = (optionType === 'CE' && priceTrend.direction === 'Upward') ||
      (optionType === 'PE' && priceTrend.direction === 'Downward');
    const adversePenalty = adverseTrend && priceTrend.strength === 'Strong' ? 3 : adverseTrend ? 1 : 0;
    const distancePctFromSpot = Math.abs(levels.selectedDistancePct ?? 999);
    const distanceStrength = distancePctFromSpot <= 2.5 ? 1 : 0;
    const score = decayStrength + recentDecayStrength + timeStrength + activityStrength + oiStrength + distanceStrength - adversePenalty;
    const reason = `${optionType} premium ${formatPct(decayPct)} since ${first.date}` +
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

  return { nearestExpiry, ce: buildSide('CE'), pe: buildSide('PE') };
}

export function summarizeSellingSetup(
  priceTrend: PriceTrendSummary,
  optionFlow: StrikeBiasSummary,
  selectedStrike: number,
  levels: TradeLevelContext,
  decay: PremiumDecaySummary,
): SellingSetupSummary {
  const flowBearish = optionFlow.bias === 'Downward';
  const flowBullish = optionFlow.bias === 'Upward';
  const priceBearish = priceTrend.direction === 'Downward';
  const priceBullish = priceTrend.direction === 'Upward';
  const priceSideways = priceTrend.direction === 'Sideways';
  const hasResistance = levels.resistanceStrike !== null;
  const hasSupport = levels.supportStrike !== null;
  const confidenceOk = optionFlow.confidence >= 55;
  const locationOk = levels.locationStatus !== 'fail';
  const callSellCandidate = flowBearish && !priceBullish && hasResistance && confidenceOk;
  const putSellCandidate = flowBullish && !priceBearish && hasSupport && confidenceOk;
  const rangeSellCandidate = priceSideways && hasSupport && hasResistance && optionFlow.confidence >= 50;
  const decaySide = [decay.ce, decay.pe]
    .filter((side): side is PremiumDecaySide => side !== null)
    .sort((a, b) => b.score - a.score || a.decayPct - b.decayPct)[0];
  const decayCandidate = decaySide && decaySide.score >= 4 && decaySide.decayPct <= -6 &&
    (decaySide.daysToExpiry === null || decaySide.daysToExpiry <= 21);
  const type: SellingSetupType = callSellCandidate
    ? 'Call Sell'
    : putSellCandidate
      ? 'Put Sell'
      : decayCandidate
        ? decaySide.optionType === 'CE' ? 'Call Sell' : 'Put Sell'
      : rangeSellCandidate
        ? 'Range Sell'
        : 'No Sell';
  const decayConfirmed = Boolean(decayCandidate && locationOk && (decaySide!.score >= 5 || levels.riskRewardStatus !== 'fail'));
  const decayWatch = Boolean(decayCandidate && !decayConfirmed);
  const status: TradeSetupStatus = ((callSellCandidate || putSellCandidate) && locationOk && levels.riskRewardStatus !== 'fail') || decayConfirmed
    ? 'Confirmed'
    : type !== 'No Sell' || decayWatch
      ? 'Watch'
      : 'Avoid';
  const strikeLabel = selectedStrike.toFixed(0);
  const checklist: TradeSetupChecklistItem[] = [
    {
      label: 'Selling bias',
      status: type !== 'No Sell' ? 'pass' : 'fail',
      answer: decayCandidate
        ? `${decaySide!.optionType} premium-decay setup: ${decaySide!.reason}`
        : type === 'Call Sell'
        ? 'Bearish/sideways bias supports call selling'
        : type === 'Put Sell'
          ? 'Bullish/sideways bias supports put selling'
          : type === 'Range Sell'
            ? 'Sideways action supports defined range selling'
            : 'No premium-selling edge detected',
    },
    {
      label: 'OI wall / decay',
      status: decayCandidate
        ? (decaySide!.latestOi > 0 ? 'pass' : 'warn')
        : type === 'Call Sell' ? (hasResistance ? 'pass' : 'fail') : type === 'Put Sell' ? (hasSupport ? 'pass' : 'fail') : hasSupport && hasResistance ? 'pass' : 'warn',
      answer: `Support ${levels.supportStrike ?? '-'}, resistance ${levels.resistanceStrike ?? '-'}`,
    },
    {
      label: 'Trend risk',
      status: (type === 'Call Sell' && priceBullish) || (type === 'Put Sell' && priceBearish) ? 'fail' : priceSideways ? 'pass' : 'warn',
      answer: `Price trend is ${priceTrend.direction.toLowerCase()}`,
    },
    {
      label: 'Premium decay',
      status: decayCandidate ? (decayConfirmed ? 'pass' : 'warn') : 'fail',
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
      status: type !== 'No Sell' ? 'warn' : 'fail',
      answer: type === 'No Sell' ? 'No selling structure suggested' : 'Prefer credit spread, not naked short option',
    },
  ];

  if (type === 'Call Sell') {
    const decaySell = decayCandidate && decaySide!.optionType === 'CE';
    return {
      status,
      type,
      title: decaySell
        ? (status === 'Confirmed' ? 'Call decay sell candidate' : 'Call decay sell watch')
        : (status === 'Confirmed' ? 'Call sell candidate' : 'Call sell watch'),
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
      sizing: status === 'Confirmed' ? 'Defined-risk small/normal size; expiry decay has gap risk.' : 'Small size or wait for rejection candle.',
      checklist,
    };
  }

  if (type === 'Put Sell') {
    const decaySell = decayCandidate && decaySide!.optionType === 'PE';
    return {
      status,
      type,
      title: decaySell
        ? (status === 'Confirmed' ? 'Put decay sell candidate' : 'Put decay sell watch')
        : (status === 'Confirmed' ? 'Put sell candidate' : 'Put sell watch'),
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
      sizing: status === 'Confirmed' ? 'Defined-risk small/normal size; expiry decay has gap risk.' : 'Small size or wait for support hold.',
      checklist,
    };
  }

  if (type === 'Range Sell') {
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
    const dayScore = patternBiasScore(cePattern, 'CE') + patternBiasScore(pePattern, 'PE');
    score += dayScore;

    const dayBias: DailyBias = dayScore > 0 ? 'Bullish' : dayScore < 0 ? 'Bearish' : 'Neutral';
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
  const bias: StrikeBias = score > 1 ? 'Upward' : score < -1 ? 'Downward' : 'Neutral';
  const absScore = Math.abs(score);
  const strength = bias === 'Neutral'
    ? decisiveDays > 0 ? 'Mixed' : 'Mild'
    : absScore >= 8 ? 'Strong' : absScore >= 4 ? 'Moderate' : 'Mild';
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
  const recentBias: DailyBias = recentScore > 1 ? 'Bullish' : recentScore < -1 ? 'Bearish' : 'Neutral';
  const driver = ceOiChangePct !== null && peOiChangePct !== null
    ? Math.abs(peOiChangePct) > Math.abs(ceOiChangePct)
      ? `PE OI moved more than CE OI (${formatPct(peOiChangePct)} vs ${formatPct(ceOiChangePct)}).`
      : Math.abs(ceOiChangePct) > Math.abs(peOiChangePct)
        ? `CE OI moved more than PE OI (${formatPct(ceOiChangePct)} vs ${formatPct(peOiChangePct)}).`
        : 'CE and PE OI changed at a similar pace.'
    : 'OI change driver is limited because start OI is missing.';
  const warning = bias === 'Upward' && recentBias === 'Bearish'
    ? 'Overall bias is upward, but recent sessions show bearish pressure.'
    : bias === 'Downward' && recentBias === 'Bullish'
      ? 'Overall bias is downward, but recent sessions show bullish recovery.'
      : bias === 'Neutral' && recentBias !== 'Neutral'
        ? `Overall bias is neutral, but recent sessions lean ${recentBias.toLowerCase()}.`
        : null;
  const pcrDirection = pcrStart !== null && pcrEnd !== null
    ? pcrEnd > pcrStart ? 'rising strike PCR' : pcrEnd < pcrStart ? 'falling strike PCR' : 'flat strike PCR'
    : 'limited PCR data';
  const reason = bias === 'Upward'
    ? `Bullish days lead bearish days with ${pcrDirection}.`
    : bias === 'Downward'
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

/** Classify rollover pattern for a strike+optionType across expiries */
export function classifyPattern(
  oiByExpiry: Map<string, { oi: number; prevOi: number | undefined; close: number; prevClose: number | undefined }>,
  expiries: string[],
): RolloverPattern {
  // Single expiry (monthly scrips like BANKNIFTY): use OI + Price signal
  if (expiries.length < 2) {
    // Find the expiry with data
    let entry: { oi: number; prevOi: number | undefined; close: number; prevClose: number | undefined } | undefined;
    for (const exp of expiries) {
      if (oiByExpiry.has(exp)) { entry = oiByExpiry.get(exp); break; }
    }
    if (!entry) return '-';
    return classifyOptionMove(entry.oi, entry.prevOi, entry.close, entry.prevClose);
  }

  // Find the nearest expiry with data
  let nearestIdx = -1;
  for (let i = 0; i < expiries.length; i++) {
    if (oiByExpiry.has(expiries[i])) { nearestIdx = i; break; }
  }
  if (nearestIdx < 0) return '-';

  const nearest = oiByExpiry.get(expiries[nearestIdx])!;
  const nearestChg = nearest.prevOi !== undefined && nearest.prevOi > 0
    ? (nearest.oi - nearest.prevOi) / nearest.prevOi
    : 0;

  // Check further expiries
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

  // Get price direction for context
  const pDir = priceDirection(oiByExpiry, expiries);
  const longSuffix = pDir === 'up' ? ' (Long)' : pDir === 'down' ? ' (Short)' : '';
  const exitSuffix = pDir === 'down' ? ' (Long Unwind)' : pDir === 'up' ? ' (Short Cover)' : '';

  // No data on further expiries
  if (farCount === 0) {
    if (nearFalling) return `Exiting${exitSuffix}` as RolloverPattern;
    if (nearRising) return `Fresh Build${longSuffix}` as RolloverPattern;
    return 'Stable';
  }

  // Classification logic
  if (nearFalling && anyRising) return `Rolling Over${longSuffix}` as RolloverPattern;
  if (nearFalling && !anyRising && anyFalling) return 'Unwinding';
  if (nearFalling && !anyRising) return `Exiting${exitSuffix}` as RolloverPattern;
  if (nearRising && anyRising) return `Doubling Down${longSuffix}` as RolloverPattern;
  if (!nearFalling && !nearRising && anyRising) return `Fresh Build${longSuffix}` as RolloverPattern;
  if (!nearFalling && !nearRising && anyFalling) return 'Unwinding';
  return 'Stable';
}

/** Color for pattern label */
export function patternColor(p: RolloverPattern): string {
  if (p.startsWith('Rolling Over')) return 'var(--accent)';
  if (p.startsWith('Exiting')) return '#ef4444';
  if (p.startsWith('Fresh Build')) return '#22c55e';
  if (p.startsWith('Doubling Down')) return '#22c55e';
  if (p === 'Long Buildup') return '#22c55e';
  if (p === 'Short Buildup') return '#ef4444';
  if (p === 'Long Unwinding') return '#ef4444';
  if (p === 'Short Covering') return '#22c55e';
  if (p === 'Unwinding') return '#ef4444';
  if (p === 'Stable') return 'var(--text-secondary)';
  return 'var(--text-secondary)';
}

/** Short expiry label: '2026-07-07' → 'Jul 7' with (W) or (M) suffix */
export function expiryLabel(expiry: string, isMonthly: boolean): string {
  const d = new Date(expiry + 'T00:00:00');
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = d.getDate();
  return `${month} ${day}${isMonthly ? ' (M)' : ''}`;
}

/**
 * Build the set of monthly expiries from a list of expiry dates.
 * A monthly expiry is the last (latest) expiry within its calendar month.
 * This is data-driven and robust to exchange weekday changes (Thu → Tue, etc.).
 */
export function computeMonthlyExpiries(allExpiries: string[]): Set<string> {
  const lastPerMonth = new Map<string, string>();
  for (const exp of allExpiries) {
    const key = exp.slice(0, 7); // YYYY-MM
    const cur = lastPerMonth.get(key);
    if (!cur || exp > cur) lastPerMonth.set(key, exp);
  }
  return new Set(lastPerMonth.values());
}
