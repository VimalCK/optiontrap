import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import AppSelect from '@/components/AppSelect/AppSelect';
import { addPosition } from '@/services/positions';
import { getLotSize } from '@/services/optionChain';
import '@/styles/oihistory.css';

interface OiHistoryRow {
  date: string;
  instrumentToken: number;
  tradingsymbol: string;
  strike: number | null;
  optionType: string | null;
  expiry: string | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
  spotClose: number;
}

interface FetchProgress {
  step: string;
  pct: number;
  detail: string;
}

type RolloverPattern =
  | 'Rolling Over (Long)'
  | 'Rolling Over (Short)'
  | 'Rolling Over'
  | 'Exiting (Long Unwind)'
  | 'Exiting (Short Cover)'
  | 'Exiting'
  | 'Fresh Build (Long)'
  | 'Fresh Build (Short)'
  | 'Fresh Build'
  | 'Doubling Down (Long)'
  | 'Doubling Down (Short)'
  | 'Doubling Down'
  | 'Long Buildup'
  | 'Short Buildup'
  | 'Long Unwinding'
  | 'Short Covering'
  | 'Unwinding'
  | 'Stable'
  | '-';

type StrikeBias = 'Upward' | 'Downward' | 'Neutral';

type DailyBias = 'Bullish' | 'Bearish' | 'Neutral';

type PriceTrendDirection = 'Upward' | 'Downward' | 'Sideways' | 'Unknown';

type TradeBias = 'Bullish' | 'Bearish' | 'Conflict' | 'Neutral';

interface StrikeBiasDay {
  date: string;
  cePattern: RolloverPattern;
  pePattern: RolloverPattern;
  bias: DailyBias;
  score: number;
  cumulativeScore: number;
}

interface StrikeBiasSummary {
  bias: StrikeBias;
  strength: 'Strong' | 'Moderate' | 'Mild' | 'Mixed';
  confidence: number;
  score: number;
  bullishDays: number;
  bearishDays: number;
  neutralDays: number;
  totalDays: number;
  ceOiChangePct: number | null;
  peOiChangePct: number | null;
  pcrStart: number | null;
  pcrEnd: number | null;
  spotChangePct: number | null;
  recentBias: DailyBias;
  recentScore: number;
  recentDays: StrikeBiasDay[];
  driver: string;
  warning: string | null;
  reason: string;
}

interface PriceTrendSummary {
  direction: PriceTrendDirection;
  strength: 'Strong' | 'Moderate' | 'Mild' | 'Flat' | 'Unknown';
  startPrice: number | null;
  endPrice: number | null;
  changePct: number | null;
  recentChangePct: number | null;
  sessions: number;
  reason: string;
}

interface TradeBiasSummary {
  bias: TradeBias;
  title: string;
  action: string;
  reason: string;
}

type TradeSetupStatus = 'Confirmed' | 'Watch' | 'Avoid';

type ChecklistStatus = 'pass' | 'warn' | 'fail';

interface TradeSetupChecklistItem {
  label: string;
  status: ChecklistStatus;
  answer: string;
}

interface TradeLevelRow {
  strike: number;
  ceConsolidatedOi: number;
  peConsolidatedOi: number;
}

interface TradeLevelContext {
  spot: number | null;
  supportStrike: number | null;
  resistanceStrike: number | null;
  maxOiStrike: number | null;
  selectedDistancePct: number | null;
  locationStatus: ChecklistStatus;
  riskRewardStatus: ChecklistStatus;
  locationAnswer: string;
  riskRewardAnswer: string;
}

interface TradeSetupSummary {
  status: TradeSetupStatus;
  direction: 'Bullish' | 'Bearish' | 'Neutral';
  title: string;
  action: string;
  strategy: string;
  trigger: string;
  invalidation: string;
  target: string;
  sizing: string;
  checklist: TradeSetupChecklistItem[];
}

/** Default scrip options shown before dynamic list loads */
const DEFAULT_SCRIP_OPTIONS = [
  { value: 'NIFTY50', label: 'NIFTY 50' },
  { value: 'BANKNIFTY', label: 'BANK NIFTY' },
];

const RECENT_SCRIPS_KEY = 'optiontrap_oi_history_recent_scrips';
const MAX_RECENT_SCRIPS = 5;

function loadRecentScrips(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SCRIPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string' && value.length > 0).slice(0, MAX_RECENT_SCRIPS)
      : [];
  } catch {
    return [];
  }
}

function saveRecentScrips(scrips: string[]): void {
  localStorage.setItem(RECENT_SCRIPS_KEY, JSON.stringify(scrips.slice(0, MAX_RECENT_SCRIPS)));
}

/** Compact OI display: 11,400,000 → 11.4M, 850,000 → 850K */
function formatOiCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

/** Format OI with change: "1.9M (+37%)" */
function formatOiWithChg(oi: number, prev: number | undefined): { text: string; chgCls: string } {
  if (oi === 0) return { text: '-', chgCls: '' };
  const oiStr = formatOiCompact(oi);
  if (prev === undefined || prev === 0) return { text: oiStr, chgCls: '' };
  const chg = oi - prev;
  const pct = Math.round((chg / prev) * 100);
  const sign = chg > 0 ? '+' : '';
  return {
    text: `${oiStr} (${sign}${pct}%)`,
    chgCls: chg > 0 ? 'oi-history__cell--up' : chg < 0 ? 'oi-history__cell--down' : '',
  };
}

