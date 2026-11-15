import type { StrikeBias, DailyBias, PriceTrendDirection, StrikeBiasDay, StrikeBiasSummary, PriceTrendSummary, TradeBiasSummary } from './types';
import { classifyOptionMove, patternBiasScore, pctChange, formatPct } from './helpers';
import { OptionType } from '../../../shared/tradeEnums.js';
import { Bias, Strength, Trend } from '../../../shared/analysisEnums.js';

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
