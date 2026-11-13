import type { OiCellData, OiHistoryRow, OiTableRow, SignalPerformanceSummary, TradeSignalRow } from './types';
import type { StrikeChartData } from './strikeChart';
import type { FlowReading } from '@/services/oiFlow';
import type { FairValueResult } from '@/services/fairValue';
import { OptionType, Side, type OptionTypeId, type SideId } from '../../../shared/tradeEnums.js';
import { Bias, OiFlow, RolloverPattern, SellingSetup, TradeSetupStatus, type TradeSetupStatusId } from '../../../shared/analysisEnums.js';
import { SignalOutcome } from '../../../shared/appEnums.js';

/** The trade a setup calls for: a sell when the selling setup is live, else a buy when the buying setup is. */
export function setupTrade(chart: Pick<StrikeChartData, 'sellingSetup' | 'tradeSetup'>): { action: SideId; optionType: OptionTypeId; status: TradeSetupStatusId } | null {
  const selling = chart.sellingSetup;
  const buying = chart.tradeSetup;
  if ((selling.type === SellingSetup.CallSell || selling.type === SellingSetup.PutSell) && selling.status !== TradeSetupStatus.Avoid) {
    return { action: Side.SELL, optionType: selling.type === SellingSetup.CallSell ? OptionType.CE : OptionType.PE, status: selling.status };
  }
  if ((buying.direction === Bias.Bullish || buying.direction === Bias.Bearish) && buying.status !== TradeSetupStatus.Avoid) {
    return { action: Side.BUY, optionType: buying.direction === Bias.Bullish ? OptionType.CE : OptionType.PE, status: buying.status };
  }
  return null;
}

/** The strike nearest the spot on a date (the first row's spot), or null without a spot. */
export function atmStrikeOn(rows: OiHistoryRow[], date: string): number | null {
  const dayRows = rows.filter((row) => row.date === date && row.strike);
  const spot = dayRows[0]?.spotClose;
  if (!spot) return null;
  return dayRows.reduce<number | null>((best, row) => (
    best === null || Math.abs(row.strike! - spot) < Math.abs(best - spot) ? row.strike! : best
  ), null);
}

export interface SignalToLog {
  /** One signal per scrip, date, expiry, strike, option type and action. */
  key: string;
  body: Record<string, unknown>;
}

/**
 * The setup signal to record for the strike's latest date, or null when there is none to record: no live setup,
 * the strike isn't that day's ATM (one signal per scrip per day), or the nearest expiry has no premium that day.
 * The OI pattern, IV flow and fair value describe the signal only when the table shows its date.
 */
export function signalToLog(input: {
  scrip: string;
  strike: number;
  chart: StrikeChartData;
  rows: OiHistoryRow[];
  tableDate: string;
  tableRows: OiTableRow[];
  flowByToken: Map<number, FlowReading>;
  fairToday: FairValueResult;
}): SignalToLog | null {
  const { scrip, strike, chart, rows, tableDate, tableRows, flowByToken, fairToday } = input;
  const trade = setupTrade(chart);
  if (!trade || chart.dates.length === 0) return null;
  const { action, optionType } = trade;

  const signalDate = chart.dates[chart.dates.length - 1];
  if (strike !== atmStrikeOn(rows, signalDate)) return null;

  // The expiry comes from the selected date's table. When viewing an older date it can be a contract that has expired
  // by the signal date, so take the entry premium from the signal date itself and skip if it has none.
  const expiry = chart.premiumDecay.nearestExpiry;
  const signalDayEntry = expiry ? chart.dateMap.get(signalDate)?.get(expiry) : undefined;
  const entryPremium = signalDayEntry ? (optionType === OptionType.CE ? signalDayEntry.ceClose : signalDayEntry.peClose) : 0;
  if (!expiry || expiry < signalDate || !(entryPremium > 0)) return null;

  const isCall = optionType === OptionType.CE;
  const strikeRow = tableDate === signalDate ? tableRows.find((row) => row.strike === strike) : undefined;
  const strikePattern = strikeRow ? (isCall ? strikeRow.cePattern : strikeRow.pePattern) : null;
  const strikeCell = strikeRow?.cells.get(expiry);
  const flowToken = strikeCell ? (isCall ? strikeCell.ceToken : strikeCell.peToken) : undefined;
  const ivFlow = flowToken !== undefined ? flowByToken.get(flowToken)?.flow : undefined;
  const fair = flowToken !== undefined ? fairToday.byToken.get(flowToken) : undefined;
  const decay = isCall ? chart.premiumDecay.ce : chart.premiumDecay.pe;

  return {
    key: `${scrip}|${signalDate}|${expiry}|${strike}|${optionType}|${action}`,
    body: {
      scrip,
      signalDate,
      expiry,
      strike,
      optionType,
      action,
      status: trade.status,
      entryPremium,
      spotPrice: chart.priceTrend.endPrice ?? null,
      details: {
        priceTrend: chart.priceTrend,
        sellingType: chart.sellingSetup.type,
        sellingStatus: chart.sellingSetup.status,
        buyingDirection: chart.tradeSetup.direction,
        buyingStatus: chart.tradeSetup.status,
        buyingMomentum: isCall ? chart.optionMomentum.ce : chart.optionMomentum.pe,
        decay: decay ? { decayPct: decay.decayPct, score: decay.score, daysToExpiry: decay.daysToExpiry, latestVolume: decay.latestVolume } : null,
        flowBias: chart.biasSummary.bias,
        ...(strikePattern && strikePattern !== RolloverPattern.None ? { strikePattern } : {}),
        ...(ivFlow && ivFlow !== OiFlow.None ? { ivFlow } : {}),
        ...(fair?.richness ? { fairValue: fair.richness, fairRichPct: fair.richPct !== null ? Math.round(fair.richPct * 1000) / 10 : null } : {}),
      },
    },
  };
}

