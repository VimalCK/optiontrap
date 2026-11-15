import type { StrikeBiasSummary, PriceTrendSummary, TradeSetupChecklistItem, TradeLevelContext, SellingSetupSummary, StrikeHistoryEntry, PremiumDecaySide, PremiumDecaySummary } from './types';
import { pctChange, formatPct } from './helpers';
import { formatNumericDate } from '@/utils/marketStatus';
import { OptionType, type OptionTypeId } from '../../../shared/tradeEnums.js';
import { HealthStatus } from '../../../shared/appEnums.js';
import { SellingSetup, Strength, TradeSetupStatus, Trend, type SellingSetupId, type TradeSetupStatusId } from '../../../shared/analysisEnums.js';

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