/** Get current month in YYYY-MM (IST) */
function currentMonthIST(): string {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Get today's date in YYYY-MM-DD (IST) */
function todayIST(): string {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, '0');
  const d = String(ist.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Format a month string (YYYY-MM) to label (e.g., "July 2026") */
function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Format a month string (YYYY-MM) to short label (e.g., "Jul '26") */
function formatMonthShortLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const mon = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' });
  return `${mon} '${String(y).slice(2)}`;
}

/** Format a full date (YYYY-MM-DD) to label (e.g., "Mon, Jul 1") */
function formatFullDateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Determine price direction: 'up' if price rose, 'down' if fell, null if unknown */
function priceDirection(
  data: Map<string, { close: number; prevClose: number | undefined }>,
  expiries: string[],
): 'up' | 'down' | null {
  // Use weighted average price change across expiries with data
  let totalChg = 0;
  let count = 0;
  for (const exp of expiries) {
    const entry = data.get(exp);
    if (!entry || !entry.prevClose || entry.prevClose === 0) continue;
    totalChg += (entry.close - entry.prevClose) / entry.prevClose;
    count++;
  }
  if (count === 0) return null;
  const avgChg = totalChg / count;
  if (avgChg > 0.005) return 'up';   // >0.5% rise
  if (avgChg < -0.005) return 'down'; // >0.5% fall
  return null;
}

function classifyOptionMove(oi: number, prevOi: number | undefined, close: number, prevClose: number | undefined): RolloverPattern {
  if (prevOi === undefined || prevOi === 0) return '-';

  const oiChg = (oi - prevOi) / prevOi;
  const priceChg = prevClose !== undefined && prevClose > 0
    ? (close - prevClose) / prevClose
    : 0;

  const oiRising = oiChg > 0.02;
  const oiFalling = oiChg < -0.02;
  const priceUp = priceChg > 0.005;
  const priceDown = priceChg < -0.005;

  if (oiRising && priceUp) return 'Long Buildup';
  if (oiRising && priceDown) return 'Short Buildup';
  if (oiFalling && priceDown) return 'Long Unwinding';
  if (oiFalling && priceUp) return 'Short Covering';
  return 'Stable';
}

function patternBiasScore(pattern: RolloverPattern, optionType: 'CE' | 'PE'): number {
  if (optionType === 'CE') {
    if (pattern === 'Long Buildup') return 2;
    if (pattern === 'Short Covering') return 1;
    if (pattern === 'Short Buildup') return -2;
    if (pattern === 'Long Unwinding') return -1;
    return 0;
  }

  if (pattern === 'Short Buildup') return 2;
  if (pattern === 'Long Unwinding') return 1;
  if (pattern === 'Long Buildup') return -2;
  if (pattern === 'Short Covering') return -1;
  return 0;
}

function pctChange(start: number, end: number): number | null {
  if (start <= 0) return null;
  return ((end - start) / start) * 100;
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(0)}%`;
}

function formatPcr(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return value.toFixed(2);
}

function summarizePriceTrend(dates: string[], spotByDate: Map<string, number>): PriceTrendSummary {
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

function summarizeTradeBias(priceTrend: PriceTrendSummary, optionFlow: StrikeBiasSummary): TradeBiasSummary {
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

function checklistStatusText(status: ChecklistStatus): string {
  if (status === 'pass') return 'Yes';
  if (status === 'warn') return 'Wait';
  return 'No';
}

function distancePct(from: number | null, to: number | null): number | null {
  if (!from || !to) return null;
  return ((to - from) / from) * 100;
}

function summarizeTradeLevels(rows: TradeLevelRow[], spot: number | null, selectedStrike: number): TradeLevelContext {
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

function summarizeTradeSetup(
  priceTrend: PriceTrendSummary,
  optionFlow: StrikeBiasSummary,
  selectedStrike: number,
  levels: TradeLevelContext,
): TradeSetupSummary {
  const flowBullish = optionFlow.bias === 'Upward';
  const flowBearish = optionFlow.bias === 'Downward';
  const priceBullish = priceTrend.direction === 'Upward';
  const priceBearish = priceTrend.direction === 'Downward';
  const directionalFlow = flowBullish || flowBearish;
  const direction = flowBullish ? 'Bullish' : flowBearish ? 'Bearish' : 'Neutral';
  const priceAligned = (flowBullish && priceBullish) || (flowBearish && priceBearish);
  const priceConflicts = (flowBullish && priceBearish) || (flowBearish && priceBullish);
  const recentAligned = (flowBullish && optionFlow.recentBias === 'Bullish') || (flowBearish && optionFlow.recentBias === 'Bearish');
  const recentConflicts = (flowBullish && optionFlow.recentBias === 'Bearish') || (flowBearish && optionFlow.recentBias === 'Bullish');
  const confidenceStatus: ChecklistStatus = optionFlow.confidence >= 65 ? 'pass' : optionFlow.confidence >= 55 ? 'warn' : 'fail';
  const strengthStatus: ChecklistStatus = optionFlow.strength === 'Strong' || optionFlow.strength === 'Moderate'
    ? 'pass'
    : optionFlow.strength === 'Mild'
      ? 'warn'
      : 'fail';
  const priceStatus: ChecklistStatus = priceAligned ? 'pass' : priceConflicts ? 'fail' : 'warn';
  const recentStatus: ChecklistStatus = recentAligned ? 'pass' : recentConflicts ? 'fail' : 'warn';
  const flowStatus: ChecklistStatus = directionalFlow ? 'pass' : 'fail';
  const ready = directionalFlow && priceAligned && optionFlow.confidence >= 60 && !recentConflicts && strengthStatus === 'pass' && levels.riskRewardStatus !== 'fail';
  const watch = directionalFlow && !ready && !priceConflicts && optionFlow.confidence >= 55 && levels.locationStatus !== 'fail';
  const status: TradeSetupStatus = ready ? 'Confirmed' : watch ? 'Watch' : 'Avoid';
  const strikeLabel = selectedStrike.toFixed(0);
  const sideLabel = direction === 'Bullish' ? 'upside' : direction === 'Bearish' ? 'downside' : 'range';
  const oppositeLabel = direction === 'Bullish' ? 'below' : direction === 'Bearish' ? 'above' : 'outside';

  const checklist: TradeSetupChecklistItem[] = [
    {
      label: 'Directional flow',
      status: flowStatus,
      answer: directionalFlow ? `${optionFlow.bias} ${optionFlow.strength.toLowerCase()} flow` : 'Flow is neutral or mixed',
    },
    {
      label: 'Confidence',
      status: confidenceStatus,
      answer: `${optionFlow.confidence}% ${optionFlow.confidence >= 65 ? 'is tradeable' : optionFlow.confidence >= 55 ? 'needs confirmation' : 'is too low'}`,
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
      action: `Directional ${sideLabel} trade is allowed if live price holds confirmation.`,
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
      action: `Bias exists, but the checklist is not clean enough for a fresh trade.`,
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
    action: 'Skip fresh directional entry. Signals are neutral, weak, or conflicting.',
    strategy: 'Avoid naked option buying. If trading, use only clearly defined range strategies.',
    trigger: 'Wait for price and option flow to align in the same direction.',
    invalidation: 'No valid invalidation because there is no confirmed setup.',
    target: 'No target until a directional setup appears.',
    sizing: 'No directional risk.',
    checklist,
  };
}

function summarizeStrikeBias(
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
function classifyPattern(
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
function patternColor(p: RolloverPattern): string {
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
function expiryLabel(expiry: string, isMonthly: boolean): string {
  const d = new Date(expiry + 'T00:00:00');
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = d.getDate();
  return `${month} ${day}${isMonthly ? ' (M)' : ''}`;
}

/** Check if an expiry is monthly (last Thursday of month — approximate: last 7 days) */
function isMonthlyExpiry(expiry: string): boolean {
  const d = new Date(expiry + 'T00:00:00');
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() > lastDay - 7;
}

const OiHistory: React.FC = () => {
  const [scrip, setScrip] = useState('NIFTY50');
  const [selectedExpiryMonth, setSelectedExpiryMonth] = useState(currentMonthIST());
  const [fetching, setFetching] = useState(false);
  const lastFetchedRef = useRef('');
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [fetchResult, setFetchResult] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [data, setData] = useState<OiHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterDate, setFilterDate] = useState('');
  const [showPatternInfo, setShowPatternInfo] = useState(false);
  const [analysisTab, setAnalysisTab] = useState<'history' | 'setup'>('history');
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [hiddenExpiries, setHiddenExpiries] = useState<Set<string>>(() => new Set());
  const [recentScrips, setRecentScrips] = useState<string[]>(() => loadRecentScrips());
  const [scripOptions, setScripOptions] = useState(DEFAULT_SCRIP_OPTIONS);
  const [expiryMonthOptions, setExpiryMonthOptions] = useState<{ value: string; label: string }[]>(() => {
    const current = currentMonthIST();
    return [{ value: current, label: formatMonthLabel(current) }];
  });

  const selectScrip = useCallback((nextScrip: string) => {
    setScrip(nextScrip);
    setRecentScrips((prev) => {
      const next = [nextScrip, ...prev.filter((value) => value !== nextScrip)].slice(0, MAX_RECENT_SCRIPS);
      saveRecentScrips(next);
      return next;
    });
  }, []);

  const recentScripOptions = useMemo(() => {
    const labels = new Map(scripOptions.map((option) => [option.value, option.label]));
    return recentScrips
      .filter((value) => value !== scrip)
      .map((value) => ({ value, label: labels.get(value) || value }));
  }, [recentScrips, scrip, scripOptions]);
  const [strikeRange, setStrikeRange] = useState<number>(() => {
    const stored = localStorage.getItem('optiontrap_strike_range');
    const val = stored ? parseInt(stored, 10) : 10;
    // 0 ("All") is no longer offered — fall back to 10
    return [5, 10, 20].includes(val) ? val : 10;
  });

  // Fetch available future expiry months for the selected scrip from instruments
  useEffect(() => {
    const current = currentMonthIST();
    setFetchError(null);
    fetch(`/api/oi-history/expiry-months?scrip=${scrip}`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load expiry months (${res.status})`);
        return res.json();
      })
      .then((json) => {
        if (json.status === 'ok') {
          const months: string[] = json.months || [];
          if (months.length > 0) {
            const options = months.map((m) => ({ value: m, label: formatMonthLabel(m) }));
            setExpiryMonthOptions(options);
            setSelectedExpiryMonth((prev) => months.includes(prev) ? prev : months[0]);
          } else {
            setExpiryMonthOptions([{ value: current, label: formatMonthLabel(current) }]);
            setSelectedExpiryMonth(current);
          }
        } else {
          throw new Error(json.message || 'Failed to load expiry months');
        }
      })
      .catch((err) => {
        setExpiryMonthOptions([{ value: current, label: formatMonthLabel(current) }]);
        setSelectedExpiryMonth(current);
        setFetchError(err instanceof Error ? err.message : 'Failed to load expiry months');
      });
  }, [scrip]);

  // Fetch available F&O symbols on mount
  useEffect(() => {
    fetch('/api/fno-symbols', { credentials: 'include' })
      .then((res) => res.json())
      .then((json) => {
        if (json.status === 'ok' && json.data?.length > 0) {
          const options = json.data.map((name: string) => ({
            value: name === 'NIFTY' ? 'NIFTY50' : name,
            label: name === 'NIFTY' ? 'NIFTY 50' : name === 'BANKNIFTY' ? 'BANK NIFTY' : name,
          }));
          setScripOptions(options);
        }
      })
      .catch(() => { /* keep defaults */ });
  }, []);

  /** Expiry months to include: from the current month up to and including the
   * selected one (e.g. select Aug → [Jul, Aug]; select Sep → [Jul, Aug, Sep]). */
  const includedExpiryMonths = useMemo(() => {
    return expiryMonthOptions
      .map((o) => o.value)
      .filter((m) => m <= selectedExpiryMonth)
      .sort();
  }, [expiryMonthOptions, selectedExpiryMonth]);

  /** Load stored data from server — loads all expiry months up to the selected one */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const from = `${todayIST().slice(0, 7)}-01`;
      const results = await Promise.all(
        includedExpiryMonths.map(async (month) => {
          const params = new URLSearchParams({ scrip, expiryMonth: month, from });
          const res = await fetch(`/api/oi-history?${params}`, { credentials: 'include' });
          const json = await res.json();
          return json.status === 'ok' ? (json.data as OiHistoryRow[]) : [];
        }),
      );
      const merged = results.flat();
      setData(merged);
      if (merged.length > 0) {
        const dates = [...new Set(merged.map((r) => r.date))].sort();
        setFilterDate(dates[dates.length - 1] as string);
      }
    } catch (err) {
      console.error('[OiHistory] Load error:', err);
    } finally {
      setLoading(false);
    }
  }, [scrip, includedExpiryMonths]);

  /** Stream a single expiry-month fetch from Kite via SSE. Returns on stream end. */
  const fetchExpiryMonth = useCallback(async (month: string, monthLabel: string) => {
    const res = await fetch('/api/oi-history/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ scrip, expiryMonth: month }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Server error (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handleEvent = (eventType: string, dataStr: string) => {
      if (!eventType || !dataStr) return;
      let payload: any;
      try {
        payload = JSON.parse(dataStr);
      } catch {
        return; // ignore malformed SSE data
      }
      switch (eventType) {
        case 'step':
          setProgress({ step: `${monthLabel}: ${payload.message}`, pct: 0, detail: '' });
          break;
        case 'progress':
          setProgress((prev) => {
            if (prev && payload.pct < prev.pct && prev.step.startsWith(monthLabel)) return prev;
            return {
              step: `${monthLabel}: Fetching OI data...`,
              pct: payload.pct,
              detail: `${payload.done}/${payload.total} instruments (batch ${payload.batch}/${payload.totalBatches})`,
            };
          });
          break;
        case 'error':
          throw new Error(payload.message);
      }
    };

    // Parse complete SSE event blocks (separated by a blank line). Robust to
    // network chunks splitting anywhere, including between "event:"/"data:".
    const processBlock = (block: string) => {
      let eventType = '';
      let dataStr = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataStr += line.slice(5).replace(/^ /, '');
        }
      }
      handleEvent(eventType, dataStr);
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (block.trim()) processBlock(block);
      }
    }
    if (buffer.trim()) processBlock(buffer);
  }, [scrip]);

  /** Fetch all included expiry months (current month up to selected) from Kite */
  const handleFetch = useCallback(async () => {
    setFetching(true);
    setProgress({ step: 'Connecting...', pct: 0, detail: '' });
    setFetchResult(null);
    setFetchError(null);

    try {
      for (const month of includedExpiryMonths) {
        const label = formatMonthShortLabel(month);
        await fetchExpiryMonth(month, label);
      }
      setProgress(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Network error');
      setProgress(null);
    } finally {
      setFetching(false);
      loadData();
    }
  }, [includedExpiryMonths, fetchExpiryMonth, loadData]);

  // When scrip or expiry month changes, load existing data from the DB only.
  // Fetching fresh data from Kite is an explicit action via the Fetch button.
  useEffect(() => {
    const key = `${scrip}_${selectedExpiryMonth}`;
    if (lastFetchedRef.current === key) return;
    lastFetchedRef.current = key;

    // Clear old data immediately so stale content isn't shown
    setData([]);
    setSelectedStrike(null);
    setFilterDate('');
    setFetchResult(null);
    setFetchError(null);

    loadData();
  }, [scrip, selectedExpiryMonth, loadData]);

  /** Delete all OI history for the selected scrip */
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDeleteMonth = useCallback(async () => {
    setConfirmDelete(false);

    try {
      const params = new URLSearchParams({ scrip });
      const res = await fetch(`/api/oi-history?${params}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json();
      if (json.status === 'ok') {
        setData([]);
        lastFetchedRef.current = '';
        setSelectedStrike(null);
        setFilterDate('');
      } else {
        setFetchError(json.message || 'Failed to delete');
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Network error');
    }
  }, [scrip]);

  // Toast notifications for trade feedback
  const [toasts, setToasts] = useState<{ id: number; text: string; color: 'green' | 'red' }[]>([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((text: string, color: 'green' | 'red') => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, text, color }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2000);
  }, []);

  // Handle buy/sell from OI history cells
  const handleTrade = useCallback(async (
    cell: any,
    optionType: 'CE' | 'PE',
    side: 'BUY' | 'SELL',
    strike: number,
    expiry: string,
  ) => {
    const token = optionType === 'CE' ? cell.ceToken : cell.peToken;
    const tradingsymbol = optionType === 'CE' ? cell.ceTradingsymbol : cell.peTradingsymbol;
    const price = optionType === 'CE' ? cell.ceClose : cell.peClose;

    if (!token || !tradingsymbol || !price) return;

    try {
      await addPosition({
        tradingsymbol,
        instrumentToken: token,
        strike,
        optionType,
        side,
        quantity: getLotSize(token),
        entryPrice: price,
        expiry,
      });
      showToast(`${side} ${strike}${optionType} @ ₹${price.toFixed(2)}`, 'green');
    } catch {
      showToast('Failed to add position', 'red');
    }
  }, [showToast]);

  /** Unique dates in the loaded data */
  const availableDates = useMemo(() => {
    return [...new Set(data.map((r) => r.date))].sort();
  }, [data]);

  /** Dates grouped by month (YYYY-MM) for a clearer date bar */
  const datesByMonth = useMemo(() => {
    const groups: { month: string; dates: string[] }[] = [];
    let current: { month: string; dates: string[] } | null = null;
    for (const d of availableDates) {
      const month = d.slice(0, 7);
      if (!current || current.month !== month) {
        current = { month, dates: [] };
        groups.push(current);
      }
      current.dates.push(d);
    }
    return groups;
  }, [availableDates]);

  /** Unique expiries in the loaded data for the selected expiry month, sorted */
  const expiries = useMemo(() => {
    const set = new Set<string>();
    for (const r of data) {
      if (r.expiry) set.add(r.expiry);
    }
    return [...set].sort();
  }, [data]);

  /** Dates that are weekly expiries in the loaded trading dates. */
  const weeklyExpiryDates = useMemo(() => {
    const knownWeeklyExpiries = expiries.filter((exp) => !isMonthlyExpiry(exp));
    const weeklyExpiryWeekdays = new Set(
      knownWeeklyExpiries.map((exp) => new Date(`${exp}T00:00:00`).getDay()),
    );

    const set = new Set<string>(knownWeeklyExpiries);
    if (weeklyExpiryWeekdays.size === 0) return set;

    if (availableDates.length === 0) return set;

    const [year, month] = availableDates[availableDates.length - 1].slice(0, 7).split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const availableDateSet = new Set(availableDates);

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (weeklyExpiryWeekdays.has(date.getDay()) && !isMonthlyExpiry(dateKey) && availableDateSet.has(dateKey)) {
        set.add(dateKey);
      }
    }

    return set;
  }, [availableDates, expiries]);

  /** Rows for the selected date */
  const filteredRows = useMemo(() => {
    if (!filterDate) return [];
    return data.filter((r) => r.date === filterDate);
  }, [data, filterDate]);

  /** Expiries available on the selected date. Expired weekly contracts are not shown after expiry. */
  const tableExpiries = useMemo(() => {
    const set = new Set<string>();
    for (const r of filteredRows) {
      if (r.expiry) set.add(r.expiry);
    }
    return [...set].sort();
  }, [filteredRows]);

  const visibleTableExpiries = useMemo(() => {
    return tableExpiries.filter((exp) => !hiddenExpiries.has(exp));
  }, [tableExpiries, hiddenExpiries]);

  /** Rows for the previous date (for OI change computation) */
  const prevDateRows = useMemo(() => {
    if (!filterDate || availableDates.length < 2) return [];
    const idx = availableDates.indexOf(filterDate);
    if (idx <= 0) return [];
    const prevDate = availableDates[idx - 1];
    return data.filter((r) => r.date === prevDate);
  }, [data, filterDate, availableDates]);

  /** Map: instrumentToken → previous day OI */
  const prevDayOi = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of prevDateRows) {
      map.set(r.instrumentToken, r.oi);
    }
    return map;
  }, [prevDateRows]);

  const prevDayClose = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of prevDateRows) {
      if (r.close > 0) map.set(r.instrumentToken, r.close);
    }
    return map;
  }, [prevDateRows]);

  /** ATM strike for the selected date */
  const atmStrike = useMemo(() => {
    if (filteredRows.length === 0) return null;
    const spot = filteredRows[0].spotClose;
    // Find the closest strike to spot price from the actual data
    const strikes = [...new Set(filteredRows.filter((r) => r.strike).map((r) => r.strike as number))].sort((a, b) => a - b);
    if (strikes.length === 0) return null;
    let closest = strikes[0];
    let minDiff = Math.abs(strikes[0] - spot);
    for (const s of strikes) {
      const diff = Math.abs(s - spot);
      if (diff < minDiff) { minDiff = diff; closest = s; }
    }
    return closest;
  }, [filteredRows]);

  const selectedSpotClose = filteredRows[0]?.spotClose ?? null;

  // Auto-select ATM strike to show chart on load
  useEffect(() => {
    if (atmStrike) {
      setSelectedStrike(atmStrike);
    }
  }, [atmStrike]);

  /** Build table data: rows = strikes, columns = expiries */
  const tableData = useMemo(() => {
    if (filteredRows.length === 0 || visibleTableExpiries.length === 0) return [];

    // Index: strike → expiry → { ce, pe }
    type CellData = {
      ceOi: number;
      peOi: number;
      cePrevOi: number | undefined;
      pePrevOi: number | undefined;
      ceClose: number;
      peClose: number;
      cePrevClose: number | undefined;
      pePrevClose: number | undefined;
      ceToken: number | undefined;
      peToken: number | undefined;
      ceTradingsymbol: string | undefined;
      peTradingsymbol: string | undefined;
      ceExpiry: string | undefined;
      peExpiry: string | undefined;
    };

    const grid = new Map<number, Map<string, CellData>>();

    const visibleExpirySet = new Set(visibleTableExpiries);

    for (const r of filteredRows) {
      if (!r.strike || !r.optionType || !r.expiry) continue;
      if (!visibleExpirySet.has(r.expiry)) continue;

      if (!grid.has(r.strike)) grid.set(r.strike, new Map());
      const strikeMap = grid.get(r.strike)!;

      if (!strikeMap.has(r.expiry)) {
        strikeMap.set(r.expiry, {
          ceOi: 0, peOi: 0,
          cePrevOi: undefined, pePrevOi: undefined,
          ceClose: 0, peClose: 0,
          cePrevClose: undefined, pePrevClose: undefined,
          ceToken: undefined, peToken: undefined,
          ceTradingsymbol: undefined, peTradingsymbol: undefined,
          ceExpiry: undefined, peExpiry: undefined,
        });
      }
      const cell = strikeMap.get(r.expiry)!;

      if (r.optionType === 'CE') {
        cell.ceOi = r.oi;
        cell.ceClose = r.close;
        cell.ceToken = r.instrumentToken;
        cell.ceTradingsymbol = r.tradingsymbol;
        cell.ceExpiry = r.expiry;
        cell.cePrevOi = prevDayOi.get(r.instrumentToken);
        cell.cePrevClose = prevDayClose.get(r.instrumentToken);
      } else {
        cell.peOi = r.oi;
        cell.peClose = r.close;
        cell.peToken = r.instrumentToken;
        cell.peTradingsymbol = r.tradingsymbol;
        cell.peExpiry = r.expiry;
        cell.pePrevOi = prevDayOi.get(r.instrumentToken);
        cell.pePrevClose = prevDayClose.get(r.instrumentToken);
      }
    }

    // Compute dynamic OI threshold: show strikes with OI > 10% of the max OI in the dataset
    // This adapts to any scrip (indices have millions, stocks have thousands)
    let maxOiInGrid = 0;
    for (const expiryMap of grid.values()) {
      for (const cell of expiryMap.values()) {
        if (cell.ceOi > maxOiInGrid) maxOiInGrid = cell.ceOi;
        if (cell.peOi > maxOiInGrid) maxOiInGrid = cell.peOi;
      }
    }
    const oiThreshold = Math.max(1000, maxOiInGrid * 0.05);

    // Build rows sorted by strike
    const rows = [...grid.entries()]
      .sort(([a], [b]) => a - b)
      .map(([strike, expiryMap]) => {
        // Check if strike has significant OI (above 5% of max)
        let hasSignificantOi = false;
        for (const cell of expiryMap.values()) {
          if (cell.ceOi > oiThreshold || cell.peOi > oiThreshold) {
            hasSignificantOi = true;
            break;
          }
        }

        // Classify CE and PE patterns
        const ceByExpiry = new Map<string, { oi: number; prevOi: number | undefined; close: number; prevClose: number | undefined }>();
        const peByExpiry = new Map<string, { oi: number; prevOi: number | undefined; close: number; prevClose: number | undefined }>();
        for (const [exp, cell] of expiryMap) {
          if (cell.ceOi > 0) ceByExpiry.set(exp, { oi: cell.ceOi, prevOi: cell.cePrevOi, close: cell.ceClose, prevClose: cell.cePrevClose });
          if (cell.peOi > 0) peByExpiry.set(exp, { oi: cell.peOi, prevOi: cell.pePrevOi, close: cell.peClose, prevClose: cell.pePrevClose });
        }

        const cePattern = classifyPattern(ceByExpiry, visibleTableExpiries);
        const pePattern = classifyPattern(peByExpiry, visibleTableExpiries);
        const weeklyExpiries = visibleTableExpiries.filter((exp) => !isMonthlyExpiry(exp) && expiryMap.has(exp));
        const consolidatedExpiries = weeklyExpiries.length > 0 ? weeklyExpiries : visibleTableExpiries;
        const consolidatedOi = consolidatedExpiries.reduce(
          (total, exp) => {
            const cell = expiryMap.get(exp);
            if (!cell) return total;
            return {
              ce: total.ce + cell.ceOi,
              pe: total.pe + cell.peOi,
            };
          },
          { ce: 0, pe: 0 },
        );

        return {
          strike,
          cells: expiryMap,
          cePattern,
          pePattern,
          ceConsolidatedOi: consolidatedOi.ce,
          peConsolidatedOi: consolidatedOi.pe,
          dimmed: !hasSignificantOi,
        };
      }) as {
        strike: number;
        cells: Map<string, CellData>;
        cePattern: RolloverPattern;
        pePattern: RolloverPattern;
        ceConsolidatedOi: number;
        peConsolidatedOi: number;
        dimmed: boolean;
      }[];

    // Limit strikes around ATM based on selected range
    if (strikeRange > 0 && atmStrike && rows.length > 0) {
      const atmIdx = rows.findIndex((r) => r.strike >= atmStrike);
      const center = atmIdx >= 0 ? atmIdx : Math.floor(rows.length / 2);
      const start = Math.max(0, center - strikeRange);
      const end = Math.min(rows.length, center + strikeRange + 1);
      return rows.slice(start, end);
    }

    return rows;
  }, [filteredRows, visibleTableExpiries, prevDayOi, prevDayClose, scrip, atmStrike, strikeRange]);

  const maxConsolidatedOi = useMemo(() => {
    let max = 0;
    for (const row of tableData) {
      if (row.ceConsolidatedOi > max) max = row.ceConsolidatedOi;
      if (row.peConsolidatedOi > max) max = row.peConsolidatedOi;
    }
    return max;
  }, [tableData]);

  // When the selected strike is no longer visible in the table (e.g. after
  // narrowing the strike range), fall back to the ATM strike if it's visible,
  // otherwise clear the selection.
  useEffect(() => {
    if (selectedStrike === null) return;
    if (tableData.some((r) => r.strike === selectedStrike)) return;
    if (atmStrike && tableData.some((r) => r.strike === atmStrike)) {
      setSelectedStrike(atmStrike);
    } else {
      setSelectedStrike(null);
    }
  }, [tableData, selectedStrike, atmStrike]);

  /** Chart data for selected strike across all dates */
  const chartData = useMemo(() => {
    if (!selectedStrike || availableDates.length === 0 || visibleTableExpiries.length === 0) return null;

    // Group data by date+expiry for the selected strike
    const dateMap = new Map<string, Map<string, { ceOi: number; peOi: number; ceClose: number; peClose: number }>>();
    const spotByDate = new Map<string, number>();
    const tableExpirySet = new Set(visibleTableExpiries);

    for (const r of data) {
      if (r.strike !== selectedStrike || !r.expiry || !tableExpirySet.has(r.expiry)) continue;
      if (r.spotClose > 0) spotByDate.set(r.date, r.spotClose);
      if (!dateMap.has(r.date)) dateMap.set(r.date, new Map());
      const expMap = dateMap.get(r.date)!;
      if (!expMap.has(r.expiry)) expMap.set(r.expiry, { ceOi: 0, peOi: 0, ceClose: 0, peClose: 0 });
      const entry = expMap.get(r.expiry)!;
      if (r.optionType === 'CE') {
        entry.ceOi = r.oi;
        entry.ceClose = r.close;
      } else {
        entry.peOi = r.oi;
        entry.peClose = r.close;
      }
    }

    const dates = availableDates.filter((d) => dateMap.has(d));
    if (dates.length === 0) return null;
    const biasSummary = summarizeStrikeBias(dates, dateMap, visibleTableExpiries, spotByDate);
    const priceTrend = summarizePriceTrend(dates, spotByDate);
    const tradeBias = summarizeTradeBias(priceTrend, biasSummary);
    const latestSpot = priceTrend.endPrice ?? selectedSpotClose;
    const tradeLevels = summarizeTradeLevels(tableData, latestSpot, selectedStrike);
    const tradeSetup = summarizeTradeSetup(priceTrend, biasSummary, selectedStrike, tradeLevels);

    // Find max values for axis scaling
    let maxOi = 0;
    let maxCePrice = 0;
    let maxPePrice = 0;
    for (const [, expMap] of dateMap) {
      for (const [, v] of expMap) {
        if (v.ceOi > maxOi) maxOi = v.ceOi;
        if (v.peOi > maxOi) maxOi = v.peOi;
        if (v.ceClose > maxCePrice) maxCePrice = v.ceClose;
        if (v.peClose > maxPePrice) maxPePrice = v.peClose;
      }
    }

    return { dates, dateMap, maxOi, maxCePrice, maxPePrice, biasSummary, priceTrend, tradeBias, tradeSetup, tradeLevels };
  }, [data, selectedStrike, availableDates, visibleTableExpiries, selectedSpotClose, tableData]);

  /** Expiry colors for chart lines */
  const expiryColors = useMemo(() => {
    const palette = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#06b6d4'];
    const map = new Map<string, string>();
    expiries.forEach((exp, i) => map.set(exp, palette[i % palette.length]));
    return map;
  }, [expiries]);

  const toggleExpiryVisibility = (expiry: string) => {
    setHiddenExpiries((prev) => {
      const isHidden = prev.has(expiry);
      const visibleCount = tableExpiries.filter((exp) => !prev.has(exp)).length;
      if (!isHidden && visibleCount <= 1) return prev;

      const next = new Set(prev);
      if (isHidden) {
        next.delete(expiry);
      } else {
        next.add(expiry);
      }
      return next;
    });
  };

  return (
    <div className="oi-history">
      {toasts.length > 0 && (
        <div className="oi-history__toast-stack">
          {toasts.map((t) => (
            <div key={t.id} className={`oi-history__toast oi-history__toast--${t.color}`}>{t.text}</div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="oi-history__controls card">
        <div className="oi-history__control-row">
          <label className="oi-history__label">
            <AppSelect
              value={scrip}
              options={scripOptions}
              onChange={(v) => selectScrip(String(v))}
              searchable
              disabled={fetching}
            />
          </label>

          <label className="oi-history__label">
            <AppSelect
              value={selectedExpiryMonth}
              options={expiryMonthOptions.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
              onChange={(v) => setSelectedExpiryMonth(String(v))}
              disabled={fetching}
            />
          </label>

          <AppSelect
            value={strikeRange}
            options={[
              { value: 5, label: '5' },
              { value: 10, label: '10' },
              { value: 20, label: '20' },
            ]}
            onChange={(v) => { const val = Number(v); setStrikeRange(val); localStorage.setItem('optiontrap_strike_range', String(val)); }}
          />

          <button
            className="app-btn app-btn--primary"
            onClick={handleFetch}
            disabled={fetching}
            title={`Fetch ${scrip} data for ${includedExpiryMonths.length} expiry month(s) (${includedExpiryMonths.join(', ')}) from Kite`}
          >
            {fetching ? 'Fetching…' : 'Fetch'}
          </button>

          <button
            className="app-btn app-btn--danger app-btn--icon"
            onClick={() => setConfirmDelete(true)}
            disabled={fetching}
            title={`Delete all OI history data for ${scrip}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>

          <button
            className="app-btn app-btn--icon"
            onClick={() => setShowPatternInfo(!showPatternInfo)}
            title="Pattern definitions"
            style={{ marginLeft: 'auto' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
            </svg>
          </button>
        </div>

        {recentScripOptions.length > 0 && (
          <div className="oi-history__recent-scrips" aria-label="Recently visited scripts">
            <span className="oi-history__recent-scrips-label">Recent</span>
            {recentScripOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className="oi-history__recent-scrip"
                onClick={() => selectScrip(option.value)}
                disabled={fetching}
                title={`Switch to ${option.label}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {/* Progress bar */}
        {progress && (
          <div className="oi-history__progress">
            <div className="oi-history__progress-header">
              <span className="oi-history__progress-step">{progress.step}</span>
              {progress.pct > 0 && (
                <span className="oi-history__progress-pct">{progress.pct}%</span>
              )}
            </div>
            <div className="oi-history__progress-track">
              <div
                className="oi-history__progress-fill"
                style={{ width: `${progress.pct}%` }}
              />
            </div>
            {progress.detail && (
              <span className="oi-history__progress-detail">{progress.detail}</span>
            )}
          </div>
        )}

        {/* Result / Error */}
        {fetchResult && !progress && (
          <div className="oi-history__status">{fetchResult}</div>
        )}
        {fetchError && !progress && (
          <div className="oi-history__status oi-history__status--error">{fetchError}</div>
        )}

        {showPatternInfo && (
          <div className="trap-info-detail" style={{ marginTop: 12 }}>
            <h4>Pattern Definitions</h4>
            <p>Patterns classify <strong>who</strong> is active at each strike based on day-over-day OI change and option price movement.</p>

            <h5>OI + Price Signals (single expiry / monthly scrips)</h5>
            <ul>
              <li><strong style={{ color: '#22c55e' }}>Long Buildup</strong> — OI ↑ + Price ↑ — New buyers entering aggressively. Bullish for the option.</li>
              <li><strong style={{ color: '#ef4444' }}>Short Buildup</strong> — OI ↑ + Price ↓ — New sellers entering aggressively. Bearish for the option.</li>
              <li><strong style={{ color: '#ef4444' }}>Long Unwinding</strong> — OI ↓ + Price ↓ — Buyers exiting, giving up. Weakness in that direction.</li>
              <li><strong style={{ color: '#22c55e' }}>Short Covering</strong> — OI ↓ + Price ↑ — Sellers exiting, bears retreating. Bullish reversal signal.</li>
            </ul>

            <h5>Rollover Patterns (multiple expiries / weekly scrips)</h5>
            <ul>
              <li><strong style={{ color: 'var(--accent)' }}>Rolling Over (Short)</strong> — Writers moving positions to next expiry. Strike is being actively defended.</li>
              <li><strong style={{ color: 'var(--accent)' }}>Rolling Over (Long)</strong> — Buyers moving to next expiry. Directional conviction maintained.</li>
              <li><strong style={{ color: '#ef4444' }}>Exiting (Long Unwind)</strong> — Buyers closing out, no new positions. Support/resistance weakening.</li>
              <li><strong style={{ color: '#ef4444' }}>Exiting (Short Cover)</strong> — Sellers closing out, the wall is being abandoned.</li>
              <li><strong style={{ color: '#22c55e' }}>Fresh Build (Short)</strong> — New sellers at far expiry. New wall being established.</li>
              <li><strong style={{ color: '#22c55e' }}>Fresh Build (Long)</strong> — New buyers at far expiry. New directional bet.</li>
              <li><strong style={{ color: '#22c55e' }}>Doubling Down</strong> — OI rising across multiple expiries. Strong conviction.</li>
              <li><strong style={{ color: '#ef4444' }}>Unwinding</strong> — OI falling across all expiries. Full retreat from this level.</li>
              <li><strong style={{ color: 'var(--text-secondary)' }}>Stable</strong> — No significant change (&lt;2%). Positions held steady.</li>
            </ul>

            <h5>How to Read</h5>
            <ul>
              <li><strong>CE Short Buildup</strong> at 1800 = call sellers adding positions, expecting price won't cross 1800. Resistance forming.</li>
              <li><strong>PE Long Buildup</strong> at 1700 = put buyers entering, expecting price to fall below 1700. Bearish bet.</li>
              <li><strong>PE Short Covering</strong> at 1700 = put sellers exiting, support at 1700 weakening.</li>
              <li><strong>CE Long Unwinding</strong> at 1800 = call buyers giving up on 1800 breakout.</li>
            </ul>
            <p>Dimmed rows have OI below 5% of the max — less significant strikes. Click any row to see its OI &amp; price chart across dates.</p>
          </div>
        )}
      </div>

      {/* Date filter — grouped by month */}
      {availableDates.length > 0 && (
        <div className="oi-history__date-bar">
          {datesByMonth.map(({ month, dates }) => (
            <div key={month} className="oi-history__date-group">
              <span className="oi-history__date-group-label">{formatMonthShortLabel(month)}</span>
              <div className="oi-history__date-group-days">
                {dates.map((d) => {
                  const isWeeklyExpiry = weeklyExpiryDates.has(d);
                  return (
                    <button
                      key={d}
                      className={`oi-history__date-btn ${filterDate === d ? 'oi-history__date-btn--active' : ''} ${isWeeklyExpiry ? 'oi-history__date-btn--weekly-expiry' : ''}`}
                      onClick={() => setFilterDate(d)}
                      title={`${formatFullDateLabel(d)}${isWeeklyExpiry ? ' — Weekly expiry' : ''}`}
                    >
                      {Number(d.slice(8))}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Loading indicator */}
      {(loading || fetching) && data.length === 0 && (
        <div className="card oi-history__loading-card">
          <div className="oi-history__loading-spinner" />
          <span className="oi-history__loading-text">Loading data...</span>
        </div>
      )}

      {/* Expiry-pivoted table */}
      {tableData.length > 0 && (
        <div className="oi-history__table-wrap card">
          <div className="oi-history__table-header">
            <div className="oi-history__table-count">
              {tableData.length} strikes &middot; {visibleTableExpiries.length} expiries
            </div>
          </div>

          <div className="oi-history__table-scroll">
            <table className="oi-history__table">
              <thead>
                <tr>
                  <th className="oi-history__th-pattern">CE Pattern</th>
                  {visibleTableExpiries.map((exp) => (
                    <th key={`ce-${exp}`} className="oi-history__th-group oi-history__th-group--ce">
                      {expiryLabel(exp, isMonthlyExpiry(exp))}
                    </th>
                  ))}
                  <th className="oi-history__th-strike">Strike</th>
                  {visibleTableExpiries.map((exp) => (
                    <th key={`pe-${exp}`} className="oi-history__th-group oi-history__th-group--pe">
                      {expiryLabel(exp, isMonthlyExpiry(exp))}
                    </th>
                  ))}
                  <th className="oi-history__th-pattern">PE Pattern</th>
                </tr>
              </thead>
              <tbody>
                {tableData.map(({ strike, cells, cePattern, pePattern, ceConsolidatedOi, peConsolidatedOi, dimmed }) => {
                  const isAtm = strike === atmStrike;
                  const isCeItm = selectedSpotClose !== null && selectedSpotClose > 0 && strike < selectedSpotClose;
                  const isPeItm = selectedSpotClose !== null && selectedSpotClose > 0 && strike > selectedSpotClose;
                  const ceBarWidth = maxConsolidatedOi > 0 ? (ceConsolidatedOi / maxConsolidatedOi) * 50 : 0;
                  const peBarWidth = maxConsolidatedOi > 0 ? (peConsolidatedOi / maxConsolidatedOi) * 50 : 0;
                  return (
                    <tr
                      key={strike}
                      className={`${isAtm ? 'oi-history__row--atm' : ''} ${selectedStrike === strike ? 'oi-history__row--selected' : ''} ${dimmed ? 'oi-history__row--dimmed' : ''}`}
                      onClick={() => setSelectedStrike(strike)}
                    >
                      {/* CE Pattern */}
                      <td
                        className="oi-history__cell--pattern"
                        style={{ color: patternColor(cePattern) }}
                      >
                        {cePattern}
                      </td>

                      {/* CE data per expiry */}
                      {visibleTableExpiries.map((exp) => {
                        const cell = cells.get(exp);
                        const { text, chgCls } = formatOiWithChg(cell?.ceOi || 0, cell?.cePrevOi);
                        const closePrice = cell?.ceClose || 0;
                        return (
                          <td key={`ce-${exp}`} className={`oi-history__cell--ce oi-history__cell--tradeable ${isCeItm ? 'oi-history__cell--itm-ce' : ''} ${chgCls}`}>
                            <div className="oi-history__cell-content">
                              <span className="oi-history__cell-primary">{text}</span>
                              {closePrice > 0 && <span className="oi-history__cell-price">₹{closePrice.toFixed(closePrice < 10 ? 2 : closePrice < 100 ? 1 : 0)}</span>}
                            </div>
                            {cell?.ceToken && closePrice > 0 && (
                              <div className="oi-history__cell-actions">
                                <button className="oi-history__action-btn oi-history__action-btn--buy" onClick={(e) => { e.stopPropagation(); handleTrade(cell!, 'CE', 'BUY', strike, exp); }}>B</button>
                                <button className="oi-history__action-btn oi-history__action-btn--sell" onClick={(e) => { e.stopPropagation(); handleTrade(cell!, 'CE', 'SELL', strike, exp); }}>S</button>
                              </div>
                            )}
                          </td>
                        );
                      })}

                      {/* Strike */}
                      <td className={`oi-history__cell--strike ${isAtm ? 'oi-history__cell--strike-atm' : ''}`}>
                        <div className="oi-history__strike-bars" style={{ '--oi-history-expiry-count': visibleTableExpiries.length } as React.CSSProperties}>
                          <div className="oi-history__oi-bar oi-history__oi-bar--ce" style={{ width: `${ceBarWidth}%` }} />
                          <div className="oi-history__oi-bar oi-history__oi-bar--pe" style={{ width: `${peBarWidth}%` }} />
                        </div>
                        {strike}
                      </td>

                      {/* PE data per expiry */}
                      {visibleTableExpiries.map((exp) => {
                        const cell = cells.get(exp);
                        const { text, chgCls } = formatOiWithChg(cell?.peOi || 0, cell?.pePrevOi);
                        const closePrice = cell?.peClose || 0;
                        return (
                          <td key={`pe-${exp}`} className={`oi-history__cell--pe oi-history__cell--tradeable ${isPeItm ? 'oi-history__cell--itm-pe' : ''} ${chgCls}`}>
                            <div className="oi-history__cell-content">
                              <span className="oi-history__cell-primary">{text}</span>
                              {closePrice > 0 && <span className="oi-history__cell-price">₹{closePrice.toFixed(closePrice < 10 ? 2 : closePrice < 100 ? 1 : 0)}</span>}
                            </div>
                            {cell?.peToken && closePrice > 0 && (
                              <div className="oi-history__cell-actions">
                                <button className="oi-history__action-btn oi-history__action-btn--buy" onClick={(e) => { e.stopPropagation(); handleTrade(cell!, 'PE', 'BUY', strike, exp); }}>B</button>
                                <button className="oi-history__action-btn oi-history__action-btn--sell" onClick={(e) => { e.stopPropagation(); handleTrade(cell!, 'PE', 'SELL', strike, exp); }}>S</button>
                              </div>
                            )}
                          </td>
                        );
                      })}

                      {/* PE Pattern */}
                      <td
                        className="oi-history__cell--pattern"
                        style={{ color: patternColor(pePattern) }}
                      >
                        {pePattern}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Dual-axis chart for selected strike */}
      {chartData && selectedStrike && (
        <div className="oi-history__chart-wrap card">
          <div className="oi-history__chart-header">
            <span className="oi-history__chart-title">Strike {selectedStrike}</span>
            <div className="oi-history__analysis-tabs" role="tablist" aria-label="OI analysis view">
              <button
                type="button"
                role="tab"
                aria-selected={analysisTab === 'history'}
                className={`oi-history__analysis-tab ${analysisTab === 'history' ? 'oi-history__analysis-tab--active' : ''}`}
                onClick={() => setAnalysisTab('history')}
              >
                OI Price History
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={analysisTab === 'setup'}
                className={`oi-history__analysis-tab ${analysisTab === 'setup' ? 'oi-history__analysis-tab--active' : ''}`}
                onClick={() => setAnalysisTab('setup')}
              >
                Trade Setup
              </button>
            </div>
          </div>

          {analysisTab === 'history' && (
            <>
          <div className="oi-history__chart-pair">
            {/* CE Chart */}
            {(() => {
              const W = 700, H = 150, PAD_L = 50, PAD_R = 50, PAD_T = 16, PAD_B = 18;
              const plotW = W - PAD_L - PAD_R;
              const plotH = H - PAD_T - PAD_B;
              const { dates, dateMap, maxOi, maxCePrice } = chartData;
              const n = dates.length;
              if (n === 0 || maxOi === 0) return null;
              const barW = Math.min(plotW / n * 0.4, 10);
              const safeMaxPrice = maxCePrice || 1;

              // Build price lines per expiry
              const priceLines = visibleTableExpiries.map((exp) => {
                const pts: { x: number; y: number; price: number; date: string }[] = [];
                dates.forEach((d, i) => {
                  const x = PAD_L + (i + 0.5) * (plotW / n);
                  const entry = dateMap.get(d)?.get(exp);
                  if (entry && entry.ceClose > 0) {
                    const y = PAD_T + plotH - (entry.ceClose / safeMaxPrice) * plotH;
                    pts.push({ x, y, price: entry.ceClose, date: d });
                  }
                });
                return { exp, pts, points: pts.map((p) => `${p.x},${p.y}`).join(' ') };
              }).filter((l) => l.pts.length > 0);

              return (
                <div className="oi-history__chart-panel">
                  <div className="oi-history__chart-label">CE</div>
                  <svg viewBox={`0 0 ${W} ${H}`} className="oi-history__chart-svg">
                    {/* Grid lines */}
                    {[0.25, 0.5, 0.75].map((frac) => (
                      <line key={frac} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH * (1 - frac)} y2={PAD_T + plotH * (1 - frac)} stroke="var(--card-border)" strokeWidth="0.5" />
                    ))}
                    {/* X-axis baseline */}
                    <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="var(--text-secondary)" strokeWidth="0.5" opacity="0.5" />

                    {/* OI bars (stacked per expiry) */}
                    {dates.map((d, i) => {
                      const x = PAD_L + (i + 0.5) * (plotW / n);
                      const expiryBars = visibleTableExpiries
                        .map((exp) => ({ exp, oi: dateMap.get(d)?.get(exp)?.ceOi || 0 }))
                        .filter((b) => b.oi > 0);
                      const totalBarW = barW * expiryBars.length;
                      return expiryBars.map((b, j) => {
                        const barH = (b.oi / maxOi) * plotH;
                        const bx = x - totalBarW / 2 + j * barW;
                        return (
                          <rect key={`${d}-${b.exp}`} x={bx} y={PAD_T + plotH - barH} width={barW - 1} height={barH}
                            fill={expiryColors.get(b.exp)} opacity={0.25} rx={1} />
                        );
                      });
                    })}

                    {/* Price lines + data points with price labels */}
                    {priceLines.map(({ exp, points, pts }) => (
                      <g key={exp}>
                        <polyline points={points} fill="none" stroke={expiryColors.get(exp)} strokeWidth="1.2" strokeLinejoin="round" />
                        {pts.map((p, k) => (
                          <g key={k}>
                            <circle cx={p.x} cy={p.y} r={1.5} fill={expiryColors.get(exp)} />
                            <text x={p.x} y={p.y - 4} textAnchor="middle" fontSize="4" fill={expiryColors.get(exp)}>
                              ₹{p.price < 10 ? p.price.toFixed(1) : Math.round(p.price)}
                            </text>
                          </g>
                        ))}
                      </g>
                    ))}

                    {/* Average price line */}
                    {(() => {
                      const allPrices = priceLines.flatMap((l) => l.pts.map((p) => p.price));
                      if (allPrices.length === 0) return null;
                      const avg = allPrices.reduce((s, v) => s + v, 0) / allPrices.length;
                      const avgY = PAD_T + plotH - (avg / safeMaxPrice) * plotH;
                      return (
                        <g>
                          <line x1={PAD_L} y1={avgY} x2={W - PAD_R} y2={avgY} stroke="var(--text-secondary)" strokeWidth="0.5" strokeDasharray="3,2" opacity="0.6" />
                          <text x={PAD_L - 4} y={avgY + 2} textAnchor="end" fontSize="5" fill="var(--text-secondary)" opacity="0.7">avg</text>
                        </g>
                      );
                    })()}

                    {/* Left axis labels (price) */}
                    {[0, 0.5, 1].map((frac) => (
                      <text key={frac} x={PAD_L - 4} y={PAD_T + plotH * (1 - frac) + 3} textAnchor="end" fontSize="6" fill="var(--text-secondary)">
                        ₹{Math.round(safeMaxPrice * frac)}
                      </text>
                    ))}

                    {/* Right axis labels (OI) */}
                    {[0, 0.5, 1].map((frac) => (
                      <text key={frac} x={W - PAD_R + 4} y={PAD_T + plotH * (1 - frac) + 3} textAnchor="start" fontSize="6" fill="var(--text-secondary)">
                        {formatOiCompact(Math.round(maxOi * frac))}
                      </text>
                    ))}

                    {/* X-axis date labels */}
                    {dates.map((d, i) => {
                      const x = PAD_L + (i + 0.5) * (plotW / n);
                      return (
                        <text key={d} x={x} y={H - 4} textAnchor="middle" fontSize="5.5" fill="var(--text-secondary)">
                          {d.slice(5)}
                        </text>
                      );
                    })}
                  </svg>
                </div>
              );
            })()}

            {/* PE Chart */}
            {(() => {
              const W = 700, H = 150, PAD_L = 50, PAD_R = 50, PAD_T = 16, PAD_B = 18;
              const plotW = W - PAD_L - PAD_R;
              const plotH = H - PAD_T - PAD_B;
              const { dates, dateMap, maxOi, maxPePrice } = chartData;
              const n = dates.length;
              if (n === 0 || maxOi === 0) return null;
              const barW = Math.min(plotW / n * 0.4, 10);
              const safeMaxPrice = maxPePrice || 1;

              const priceLines = visibleTableExpiries.map((exp) => {
                const pts: { x: number; y: number; price: number; date: string }[] = [];
                dates.forEach((d, i) => {
                  const x = PAD_L + (i + 0.5) * (plotW / n);
                  const entry = dateMap.get(d)?.get(exp);
                  if (entry && entry.peClose > 0) {
                    const y = PAD_T + plotH - (entry.peClose / safeMaxPrice) * plotH;
                    pts.push({ x, y, price: entry.peClose, date: d });
                  }
                });
                return { exp, pts, points: pts.map((p) => `${p.x},${p.y}`).join(' ') };
              }).filter((l) => l.pts.length > 0);

              return (
                <div className="oi-history__chart-panel">
                  <div className="oi-history__chart-label oi-history__chart-label--pe">PE</div>
                  <svg viewBox={`0 0 ${W} ${H}`} className="oi-history__chart-svg">
                    {[0.25, 0.5, 0.75].map((frac) => (
                      <line key={frac} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH * (1 - frac)} y2={PAD_T + plotH * (1 - frac)} stroke="var(--card-border)" strokeWidth="0.5" />
                    ))}
                    {/* X-axis baseline */}
                    <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="var(--text-secondary)" strokeWidth="0.5" opacity="0.5" />

                    {dates.map((d, i) => {
                      const x = PAD_L + (i + 0.5) * (plotW / n);
                      const expiryBars = visibleTableExpiries
                        .map((exp) => ({ exp, oi: dateMap.get(d)?.get(exp)?.peOi || 0 }))
                        .filter((b) => b.oi > 0);
                      const totalBarW = barW * expiryBars.length;
                      return expiryBars.map((b, j) => {
                        const barH = (b.oi / maxOi) * plotH;
                        const bx = x - totalBarW / 2 + j * barW;
                        return (
                          <rect key={`${d}-${b.exp}`} x={bx} y={PAD_T + plotH - barH} width={barW - 1} height={barH}
                            fill={expiryColors.get(b.exp)} opacity={0.25} rx={1} />
                        );
                      });
                    })}

                    {/* Price lines + data points with price labels */}
                    {priceLines.map(({ exp, points, pts }) => (
                      <g key={exp}>
                        <polyline points={points} fill="none" stroke={expiryColors.get(exp)} strokeWidth="1.2" strokeLinejoin="round" />
                        {pts.map((p, k) => (
                          <g key={k}>
                            <circle cx={p.x} cy={p.y} r={1.5} fill={expiryColors.get(exp)} />
                            <text x={p.x} y={p.y - 4} textAnchor="middle" fontSize="4" fill={expiryColors.get(exp)}>
                              ₹{p.price < 10 ? p.price.toFixed(1) : Math.round(p.price)}
                            </text>
                          </g>
                        ))}
                      </g>
                    ))}

                    {/* Average price line */}
                    {(() => {
                      const allPrices = priceLines.flatMap((l) => l.pts.map((p) => p.price));
                      if (allPrices.length === 0) return null;
                      const avg = allPrices.reduce((s, v) => s + v, 0) / allPrices.length;
                      const avgY = PAD_T + plotH - (avg / safeMaxPrice) * plotH;
                      return (
                        <g>
                          <line x1={PAD_L} y1={avgY} x2={W - PAD_R} y2={avgY} stroke="var(--text-secondary)" strokeWidth="0.5" strokeDasharray="3,2" opacity="0.6" />
                          <text x={PAD_L - 4} y={avgY + 2} textAnchor="end" fontSize="5" fill="var(--text-secondary)" opacity="0.7">avg</text>
                        </g>
                      );
                    })()}

                    {[0, 0.5, 1].map((frac) => (
                      <text key={frac} x={PAD_L - 4} y={PAD_T + plotH * (1 - frac) + 3} textAnchor="end" fontSize="6" fill="var(--text-secondary)">
                        ₹{Math.round(safeMaxPrice * frac)}
                      </text>
                    ))}

                    {[0, 0.5, 1].map((frac) => (
                      <text key={frac} x={W - PAD_R + 4} y={PAD_T + plotH * (1 - frac) + 3} textAnchor="start" fontSize="6" fill="var(--text-secondary)">
                        {formatOiCompact(Math.round(maxOi * frac))}
                      </text>
                    ))}

                    {dates.map((d, i) => {
                      const x = PAD_L + (i + 0.5) * (plotW / n);
                      return (
                        <text key={d} x={x} y={H - 4} textAnchor="middle" fontSize="5.5" fill="var(--text-secondary)">
                          {d.slice(5)}
                        </text>
                      );
                    })}
                  </svg>
                </div>
              );
            })()}
          </div>

          {/* Legend */}
          <div className="oi-history__chart-legend">
            {tableExpiries.map((exp) => {
              const isHidden = hiddenExpiries.has(exp);
              return (
              <button
                key={exp}
                type="button"
                className={`oi-history__chart-legend-item ${isHidden ? 'oi-history__chart-legend-item--hidden' : ''}`}
                onClick={() => toggleExpiryVisibility(exp)}
                aria-pressed={!isHidden}
                title={`${isHidden ? 'Show' : 'Hide'} ${expiryLabel(exp, isMonthlyExpiry(exp))} in table and chart`}
              >
                <span className="oi-history__chart-legend-swatch" style={{ background: expiryColors.get(exp) }} />
                {expiryLabel(exp, isMonthlyExpiry(exp))}
              </button>
              );
            })}
            <span className="oi-history__chart-legend-item">
              <span className="oi-history__chart-legend-bar" /> OI
            </span>
          </div>
            </>
          )}

          {analysisTab === 'setup' && (
        <div className={`oi-history__setup-card oi-history__setup-card--${chartData.tradeSetup.status.toLowerCase()}`}>
          <div className="oi-history__setup-header">
            <div>
              <span className="oi-history__bias-kicker">Trade setup engine</span>
              <strong className="oi-history__decision-title">{chartData.tradeSetup.title}</strong>
              <span className="oi-history__bias-reason">Direction: {chartData.tradeSetup.direction}</span>
            </div>
            <span className={`oi-history__setup-pill oi-history__setup-pill--${chartData.tradeSetup.status.toLowerCase()}`}>
              {chartData.tradeSetup.status}
            </span>
          </div>

          <div className="oi-history__setup-context">
            <div className={`oi-history__setup-context-item oi-history__setup-context-item--${chartData.tradeBias.bias.toLowerCase()}`}>
              <span>Trade bias</span>
              <strong>{chartData.tradeBias.title}</strong>
              <em>{chartData.tradeBias.action} {chartData.tradeBias.reason}</em>
            </div>
            <div className={`oi-history__setup-context-item oi-history__setup-context-item--${chartData.priceTrend.direction.toLowerCase()}`}>
              <span>Price trend</span>
              <strong>{chartData.priceTrend.direction} - {chartData.priceTrend.strength}</strong>
              <em>
                {chartData.priceTrend.reason} Start {chartData.priceTrend.startPrice !== null ? chartData.priceTrend.startPrice.toFixed(2) : '-'} | End {chartData.priceTrend.endPrice !== null ? chartData.priceTrend.endPrice.toFixed(2) : '-'} | Change {formatPct(chartData.priceTrend.changePct)} | Recent {formatPct(chartData.priceTrend.recentChangePct)} | Sessions {chartData.priceTrend.sessions}
              </em>
            </div>
            <div className={`oi-history__setup-context-item oi-history__setup-context-item--${chartData.biasSummary.bias.toLowerCase()}`}>
              <span>Option flow</span>
              <strong>{chartData.biasSummary.bias} - {chartData.biasSummary.strength}</strong>
              <em>
                {chartData.biasSummary.reason} Confidence {chartData.biasSummary.confidence}% | Days {chartData.biasSummary.bullishDays}/{chartData.biasSummary.bearishDays}/{chartData.biasSummary.neutralDays} | CE OI {formatPct(chartData.biasSummary.ceOiChangePct)} | PE OI {formatPct(chartData.biasSummary.peOiChangePct)} | PCR {formatPcr(chartData.biasSummary.pcrStart)} -&gt; {formatPcr(chartData.biasSummary.pcrEnd)} | Score {chartData.biasSummary.score}
              </em>
            </div>
          </div>

          <div className="oi-history__setup-details">
            <div>
              <span>Recent 3-session lean</span>
              <strong className={`oi-history__bias-text--${chartData.biasSummary.recentBias.toLowerCase()}`}>
                {chartData.biasSummary.recentBias} ({chartData.biasSummary.recentScore > 0 ? '+' : ''}{chartData.biasSummary.recentScore})
              </strong>
            </div>
            <div>
              <span>Main driver</span>
              <strong>{chartData.biasSummary.driver}</strong>
            </div>
            <div>
              <span>Visible expiries</span>
              <strong>{visibleTableExpiries.map((exp) => expiryLabel(exp, isMonthlyExpiry(exp))).join(', ')}</strong>
            </div>
            {chartData.biasSummary.warning && (
              <div className="oi-history__bias-warning">
                <span>Watch</span>
                <strong>{chartData.biasSummary.warning}</strong>
              </div>
            )}
          </div>

          {chartData.biasSummary.recentDays.length > 0 && (
            <div className="oi-history__bias-recent">
              <span className="oi-history__bias-detail-title">Recent daily breakdown</span>
              <div className="oi-history__bias-recent-grid">
                {chartData.biasSummary.recentDays.map((day) => (
                  <div key={day.date} className="oi-history__bias-recent-row">
                    <span>{day.date.slice(5)}</span>
                    <span>{day.cePattern}</span>
                    <span>{day.pePattern}</span>
                    <strong className={`oi-history__bias-text--${day.bias.toLowerCase()}`}>
                      {day.bias} ({day.score > 0 ? '+' : ''}{day.score})
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="oi-history__setup-checklist">
            {chartData.tradeSetup.checklist.map((item) => (
              <div key={item.label} className={`oi-history__setup-check oi-history__setup-check--${item.status}`}>
                <span>{item.label}</span>
                <strong>{checklistStatusText(item.status)}</strong>
                <em>{item.answer}</em>
              </div>
            ))}
          </div>

          <div className="oi-history__setup-plan">
            <div>
              <span>Action</span>
              <strong>{chartData.tradeSetup.action}</strong>
            </div>
            <div>
              <span>Strategy</span>
              <strong>{chartData.tradeSetup.strategy}</strong>
            </div>
            <div>
              <span>Trigger</span>
              <strong>{chartData.tradeSetup.trigger}</strong>
            </div>
            <div>
              <span>Invalidation</span>
              <strong>{chartData.tradeSetup.invalidation}</strong>
            </div>
            <div>
              <span>Target</span>
              <strong>{chartData.tradeSetup.target}</strong>
            </div>
            <div>
              <span>Sizing</span>
              <strong>{chartData.tradeSetup.sizing}</strong>
            </div>
          </div>
        </div>
          )}
        </div>
      )}

      {data.length === 0 && !loading && !fetching && (
        <div className="oi-history__empty card">
          Select an expiry month and click <strong>Fetch</strong> to download OI history up to today.
          Already-fetched trading days for that expiry month are skipped automatically.
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="oi-confirm-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="oi-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h4 className="oi-confirm-modal__title">Delete Script Data</h4>
            <p className="oi-confirm-modal__text">
              Delete ALL OI history data for <strong>{scripOptions.find((o) => o.value === scrip)?.label || scrip}</strong>? This cannot be undone.
            </p>
            <div className="oi-confirm-modal__actions">
              <button className="app-btn app-btn--secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="app-btn app-btn--danger" onClick={handleDeleteMonth}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OiHistory;