const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const winRate = (wins: number, count: number) => (count ? (wins / count) * 100 : null);

/** How the logged signals did: open ones' running return, and scored ones' win rate, returns, excursions and profit factor. */
export function summarizeSignalPerformance(signals: TradeSignalRow[]): SignalPerformanceSummary {
  const open = signals.filter((s) => s.outcome_status === SignalOutcome.Open || s.outcome_status === null);
  const openReturns = open
    .map((s) => s.outcome_return)
    .filter((value): value is number => value !== null && Number.isFinite(Number(value)))
    .map(Number);
  const evaluated = signals.filter((s) => s.outcome_status === SignalOutcome.Profit || s.outcome_status === SignalOutcome.Loss);
  const isWin = (s: TradeSignalRow) => s.outcome_status === SignalOutcome.Profit;
  const wins = evaluated.filter(isWin).length;
  const returns = evaluated.map((s) => Number(s.outcome_return || 0));
  const winningReturns = returns.filter((value) => value > 0);
  const losingReturns = returns.filter((value) => value < 0);
  const grossProfit = winningReturns.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losingReturns.reduce((sum, value) => sum + value, 0));
  const byAction = (action: SideId) => {
    const rows = evaluated.filter((s) => s.action === action);
    return { count: rows.length, wins: rows.filter(isWin).length };
  };
  const sells = byAction(Side.SELL);
  const buys = byAction(Side.BUY);

  return {
    total: signals.length,
    open: open.length,
    averageOpenReturn: mean(openReturns),
    evaluated: evaluated.length,
    wins,
    winRate: winRate(wins, evaluated.length),
    averageReturn: mean(returns),
    averageMaxFavorable: mean(evaluated.filter((s) => s.max_favorable_return !== null).map((s) => Number(s.max_favorable_return))),
    averageMaxAdverse: mean(evaluated.filter((s) => s.max_adverse_return !== null).map((s) => Number(s.max_adverse_return))),
    averageWin: winningReturns.length ? grossProfit / winningReturns.length : null,
    averageLoss: losingReturns.length ? -grossLoss / losingReturns.length : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : null),
    sellEvaluated: sells.count,
    sellWinRate: winRate(sells.wins, sells.count),
    buyEvaluated: buys.count,
    buyWinRate: winRate(buys.wins, buys.count),
  };
}

export type SetupOrder =
  | { ok: true; cell: OiCellData; optionType: OptionTypeId; strike: number; expiry: string }
  | { ok: false; message: string };

/**
 * The option a setup's Buy / Sell button trades. A buy takes CE when bullish, PE when bearish; a sell CE for a call
 * sell, PE for a put sell. The strike is the setup's key level (resistance for CE, support for PE), falling back to
 * the ATM, then the max-OI strike; the expiry is the first shown that has a priced option there.
 */
export function setupOrder(
  side: SideId,
  chart: Pick<StrikeChartData, 'tradeSetup' | 'sellingSetup' | 'tradeLevels'>,
  atmStrike: number | null,
  tableRows: OiTableRow[],
  expiries: string[],
): SetupOrder {
  const { tradeSetup, sellingSetup, tradeLevels } = chart;
  let optionType: OptionTypeId | null = null;
  if (side === Side.BUY) {
    if (tradeSetup.direction === Bias.Bullish) optionType = OptionType.CE;
    else if (tradeSetup.direction === Bias.Bearish) optionType = OptionType.PE;
  } else if (sellingSetup.type === SellingSetup.CallSell) optionType = OptionType.CE;
  else if (sellingSetup.type === SellingSetup.PutSell) optionType = OptionType.PE;
  if (!optionType) return { ok: false, message: 'No single-leg strike for this setup' };

  const keyLevel = optionType === OptionType.CE ? tradeLevels.resistanceStrike : tradeLevels.supportStrike;
  const strike = keyLevel ?? atmStrike ?? tradeLevels.maxOiStrike;
  if (!strike) return { ok: false, message: 'No tradeable strike found' };

  const row = tableRows.find((r) => r.strike === strike);
  if (!row) return { ok: false, message: `Strike ${strike} not in table` };

  for (const expiry of expiries) {
    const cell = row.cells.get(expiry);
    if (!cell) continue;
    const token = optionType === OptionType.CE ? cell.ceToken : cell.peToken;
    const price = optionType === OptionType.CE ? cell.ceClose : cell.peClose;
    if (token && price) return { ok: true, cell, optionType, strike, expiry };
  }
  return { ok: false, message: `No ${optionType} data at strike ${strike}` };
}
