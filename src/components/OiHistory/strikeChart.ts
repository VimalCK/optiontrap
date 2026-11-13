import type { OiHistoryRow, OiTableRow, StrikeHistoryEntry, TradeSetupData } from './types';
import {
  summarizeOptionMomentum, summarizePremiumDecay, summarizePriceTrend, summarizeSellingSetup, summarizeStrikeBias,
  summarizeTradeBias, summarizeTradeLevels, summarizeTradeSetup,
} from './analysis';
import type { FairValueResult } from '@/services/fairValue';
import { OptionType } from '../../../shared/tradeEnums.js';

export interface StrikeChartData extends TradeSetupData {
  dates: string[];
  dateMap: Map<string, Map<string, StrikeHistoryEntry>>;
  maxOi: number;
  maxCePrice: number;
  maxPePrice: number;
  /** False when the drawn expiry never had enough traded strikes to fit an IV curve. */
  hasFair: boolean;
}

const emptyEntry = (): StrikeHistoryEntry => ({ ceOi: 0, peOi: 0, ceClose: 0, peClose: 0, ceVolume: 0, peVolume: 0 });

/** The strike's CE and PE per date and expiry (with fair values where known), and the spot per date. */
function strikeHistory(rows: OiHistoryRow[], strike: number, expiries: string[], fairByDate: Map<string, FairValueResult>) {
  const dateMap = new Map<string, Map<string, StrikeHistoryEntry>>();
  const spotByDate = new Map<string, number>();
  const shown = new Set(expiries);
  for (const r of rows) {
    if (r.strike !== strike || !r.expiry || !shown.has(r.expiry)) continue;
    if (r.spotClose > 0) spotByDate.set(r.date, r.spotClose);
    let byExpiry = dateMap.get(r.date);
    if (!byExpiry) dateMap.set(r.date, (byExpiry = new Map()));
    let entry = byExpiry.get(r.expiry);
    if (!entry) byExpiry.set(r.expiry, (entry = emptyEntry()));
    const fair = fairByDate.get(r.date)?.byToken.get(r.instrumentToken);
    const reading = { oi: r.oi, close: r.close, volume: r.volume, fair: fair?.fairPrice ?? null, richPct: fair?.richPct ?? null, label: fair?.richness ?? null };
    if (r.optionType === OptionType.CE) {
      Object.assign(entry, { ceOi: reading.oi, ceClose: reading.close, ceVolume: reading.volume, ceFair: reading.fair, ceRichPct: reading.richPct, ceFairLabel: reading.label });
    } else {
      Object.assign(entry, { peOi: reading.oi, peClose: reading.close, peVolume: reading.volume, peFair: reading.fair, peRichPct: reading.richPct, peFairLabel: reading.label });
    }
  }
  return { dateMap, spotByDate };
}

/**
 * Everything the strike's history chart and trade setup show: its CE/PE series over the dates, the chart's scales
 * (prices over the drawn expiries only), and the setup analysis. Null when the strike has no history.
 */
export function buildStrikeChart(input: {
  rows: OiHistoryRow[];
  strike: number;
  dates: string[];
  expiries: string[];
  drawnExpiries: string[];
  fairByDate: Map<string, FairValueResult>;
  tableRows: OiTableRow[];
  spotClose: number | null;
}): StrikeChartData | null {
  const { rows, strike, expiries, fairByDate, tableRows, spotClose } = input;
  if (input.dates.length === 0 || expiries.length === 0) return null;

  const { dateMap, spotByDate } = strikeHistory(rows, strike, expiries, fairByDate);
  const dates = input.dates.filter((d) => dateMap.has(d));
  if (dates.length === 0) return null;

  const biasSummary = summarizeStrikeBias(dates, dateMap, expiries, spotByDate);
  const priceTrend = summarizePriceTrend(dates, spotByDate);
  const tradeBias = summarizeTradeBias(priceTrend, biasSummary);
  const tradeLevels = summarizeTradeLevels(tableRows, priceTrend.endPrice ?? spotClose, strike);
  const optionMomentum = summarizeOptionMomentum(dates, dateMap, expiries, priceTrend, tradeLevels);
  const premiumDecay = summarizePremiumDecay(dates, dateMap, expiries, priceTrend, tradeLevels);
  const tradeSetup = summarizeTradeSetup(priceTrend, biasSummary, strike, tradeLevels, optionMomentum);
  const sellingSetup = summarizeSellingSetup(priceTrend, biasSummary, strike, tradeLevels, premiumDecay);

  const drawn = new Set(input.drawnExpiries);
  let maxOi = 0;
  let maxCePrice = 0;
  let maxPePrice = 0;
  let hasFair = false;
  for (const byExpiry of dateMap.values()) {
    for (const [expiry, v] of byExpiry) {
      maxOi = Math.max(maxOi, v.ceOi, v.peOi);
      if (!drawn.has(expiry)) continue;
      maxCePrice = Math.max(maxCePrice, v.ceClose, v.ceFair ?? 0);
      maxPePrice = Math.max(maxPePrice, v.peClose, v.peFair ?? 0);
      if (v.ceFair != null || v.peFair != null) hasFair = true;
    }
  }

  return { dates, dateMap, maxOi, maxCePrice, maxPePrice, hasFair, biasSummary, priceTrend, tradeBias, tradeSetup, tradeLevels, optionMomentum, premiumDecay, sellingSetup };
}
