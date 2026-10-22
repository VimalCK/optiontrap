import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { handleKiteAuthFailure, isKiteAuthFailure } from '@/services/authSession';
import { apiClient, isAbortError } from '@/services/apiClient';
import { useAbortSignal } from '@/hooks/useAbortSignal';
import AppSelect from '@/components/AppSelect/AppSelect';
import { addPosition } from '@/services/positions';
import { getLotSize } from '@/services/optionChain';
import { fetchQuotes } from '@/services/kiteApi';
import { loadInstruments, getLotSizeByToken } from '@/services/instruments';
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

interface FuturesHistoryRow {
  date: string;
  instrumentToken: number;
  tradingsymbol: string;
  expiry: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  oi: number;
}

interface FetchProgress {
  step: string;
  pct: number;
  detail: string;
}

interface SignalPerformanceSummary {
  total: number;
  open: number;
  averageOpenReturn: number | null;
  evaluated: number;
  wins: number;
  winRate: number | null;
  averageReturn: number | null;
  averageMaxFavorable: number | null;
  averageMaxAdverse: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  profitFactor: number | null;
  sellEvaluated: number;
  sellWinRate: number | null;
  buyEvaluated: number;
  buyWinRate: number | null;
  optionBreakdown: Array<{ label: string; evaluated: number; winRate: number | null; averageReturn: number | null }>;
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

type SellingSetupType = 'Call Sell' | 'Put Sell' | 'Range Sell' | 'No Sell';

interface SellingSetupSummary {
  status: TradeSetupStatus;
  type: SellingSetupType;
  title: string;
  action: string;
  trigger: string;
  invalidation: string;
  target: string;
  sizing: string;
  checklist: TradeSetupChecklistItem[];
}

interface StrikeHistoryEntry {
  ceOi: number;
  peOi: number;
  ceClose: number;
  peClose: number;
  ceVolume: number;
  peVolume: number;
}

interface PremiumDecaySide {
  optionType: 'CE' | 'PE';
  firstClose: number;
  latestClose: number;
  decayPct: number;
  recentDecayPct: number | null;
  latestOi: number;
  oiChangePct: number | null;
  latestVolume: number;
  averageVolume: number;
  daysToExpiry: number | null;
  score: number;
  reason: string;
}

interface PremiumDecaySummary {
  nearestExpiry: string | null;
  ce: PremiumDecaySide | null;
  pe: PremiumDecaySide | null;
}

interface OptionMomentumSide {
  optionType: 'CE' | 'PE';
  firstClose: number;
  latestClose: number;
  momentumPct: number;
  recentMomentumPct: number | null;
  oiChangePct: number | null;
  latestVolume: number;
  averageVolume: number;
  daysToExpiry: number | null;
  score: number;
  reason: string;
}

interface OptionMomentumSummary {
  nearestExpiry: string | null;
  ce: OptionMomentumSide | null;
  pe: OptionMomentumSide | null;
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

function addMonths(month: string, delta: number): string {
  const [year, monthIndex] = month.split('-').map(Number);
  const date = new Date(year, monthIndex - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Format a month string (YYYY-MM) to label (e.g., "July 2026") */
/** Price line colours per futures month, nearest first (OI/volume bars use purple/cyan). */
const FUTURES_LINE_COLORS = ['#22c55e', '#f59e0b', '#ec4899', '#3b82f6'];

/** Daily price/OI changes and signal for one futures contract's history. */
function buildFuturesSeries(contractRows: FuturesHistoryRow[]) {
  const sorted = [...contractRows].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((row, index) => {
    const previous = sorted[index - 1];
    const priceChangePct = previous?.close > 0 ? ((row.close - previous.close) / previous.close) * 100 : null;
    const oiChangePct = previous?.oi > 0 ? ((row.oi - previous.oi) / previous.oi) * 100 : null;
    const averageVolume = sorted.slice(Math.max(0, index - 5), index).map((item) => item.volume).filter((value) => value > 0);
    const avgVolume = averageVolume.length ? averageVolume.reduce((sum, value) => sum + value, 0) / averageVolume.length : null;
    let interpretation = 'New data';
    if (priceChangePct !== null && oiChangePct !== null) {
      if (priceChangePct >= 0 && oiChangePct >= 0) interpretation = 'Long buildup';
      else if (priceChangePct < 0 && oiChangePct >= 0) interpretation = 'Short buildup';
      else if (priceChangePct < 0 && oiChangePct < 0) interpretation = 'Long unwinding';
      else interpretation = 'Short covering';
    }
    return { ...row, priceChangePct, oiChangePct, avgVolume, interpretation };
  });
}

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

function sortChecklistByStatus(items: TradeSetupChecklistItem[]): TradeSetupChecklistItem[] {
  const order: Record<ChecklistStatus, number> = { pass: 0, warn: 1, fail: 2 };
  return [...items].sort((a, b) => order[a.status] - order[b.status]);
}

function readinessScore(items: TradeSetupChecklistItem[]): number {
  if (items.length === 0) return 0;
  const score = items.reduce((sum, item) => {
    if (item.status === 'pass') return sum + 1;
    if (item.status === 'warn') return sum + 0.5;
    return sum;
  }, 0);
  return Math.round((score / items.length) * 100);
}

function setupReadinessLabel(status: TradeSetupStatus, score: number): string {
  if (status === 'Avoid') return 'No setup';
  return `${score}%`;
}

function setupReadinessWidth(status: TradeSetupStatus, score: number): string {
  if (status === 'Avoid') return '0%';
  return `${score}%`;
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

function summarizeOptionMomentum(
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

function summarizeTradeSetup(
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

function summarizePremiumDecay(
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

function summarizeSellingSetup(
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

/**
 * Build the set of monthly expiries from a list of expiry dates.
 * A monthly expiry is the last (latest) expiry within its calendar month.
 * This is data-driven and robust to exchange weekday changes (Thu → Tue, etc.).
 */
function computeMonthlyExpiries(allExpiries: string[]): Set<string> {
  const lastPerMonth = new Map<string, string>();
  for (const exp of allExpiries) {
    const key = exp.slice(0, 7); // YYYY-MM
    const cur = lastPerMonth.get(key);
    if (!cur || exp > cur) lastPerMonth.set(key, exp);
  }
  return new Set(lastPerMonth.values());
}

interface ChartXAxisProps {
  dates: string[];
  padL: number;
  plotW: number;
  h: number;
}

/**
 * X-axis for the OI Price History chart: renders day-of-month numbers on top
 * and a colored month band with month-name labels underneath, so the axis
 * doesn't get crowded even when spanning many days across months.
 */
const ChartXAxis: React.FC<ChartXAxisProps> = ({ dates, padL, plotW, h }) => {
  const n = dates.length;
  if (n === 0) return null;
  const stepX = plotW / n;
  const centerX = (i: number) => padL + (i + 0.5) * stepX;

  // Group contiguous dates by month (they arrive sorted ascending).
  const groups: { month: string; startIdx: number; endIdx: number }[] = [];
  dates.forEach((d, i) => {
    const month = d.slice(0, 7);
    const last = groups[groups.length - 1];
    if (!last || last.month !== month) groups.push({ month, startIdx: i, endIdx: i });
    else last.endIdx = i;
  });

  return (
    <g>
      {/* Day-of-month labels */}
      {dates.map((d, i) => (
        <text key={d} x={centerX(i)} y={h - 20} textAnchor="middle" fontSize="5.5" fill="var(--text-secondary)">
          {d.slice(8)}
        </text>
      ))}

      {/* Month markers: small vertical ticks on the x-axis at the start and
          end of each month, plus the month name. No horizontal band, so it
          doesn't compete with the coloured expiry lines above. */}
      {groups.map((g) => {
        const startX = padL + g.startIdx * stepX;
        const endX = padL + (g.endIdx + 1) * stepX;
        const midX = (startX + endX) / 2;
        const [year, monthNum] = g.month.split('-').map(Number);
        const label = new Date(year, monthNum - 1, 1).toLocaleDateString('en-US', { month: 'short' });
        return (
          <g key={g.month}>
            <line
              x1={startX}
              x2={startX}
              y1={h - 30}
              y2={h - 24}
              stroke="var(--text-secondary)"
              strokeWidth="0.5"
              strokeLinecap="round"
              opacity={0.5}
            />
            <line
              x1={endX}
              x2={endX}
              y1={h - 30}
              y2={h - 24}
              stroke="var(--text-secondary)"
              strokeWidth="0.5"
              strokeLinecap="round"
              opacity={0.5}
            />
            <text
              x={midX}
              y={h - 8}
              textAnchor="middle"
              fontSize="5.5"
              fontWeight={700}
              fill="var(--text-secondary)"
            >
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
};

const OiHistory: React.FC = () => {
  const navigate = useNavigate();
  // Cancels this tab's in-flight requests when the user navigates away.
  const pageSignal = useAbortSignal();
  const [scrip, setScrip] = useState('NIFTY50');
  const [selectedExpiryMonth, setSelectedExpiryMonth] = useState(currentMonthIST());
  const [fetching, setFetching] = useState(false);
  const lastFetchedRef = useRef('');
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [fetchResult, setFetchResult] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [data, setData] = useState<OiHistoryRow[]>([]);
  const [futuresData, setFuturesData] = useState<FuturesHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterDate, setFilterDate] = useState('');
  const [showPatternInfo, setShowPatternInfo] = useState(false);
  const [showFuturesInfo, setShowFuturesInfo] = useState(false);
  const [futuresView, setFuturesView] = useState<'table' | 'chart'>('table');
  const [futuresHover, setFuturesHover] = useState<{ date: string; x: number; oi: number; volume: number; closes: { label: string; color: string; close: number }[] } | null>(null);
  const [analysisTab, setAnalysisTab] = useState<'history' | 'setup'>('history');
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [signalPerformance, setSignalPerformance] = useState<SignalPerformanceSummary | null>(null);
  const [outcomeRefreshVersion, setOutcomeRefreshVersion] = useState(0);
  const loggedSignalKeysRef = useRef(new Set<string>());
  const [hiddenExpiries, setHiddenExpiries] = useState<Set<string>>(() => new Set());
  const [showVolume, setShowVolume] = useState(false);
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
    return [-1, 0, 5, 10, 20].includes(val) ? val : 10;
  });
  const [specificStrike, setSpecificStrike] = useState<string>(() => localStorage.getItem('optiontrap_specific_strike') || '');
  const specificStrikeValue = useMemo(() => {
    const value = Number(specificStrike);
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [specificStrike]);

  // Warm the instruments cache so lot sizes are available for setup trades.
  useEffect(() => {
    loadInstruments().catch(() => { /* lot size falls back to 1 if unavailable */ });
  }, []);

  // Fetch available future expiry months for the selected scrip from instruments
  useEffect(() => {
    const current = currentMonthIST();
    let stale = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setFetchError(null);
    const requestMonths = () => apiClient.get<{ status: string; months?: string[]; message?: string }>(`/api/oi-history/expiry-months?scrip=${scrip}`, { signal: pageSignal });
    // Retry once: on the first login of the day the server may still be building
    // its instruments cache, and a transient failure would otherwise leave only
    // the current month in the dropdown.
    requestMonths()
      .catch((err) => {
        if (isAbortError(err) || stale) throw err;
        return new Promise<void>((resolve) => { retryTimer = setTimeout(resolve, 3000); })
          .then(() => {
            if (stale) throw new DOMException('Superseded', 'AbortError');
            return requestMonths();
          });
      })
      .then((json) => {
        if (stale) return;
        if (json.status === 'ok') {
          const months: string[] = json.months || [];
          if (months.length > 0) {
            const selectableMonths = months.filter((month) => month >= current);
            const selectedMonths = selectableMonths.length > 0 ? selectableMonths : [current];
            const options = months.map((m) => ({ value: m, label: formatMonthLabel(m) }));
            setExpiryMonthOptions(options);
            setSelectedExpiryMonth((prev) => selectedMonths.includes(prev) ? prev : selectedMonths[0]);
          } else {
            setExpiryMonthOptions([{ value: current, label: formatMonthLabel(current) }]);
            setSelectedExpiryMonth(current);
          }
        } else {
          throw new Error(json.message || 'Failed to load expiry months');
        }
      })
      .catch((err) => {
        if (isAbortError(err) || stale) return;
        setExpiryMonthOptions([{ value: current, label: formatMonthLabel(current) }]);
        setSelectedExpiryMonth(current);
        setFetchError(err instanceof Error ? err.message : 'Failed to load expiry months');
      });
    return () => {
      // A newer scrip's request supersedes this one.
      stale = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [scrip]);

  // Fetch available F&O symbols on mount
  useEffect(() => {
    apiClient.get<string[]>('/api/fno-symbols', { signal: pageSignal })
      .then((symbols) => {
        if (symbols.length > 0) {
          const options = symbols.map((name: string) => ({
            value: name === 'NIFTY' ? 'NIFTY50' : name,
            label: name === 'NIFTY' ? 'NIFTY 50' : name === 'BANKNIFTY' ? 'BANK NIFTY' : name,
          }));
          setScripOptions(options);
        }
      })
      .catch(() => { /* keep defaults */ });
  }, []);

  const selectableExpiryMonthOptions = useMemo(() => {
    const current = currentMonthIST();
    const options = expiryMonthOptions.filter((option) => option.value >= current);
    return options.length > 0 ? options : [{ value: current, label: formatMonthLabel(current) }];
  }, [expiryMonthOptions]);

  /** Expiry months to include: only M-1 from history, then current month through selected month. */
  const includedExpiryMonths = useMemo(() => {
    const current = currentMonthIST();
    const previous = addMonths(current, -1);
    return expiryMonthOptions
      .map((o) => o.value)
      .filter((m) => m === previous || (m >= current && m <= selectedExpiryMonth))
      .sort();
  }, [expiryMonthOptions, selectedExpiryMonth]);

  /** Only current/future expiry months can be fetched from the current instruments cache. */
  const fetchableExpiryMonths = useMemo(() => {
    const current = currentMonthIST();
    return includedExpiryMonths.filter((month) => month >= current);
  }, [includedExpiryMonths]);

  /** Load stored data from server — includes M-1 if stored, then current month through selected month. */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all(
        includedExpiryMonths.map(async (month) => {
          const params = new URLSearchParams({ scrip, expiryMonth: month });
          return apiClient.get<OiHistoryRow[]>(`/api/oi-history?${params}`, { signal: pageSignal });
        }),
      );
      // Futures follow the same current-through-selected month range as the OI Snapshot.
      const futuresResults = await Promise.all(
        fetchableExpiryMonths.map(async (month) => {
          const futuresParams = new URLSearchParams({ scrip, expiryMonth: month });
          return apiClient.get<FuturesHistoryRow[]>(`/api/oi-history/futures?${futuresParams}`, { signal: pageSignal });
        }),
      );
      const merged = results.flat();
      setData(merged);
      setFuturesData(futuresResults.flat());
      if (merged.length > 0) {
        const dates = [...new Set(merged.map((r) => r.date))].sort();
        const current = currentMonthIST();
        const visibleDates = dates.filter((date) => date.slice(0, 7) >= current);
        setFilterDate((visibleDates[visibleDates.length - 1] || dates[dates.length - 1]) as string);
      }
    } catch (err) {
      if (!isAbortError(err)) console.error('[OiHistory] Load error:', err);
    } finally {
      setLoading(false);
    }
  }, [scrip, includedExpiryMonths, fetchableExpiryMonths, pageSignal]);

  /** Stream a single expiry-month fetch from Kite via SSE. Returns on stream end. */
  const fetchExpiryMonth = useCallback(async (month: string, monthLabel: string) => {
    const res = await apiClient.raw('/api/oi-history/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        scrip,
        expiryMonth: month,
        strikeMode: strikeRange === -1 ? 'specific' : strikeRange === 0 ? 'allStored' : 'atmRange',
        specificStrike: strikeRange === -1 ? specificStrikeValue : undefined,
      },
      signal: pageSignal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `Server error (${res.status})`);
    }
    if (!res.body) {
      throw new Error('Server returned an empty response');
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
  }, [scrip, strikeRange, specificStrikeValue, pageSignal]);

  /** Fetch current/future included expiry months from Kite. Historical months are loaded from DB only. */
  const handleFetch = useCallback(async () => {
    if (strikeRange === -1 && specificStrikeValue === null) {
      setFetchError('Enter a valid strike to fetch specific OI history.');
      return;
    }

    if (fetchableExpiryMonths.length === 0) {
      setFetchResult('Selected month is historical only. Stored database data is already loaded.');
      return;
    }

    setFetching(true);
    setProgress({ step: 'Connecting...', pct: 0, detail: '' });
    setFetchResult(null);
    setFetchError(null);

    try {
      for (const month of fetchableExpiryMonths) {
        const label = formatMonthShortLabel(month);
        await fetchExpiryMonth(month, label);
      }
      setProgress(null);
    } catch (err) {
      if (isAbortError(err)) return;
      const message = err instanceof Error ? err.message : 'Network error';
      if (isKiteAuthFailure(message)) {
        handleKiteAuthFailure();
        navigate('/login', { replace: true });
      } else {
        setFetchError(message);
      }
      setProgress(null);
    } finally {
      setFetching(false);
      if (!pageSignal.aborted) loadData();
    }
  }, [fetchableExpiryMonths, fetchExpiryMonth, loadData, navigate, strikeRange, specificStrikeValue, pageSignal]);

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
  const [confirmCleanOld, setConfirmCleanOld] = useState(false);
  const [isDataMenuOpen, setIsDataMenuOpen] = useState(false);
  const dataMenuRef = useRef<HTMLDivElement | null>(null);
  const cleanupCutoffMonth = addMonths(currentMonthIST(), -1);
  const cleanupCutoffLabel = formatMonthLabel(cleanupCutoffMonth);

  useEffect(() => {
    if (!isDataMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!dataMenuRef.current?.contains(event.target as Node)) {
        setIsDataMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDataMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDataMenuOpen]);

  const handleDeleteMonth = useCallback(async () => {
    setConfirmDelete(false);

    try {
      const params = new URLSearchParams({ scrip });
      const json = await apiClient.delete<{ status: string; message?: string }>(`/api/oi-history?${params}`);
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

  const handleCleanOld = useCallback(async () => {
    setConfirmCleanOld(false);
    setFetchResult(null);
    setFetchError(null);

    try {
      const params = new URLSearchParams({ scrip, beforeExpiryMonth: cleanupCutoffMonth });
      const json = await apiClient.delete<{ status: string; deleted?: number; message?: string }>(`/api/oi-history/old?${params}`);
      if (json.status === 'ok') {
        const deleted = Number(json.deleted || 0);
        setFetchResult(deleted > 0
          ? `Deleted ${deleted} old OI history row(s) before ${cleanupCutoffLabel}.`
          : `No old OI history rows found before ${cleanupCutoffLabel}.`);
        lastFetchedRef.current = '';
        loadData();
      } else {
        setFetchError(json.message || 'Failed to clean old data');
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Network error');
    }
  }, [scrip, cleanupCutoffMonth, cleanupCutoffLabel, loadData]);

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
    const historicalClose = optionType === 'CE' ? cell.ceClose : cell.peClose;

    if (!token || !tradingsymbol || !historicalClose) return;

    try {
      // Enter at the current live/last-traded price so the position opens near
      // break-even, rather than the historical close from the OI-history grid
      // (which can differ materially from the current market price).
      let entryPrice = historicalClose;
      try {
        const quotes = await fetchQuotes([`NFO:${tradingsymbol}`]);
        const ltp = quotes.get(`NFO:${tradingsymbol}`)?.last_price;
        if (ltp && ltp > 0) entryPrice = ltp;
      } catch {
        // Quote unavailable — fall back to the historical close.
      }

      await addPosition({
        tradingsymbol,
        instrumentToken: token,
        strike,
        optionType,
        side,
        quantity: getLotSizeByToken(token) ?? getLotSize(token),
        entryPrice,
        expiry,
      });
      showToast(`${side} ${strike}${optionType} @ ₹${entryPrice.toFixed(2)}`, 'green');
    } catch {
      showToast('Failed to add position', 'red');
    }
  }, [showToast]);

  /** Unique dates in the loaded data */
  const availableDates = useMemo(() => {
    return [...new Set(data.map((r) => r.date))].sort();
  }, [data]);

  const visibleDates = useMemo(() => {
    return availableDates.filter((date) => date.slice(0, 7) >= currentMonthIST());
  }, [availableDates]);

  /** Dates grouped by month (YYYY-MM) for a clearer date bar */
  const datesByMonth = useMemo(() => {
    const groups: { month: string; dates: string[] }[] = [];
    let current: { month: string; dates: string[] } | null = null;
    for (const d of visibleDates) {
      const month = d.slice(0, 7);
      if (!current || current.month !== month) {
        current = { month, dates: [] };
        groups.push(current);
      }
      current.dates.push(d);
    }
    return groups;
  }, [visibleDates]);

  /** Unique expiries in the loaded data for the selected expiry month, sorted */
  const expiries = useMemo(() => {
    const set = new Set<string>();
    for (const r of data) {
      if (r.expiry) set.add(r.expiry);
    }
    return [...set].sort();
  }, [data]);

  const monthlyExpirySet = useMemo(() => computeMonthlyExpiries(expiries), [expiries]);
  const isMonthlyExpiry = useCallback(
    (expiry: string) => monthlyExpirySet.has(expiry),
    [monthlyExpirySet],
  );

  /** Mark only actual contract expiry dates; weekdays can vary around holidays. */
  const expiryMarkerDates = useMemo(() => new Set(expiries), [expiries]);

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
    if (strikeRange === -1 && specificStrikeValue !== null) {
      setSelectedStrike(specificStrikeValue);
      return;
    }
    if (atmStrike) {
      setSelectedStrike(atmStrike);
    }
  }, [atmStrike, strikeRange, specificStrikeValue]);

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

    if (strikeRange === -1) {
      return specificStrikeValue === null ? [] : rows.filter((row) => row.strike === specificStrikeValue);
    }

    // Limit strikes around ATM based on selected range
    if (strikeRange > 0 && atmStrike && rows.length > 0) {
      const atmIdx = rows.findIndex((r) => r.strike >= atmStrike);
      const center = atmIdx >= 0 ? atmIdx : Math.floor(rows.length / 2);
      const start = Math.max(0, center - strikeRange);
      const end = Math.min(rows.length, center + strikeRange + 1);
      return rows.slice(start, end);
    }

    return rows;
  }, [filteredRows, visibleTableExpiries, prevDayOi, prevDayClose, scrip, atmStrike, strikeRange, specificStrikeValue]);

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
    if (strikeRange === -1) return;
    if (tableData.some((r) => r.strike === selectedStrike)) return;
    if (atmStrike && tableData.some((r) => r.strike === atmStrike)) {
      setSelectedStrike(atmStrike);
    } else {
      setSelectedStrike(null);
    }
  }, [tableData, selectedStrike, atmStrike, strikeRange]);

  /** Chart data for selected strike across all dates */
  const chartData = useMemo(() => {
    if (!selectedStrike || availableDates.length === 0 || visibleTableExpiries.length === 0) return null;

    // Group data by date+expiry for the selected strike
    const dateMap = new Map<string, Map<string, StrikeHistoryEntry>>();
    const spotByDate = new Map<string, number>();
    const tableExpirySet = new Set(visibleTableExpiries);

    for (const r of data) {
      if (r.strike !== selectedStrike || !r.expiry || !tableExpirySet.has(r.expiry)) continue;
      if (r.spotClose > 0) spotByDate.set(r.date, r.spotClose);
      if (!dateMap.has(r.date)) dateMap.set(r.date, new Map());
      const expMap = dateMap.get(r.date)!;
      if (!expMap.has(r.expiry)) {
        expMap.set(r.expiry, {
          ceOi: 0,
          peOi: 0,
          ceClose: 0,
          peClose: 0,
          ceVolume: 0,
          peVolume: 0,
        });
      }
      const entry = expMap.get(r.expiry)!;
      if (r.optionType === 'CE') {
        entry.ceOi = r.oi;
        entry.ceClose = r.close;
        entry.ceVolume = r.volume;
      } else {
        entry.peOi = r.oi;
        entry.peClose = r.close;
        entry.peVolume = r.volume;
      }
    }

    const dates = availableDates.filter((d) => dateMap.has(d));
    if (dates.length === 0) return null;
    const biasSummary = summarizeStrikeBias(dates, dateMap, visibleTableExpiries, spotByDate);
    const priceTrend = summarizePriceTrend(dates, spotByDate);
    const tradeBias = summarizeTradeBias(priceTrend, biasSummary);
    const latestSpot = priceTrend.endPrice ?? selectedSpotClose;
    const tradeLevels = summarizeTradeLevels(tableData, latestSpot, selectedStrike);
    const optionMomentum = summarizeOptionMomentum(dates, dateMap, visibleTableExpiries, priceTrend, tradeLevels);
    const premiumDecay = summarizePremiumDecay(dates, dateMap, visibleTableExpiries, priceTrend, tradeLevels);
    const tradeSetup = summarizeTradeSetup(priceTrend, biasSummary, selectedStrike, tradeLevels, optionMomentum);
    const sellingSetup = summarizeSellingSetup(priceTrend, biasSummary, selectedStrike, tradeLevels, premiumDecay);

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

    return { dates, dateMap, maxOi, maxCePrice, maxPePrice, biasSummary, priceTrend, tradeBias, tradeSetup, tradeLevels, optionMomentum, premiumDecay, sellingSetup };
  }, [data, selectedStrike, availableDates, visibleTableExpiries, selectedSpotClose, tableData]);

  // Persist each actionable setup once per session/date. This creates the
  // evidence needed for later outcome tracking and backtesting without
  // creating another UI section.
  useEffect(() => {
    if (!chartData || !selectedStrike || chartData.dates.length === 0) return;
    const selling = chartData.sellingSetup;
    const buying = chartData.tradeSetup;
    let action: 'BUY' | 'SELL' | null = null;
    let optionType: 'CE' | 'PE' | null = null;
    let setupStatus: TradeSetupStatus = 'Avoid';

    if ((selling.type === 'Call Sell' || selling.type === 'Put Sell') && selling.status !== 'Avoid') {
      action = 'SELL';
      optionType = selling.type === 'Call Sell' ? 'CE' : 'PE';
      setupStatus = selling.status;
    } else if ((buying.direction === 'Bullish' || buying.direction === 'Bearish') && buying.status !== 'Avoid') {
      action = 'BUY';
      optionType = buying.direction === 'Bullish' ? 'CE' : 'PE';
      setupStatus = buying.status;
    }
    if (!action || !optionType) return;

    const signalDate = chartData.dates[chartData.dates.length - 1];
    const expiry = chartData.premiumDecay.nearestExpiry;
    const side = optionType === 'CE' ? chartData.premiumDecay.ce : chartData.premiumDecay.pe;
    const key = `${scrip}|${signalDate}|${expiry}|${selectedStrike}|${optionType}|${action}`;
    if (loggedSignalKeysRef.current.has(key)) return;
    loggedSignalKeysRef.current.add(key);

    void apiClient.post('/api/oi-history/signals', {
        scrip,
        signalDate,
        expiry,
        strike: selectedStrike,
        optionType,
        action,
        status: setupStatus,
        entryPremium: side?.latestClose ?? null,
        spotPrice: chartData.priceTrend.endPrice ?? null,
        details: {
          priceTrend: chartData.priceTrend,
          sellingType: selling.type,
          sellingStatus: selling.status,
          buyingDirection: buying.direction,
          buyingStatus: buying.status,
          buyingMomentum: optionType === 'CE' ? chartData.optionMomentum.ce : chartData.optionMomentum.pe,
          decay: side ? { decayPct: side.decayPct, score: side.score, daysToExpiry: side.daysToExpiry, latestVolume: side.latestVolume } : null,
        },
      },
    ).catch(() => {
      // Logging must never affect the Trade Setup UI.
    });
  }, [chartData, scrip, selectedStrike]);

  // Refresh outcomes for older signals whenever a newer session is visible.
  // This gives the research log a simple mark-to-market result without
  // pretending that an order was actually executed.
  useEffect(() => {
    if (!chartData || chartData.dates.length === 0 || !selectedStrike) return;
    const latestDate = chartData.dates[chartData.dates.length - 1];
    const availableExpiries = new Set(visibleTableExpiries);
    if (availableExpiries.size === 0) return;

    void (async () => {
      try {
        const result = await apiClient.get<{ signals?: Array<{
          id: number; signal_date: string; expiry: string | null; strike: number; option_type: 'CE' | 'PE';
          action: 'BUY' | 'SELL'; entry_premium: number | null; outcome_status: string | null; outcome_final: boolean;
        }> }>(`/api/oi-history/signals?scrip=${encodeURIComponent(scrip)}&limit=200`, { signal: pageSignal });
        let outcomesUpdated = false;
        for (const signal of result.signals || []) {
          if (signal.outcome_final || signal.signal_date > latestDate || !signal.expiry || !availableExpiries.has(signal.expiry) || signal.strike !== selectedStrike) continue;
          if (!signal.entry_premium || signal.entry_premium <= 0) continue;
          const path = chartData.dates
            .filter((date) => date >= signal.signal_date)
            .map((date) => chartData.dateMap.get(date)?.get(signal.expiry!)?.[signal.option_type === 'CE' ? 'ceClose' : 'peClose'] || 0)
            .filter((price) => price > 0);
          if (path.length === 0) continue;
          const returns = path.map((price) => {
            const raw = ((price - signal.entry_premium!) / signal.entry_premium!) * 100;
            return signal.action === 'SELL' ? -raw : raw;
          });
          const returnPct = returns[returns.length - 1];
          const final = latestDate >= signal.expiry;
          await apiClient.patch(`/api/oi-history/signals/${signal.id}/outcome`, {
              price: path[path.length - 1],
              date: latestDate,
              returnPct,
              maxFavorableReturn: Math.max(...returns),
              maxAdverseReturn: Math.min(...returns),
              final,
              status: final ? (returnPct > 0 ? 'Profit' : 'Loss') : 'Open',
          }, { signal: pageSignal });
          outcomesUpdated = true;
        }
        if (outcomesUpdated) setOutcomeRefreshVersion((version) => version + 1);
      } catch {
        // Outcome tracking must never affect the Trade Setup UI.
      }
    })();
  }, [chartData, scrip, selectedStrike, visibleTableExpiries, pageSignal]);

  useEffect(() => {
    if (!chartData || !scrip) return;
    void (async () => {
      try {
        const result = await apiClient.get<{
          signals?: Array<{ action: 'BUY' | 'SELL'; option_type: 'CE' | 'PE'; outcome_status: string | null; outcome_return: number | null; max_favorable_return: number | null; max_adverse_return: number | null }>;
        }>(`/api/oi-history/signals?scrip=${encodeURIComponent(scrip)}&limit=500`, { signal: pageSignal });
        const signals = result.signals || [];
        const openSignals = signals.filter((signal) => signal.outcome_status === 'Open' || signal.outcome_status === null);
        const openReturns = openSignals
          .map((signal) => signal.outcome_return)
          .filter((value): value is number => value !== null && Number.isFinite(Number(value)))
          .map(Number);
        const evaluated = signals.filter((signal) => signal.outcome_status === 'Profit' || signal.outcome_status === 'Loss');
        const wins = evaluated.filter((signal) => signal.outcome_status === 'Profit').length;
        const average = evaluated.length ? evaluated.reduce((sum, signal) => sum + Number(signal.outcome_return || 0), 0) / evaluated.length : null;
        const favorableRows = evaluated.filter((signal) => signal.max_favorable_return !== null);
        const adverseRows = evaluated.filter((signal) => signal.max_adverse_return !== null);
        const averageMaxFavorable = favorableRows.length
          ? favorableRows.reduce((sum, signal) => sum + Number(signal.max_favorable_return), 0) / favorableRows.length
          : null;
        const averageMaxAdverse = adverseRows.length
          ? adverseRows.reduce((sum, signal) => sum + Number(signal.max_adverse_return), 0) / adverseRows.length
          : null;
        const winningReturns = evaluated.map((signal) => Number(signal.outcome_return || 0)).filter((value) => value > 0);
        const losingReturns = evaluated.map((signal) => Number(signal.outcome_return || 0)).filter((value) => value < 0);
        const grossProfit = winningReturns.reduce((sum, value) => sum + value, 0);
        const grossLoss = Math.abs(losingReturns.reduce((sum, value) => sum + value, 0));
        const averageWin = winningReturns.length ? grossProfit / winningReturns.length : null;
        const averageLoss = losingReturns.length ? -grossLoss / losingReturns.length : null;
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : null);
        const byAction = (action: 'BUY' | 'SELL') => {
          const rows = evaluated.filter((signal) => signal.action === action);
          return { count: rows.length, wins: rows.filter((signal) => signal.outcome_status === 'Profit').length };
        };
        const sells = byAction('SELL');
        const buys = byAction('BUY');
        const optionBreakdown = (['BUY CE', 'BUY PE', 'SELL CE', 'SELL PE'] as const).map((label) => {
          const [action, optionType] = label.split(' ') as ['BUY' | 'SELL', 'CE' | 'PE'];
          const rows = evaluated.filter((signal) => signal.action === action && signal.option_type === optionType);
          const rowWins = rows.filter((signal) => signal.outcome_status === 'Profit').length;
          return {
            label,
            evaluated: rows.length,
            winRate: rows.length ? (rowWins / rows.length) * 100 : null,
            averageReturn: rows.length ? rows.reduce((sum, signal) => sum + Number(signal.outcome_return || 0), 0) / rows.length : null,
          };
        });
        setSignalPerformance({
          total: signals.length,
          open: openSignals.length,
          averageOpenReturn: openReturns.length ? openReturns.reduce((sum, value) => sum + value, 0) / openReturns.length : null,
          evaluated: evaluated.length,
          wins,
          winRate: evaluated.length ? (wins / evaluated.length) * 100 : null,
          averageReturn: average,
          averageMaxFavorable,
          averageMaxAdverse,
          averageWin,
          averageLoss,
          profitFactor,
          sellEvaluated: sells.count,
          sellWinRate: sells.count ? (sells.wins / sells.count) * 100 : null,
          buyEvaluated: buys.count,
          buyWinRate: buys.count ? (buys.wins / buys.count) * 100 : null,
          optionBreakdown,
        });
      } catch {
        // Research metrics are optional and must never block the setup.
      }
    })();
  }, [chartData, scrip, outcomeRefreshVersion, pageSignal]);

  /**
   * Resolve the strike/side/optionType a trade setup recommends and place it.
   * Reuses handleTrade so token/tradingsymbol/price come from the OI grid.
   *   mode 'buy'  → BUY; CE for Bullish, PE for Bearish
   *   mode 'sell' → SELL; CE for Call Sell, PE for Put Sell
   * Strike = setup's key level (resistance for CE side, support for PE side),
   * falling back to ATM / max-OI magnet when the level is missing.
   */
  const tradeFromSetup = useCallback((mode: 'buy' | 'sell') => {
    if (!chartData) return;
    const { tradeSetup, sellingSetup, tradeLevels } = chartData;

    let optionType: 'CE' | 'PE' | null = null;
    let side: 'BUY' | 'SELL';
    if (mode === 'buy') {
      side = 'BUY';
      if (tradeSetup.direction === 'Bullish') optionType = 'CE';
      else if (tradeSetup.direction === 'Bearish') optionType = 'PE';
    } else {
      side = 'SELL';
      if (sellingSetup.type === 'Call Sell') optionType = 'CE';
      else if (sellingSetup.type === 'Put Sell') optionType = 'PE';
    }

    if (!optionType) {
      showToast('No single-leg strike for this setup', 'red');
      return;
    }

    // CE side leans to resistance, PE side to support; fall back to ATM/max-OI.
    const keyLevel = optionType === 'CE' ? tradeLevels.resistanceStrike : tradeLevels.supportStrike;
    const targetStrike = keyLevel ?? atmStrike ?? tradeLevels.maxOiStrike;
    if (!targetStrike) {
      showToast('No tradeable strike found', 'red');
      return;
    }

    const row = tableData.find((r) => r.strike === targetStrike);
    if (!row) {
      showToast(`Strike ${targetStrike} not in table`, 'red');
      return;
    }

    // Pick the nearest visible expiry that has a live cell for this option type.
    type RowCell = ReturnType<typeof row.cells.get>;
    let chosenCell: RowCell;
    let chosenExpiry: string | undefined;
    for (const exp of visibleTableExpiries) {
      const cell = row.cells.get(exp);
      if (!cell) continue;
      const token = optionType === 'CE' ? cell.ceToken : cell.peToken;
      const price = optionType === 'CE' ? cell.ceClose : cell.peClose;
      if (token && price) {
        chosenCell = cell;
        chosenExpiry = exp;
        break;
      }
    }

    if (!chosenCell || !chosenExpiry) {
      showToast(`No ${optionType} data at strike ${targetStrike}`, 'red');
      return;
    }

    void handleTrade(chosenCell, optionType, side, targetStrike, chosenExpiry);
  }, [chartData, atmStrike, tableData, visibleTableExpiries, handleTrade, showToast]);

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

  const exportSignalResults = useCallback(async () => {
    try {
      const result = await apiClient.get<{ signals?: Array<Record<string, unknown>> }>(`/api/oi-history/signals?scrip=${encodeURIComponent(scrip)}&limit=500`);
      const signals = result.signals || [];
      const columns = ['signal_date', 'scrip', 'expiry', 'strike', 'option_type', 'action', 'status', 'entry_premium', 'spot_price', 'outcome_status', 'outcome_date', 'outcome_return', 'max_favorable_return', 'max_adverse_return', 'outcome_final'];
      const escapeCsv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const csv = [columns.join(','), ...signals.map((signal) => columns.map((column) => escapeCsv(signal[column])).join(','))].join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `optiontrap-${scrip.toLowerCase()}-trade-signals.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // Export is optional and must not affect the setup UI.
    }
  }, [scrip]);

  /** Futures contracts loaded for the current-through-selected month range, nearest first. */
  const futuresContracts = useMemo(() => {
    const contracts = new Map<string, string>();
    for (const row of futuresData) {
      if (row.expiry && !contracts.has(row.expiry)) contracts.set(row.expiry, row.tradingsymbol);
    }
    return [...contracts].map(([expiry, tradingsymbol]) => ({ expiry, tradingsymbol })).sort((a, b) => a.expiry.localeCompare(b.expiry));
  }, [futuresData]);

  // Changes are computed within each contract so rollover days don't show false jumps.
  const futuresRowsByContract = useMemo(() => {
    const byContract = new Map<string, ReturnType<typeof buildFuturesSeries>>();
    for (const { expiry } of futuresContracts) {
      byContract.set(expiry, buildFuturesSeries(futuresData.filter((row) => row.expiry === expiry)));
    }
    return byContract;
  }, [futuresData, futuresContracts]);

  /** Table view shows every contract on the selected date, like the OI Snapshot. */
  const futuresDateRows = useMemo(() => {
    return futuresContracts
      .map(({ expiry }) => futuresRowsByContract.get(expiry)?.find((row) => row.date === filterDate))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }, [futuresContracts, futuresRowsByContract, filterDate]);

  /** Chart view plots every month's price on a shared date axis; bars are total OI/volume across months. */
  const futuresChart = useMemo(() => {
    const dates = [...new Set(futuresData.map((row) => row.date))].sort();
    if (dates.length === 0) return null;
    const prices = futuresData.map((row) => row.close).filter((price) => Number.isFinite(price) && price > 0);
    if (prices.length === 0) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || Math.max(max * 0.01, 1);
    const padding = range * 0.12;
    const low = min - padding;
    const high = max + padding;
    const left = 50;
    const right = 50;
    const top = 16;
    const bottom = 30;
    const width = 700;
    const height = 162;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const stepX = plotWidth / dates.length;
    const xByDate = new Map(dates.map((date, index) => [date, left + (index + 0.5) * stepX]));
    const toY = (close: number) => top + ((high - close) / (high - low)) * plotHeight;
    const lines = futuresContracts.map(({ expiry, tradingsymbol }, index) => ({
      expiry,
      tradingsymbol,
      label: formatMonthLabel(expiry.slice(0, 7)),
      color: FUTURES_LINE_COLORS[index % FUTURES_LINE_COLORS.length],
      points: (futuresRowsByContract.get(expiry) || [])
        .filter((row) => row.close > 0)
        .map((row) => ({ date: row.date, close: row.close, x: xByDate.get(row.date)!, y: toY(row.close) })),
    }));
    const days = dates.map((date) => {
      const rows = futuresData.filter((row) => row.date === date);
      return {
        date,
        x: xByDate.get(date)!,
        oi: rows.reduce((sum, row) => sum + (row.oi || 0), 0),
        volume: rows.reduce((sum, row) => sum + (row.volume || 0), 0),
        closes: lines.flatMap((line) => {
          const point = line.points.find((item) => item.date === date);
          return point ? [{ label: line.label, color: line.color, close: point.close }] : [];
        }),
      };
    });
    const maxOi = Math.max(1, ...days.map((day) => day.oi));
    const maxVolume = Math.max(1, ...days.map((day) => day.volume));
    return { lines, days, low, high, left, right, top, bottom, width, height, plotWidth, plotHeight, maxOi, maxVolume };
  }, [futuresData, futuresContracts, futuresRowsByContract]);

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
            <span>Instrument</span>
            <AppSelect
              value={scrip}
              options={scripOptions}
              onChange={(v) => selectScrip(String(v))}
              searchable
              disabled={fetching}
            />
          </label>

          <label className="oi-history__label">
            <span>Expiry month</span>
            <AppSelect
              value={selectedExpiryMonth}
              options={selectableExpiryMonthOptions.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
              onChange={(v) => setSelectedExpiryMonth(String(v))}
              disabled={fetching}
            />
          </label>

          <label className="oi-history__label">
            <span>Strikes</span>
            <AppSelect
              value={strikeRange}
              options={[
                { value: 5, label: '5' },
                { value: 10, label: '10' },
                { value: 20, label: '20' },
                { value: 0, label: 'All' },
                { value: -1, label: 'Specific' },
              ]}
              onChange={(v) => { const val = Number(v); setStrikeRange(val); localStorage.setItem('optiontrap_strike_range', String(val)); }}
            />
          </label>

          {strikeRange === -1 && (
            <label className="oi-history__label">
              <input
                className="app-input oi-history__specific-strike"
                type="number"
                min="0"
                step="50"
                placeholder="Strike"
                value={specificStrike}
                onChange={(event) => {
                  setSpecificStrike(event.target.value);
                  localStorage.setItem('optiontrap_specific_strike', event.target.value);
                }}
                disabled={fetching}
              />
            </label>
          )}

          <div className="oi-history__primary-actions">
            <button
              className="app-btn app-btn--primary"
              onClick={handleFetch}
              disabled={fetching}
              title={fetchableExpiryMonths.length > 0
                ? `Fetch ${scrip} data for ${fetchableExpiryMonths.length} current/future expiry month(s) (${fetchableExpiryMonths.join(', ')}) from Kite`
                : 'Historical expiry months are loaded from stored database data'}
            >
              {fetching ? 'Fetching...' : 'Fetch'}
            </button>

            <div className="oi-history__data-menu" ref={dataMenuRef}>
              <button
                type="button"
                className="app-btn app-btn--secondary oi-history__data-menu-trigger"
                onClick={() => setIsDataMenuOpen((open) => !open)}
                aria-expanded={isDataMenuOpen}
                aria-haspopup="menu"
                title="Manage stored OI history data"
              >
                Data
              </button>
              {isDataMenuOpen && (
              <div className="oi-history__data-menu-panel" role="menu">
                <button
                  className="oi-history__data-menu-item"
                  onClick={() => { setIsDataMenuOpen(false); setConfirmCleanOld(true); }}
                  disabled={fetching}
                  role="menuitem"
                  title={`Delete ${scrip} OI history older than ${cleanupCutoffLabel}. Keeps ${cleanupCutoffLabel} and newer.`}
                >
                  <strong>Clean Old</strong>
                  <span>Keep {cleanupCutoffLabel} and newer</span>
                </button>
                <button
                  className="oi-history__data-menu-item oi-history__data-menu-item--danger"
                  onClick={() => { setIsDataMenuOpen(false); setConfirmDelete(true); }}
                  disabled={fetching}
                  role="menuitem"
                  title={`Delete all OI history data for ${scrip}`}
                >
                  <strong>Delete All</strong>
                  <span>Remove all stored months for {scrip}</span>
                </button>
              </div>
              )}
            </div>
          </div>

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
      </div>

      {/* Date filter — grouped by month */}
      {visibleDates.length > 0 && (
        <div className="oi-history__date-bar">
          {datesByMonth.map(({ month, dates }) => (
            <div key={month} className="oi-history__date-group">
              <span className="oi-history__date-group-label">{formatMonthShortLabel(month)}</span>
              <div className="oi-history__date-group-days">
                {dates.map((d) => {
                  const isExpiryDay = expiryMarkerDates.has(d);
                  return (
                    <button
                      key={d}
                      className={`oi-history__date-btn ${filterDate === d ? 'oi-history__date-btn--active' : ''} ${isExpiryDay ? 'oi-history__date-btn--weekly-expiry' : ''}`}
                      onClick={() => setFilterDate(d)}
                      title={`${formatFullDateLabel(d)}${isExpiryDay ? ' — Expiry day' : ''}`}
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

      {futuresContracts.length > 0 && (
        <div className="oi-history__table-wrap card" style={{ marginBottom: 16 }}>
          <div className="oi-history__table-header">
            <div className="oi-history__table-header-left">
              <div>
                <div className="oi-history__table-title">Futures Context</div>
                <div className="oi-history__table-subtitle">
                  {futuresView === 'chart'
                    ? `${futuresContracts.length} month${futuresContracts.length === 1 ? '' : 's'} · Daily price, OI, and volume history`
                    : <>{filterDate ? formatFullDateLabel(filterDate) : 'Select a date'}<span>Daily price, OI, and volume confirmation</span></>}
                </div>
              </div>
            </div>
            <div className="oi-history__table-meta">
              <div className="oi-history__metric-toggle" role="group" aria-label="Futures view">
                <button type="button" className={`oi-history__volume-toggle ${futuresView === 'table' ? 'oi-history__volume-toggle--active' : ''}`} onClick={() => setFuturesView('table')} aria-pressed={futuresView === 'table'}>Table</button>
                <button type="button" className={`oi-history__volume-toggle ${futuresView === 'chart' ? 'oi-history__volume-toggle--active' : ''}`} onClick={() => setFuturesView('chart')} aria-pressed={futuresView === 'chart'}>Chart</button>
              </div>
              <button
                type="button"
                className="app-btn app-btn--icon oi-history__futures-info-button"
                onClick={() => setShowFuturesInfo((visible) => !visible)}
                title="Explain futures signals"
                aria-label="Explain futures signals"
                aria-expanded={showFuturesInfo}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                </svg>
              </button>
            </div>
          </div>
          {showFuturesInfo && (
            <div className="oi-history__futures-info" role="note">
              <div className="oi-history__futures-info-title">How futures signals are calculated</div>
              <div className="oi-history__futures-info-grid">
                <div className="oi-history__futures-info-item oi-history__futures-info-item--bullish">
                  <strong>Long buildup</strong>
                  <span>Price ↑ and OI ↑</span>
                  <small>New buyers are entering. Generally bullish.</small>
                </div>
                <div className="oi-history__futures-info-item oi-history__futures-info-item--bearish">
                  <strong>Short buildup</strong>
                  <span>Price ↓ and OI ↑</span>
                  <small>New sellers are entering. Generally bearish.</small>
                </div>
                <div className="oi-history__futures-info-item oi-history__futures-info-item--bearish">
                  <strong>Long unwinding</strong>
                  <span>Price ↓ and OI ↓</span>
                  <small>Existing buyers are closing positions. Signals weakness.</small>
                </div>
                <div className="oi-history__futures-info-item oi-history__futures-info-item--bullish">
                  <strong>Short covering</strong>
                  <span>Price ↑ and OI ↓</span>
                  <small>Existing sellers are closing positions. Can support a rebound.</small>
                </div>
              </div>
              <div className="oi-history__futures-volume-note">
                <strong>Active volume:</strong> today’s volume is at least the average of the previous five trading days. This indicates stronger participation, not direction by itself.
              </div>
            </div>
          )}
          {futuresView === 'chart' && futuresChart ? (
            <div className="oi-history__chart-wrap oi-history__chart-wrap--futures">
              <div className="oi-history__chart-header">
                <div className="oi-history__chart-title">Futures Price History</div>
              </div>
              <svg className="oi-history__chart-svg" viewBox={`0 0 ${futuresChart.width} ${futuresChart.height}`} role="img" aria-label={`${scrip} futures price chart by month`}>
                {[0, 0.5, 1].map((fraction) => {
                  const y = futuresChart.top + fraction * futuresChart.plotHeight;
                  const value = futuresChart.high - fraction * (futuresChart.high - futuresChart.low);
                  return (
                    <g key={fraction}>
                      <line x1={futuresChart.left} x2={futuresChart.width - futuresChart.right} y1={y} y2={y} stroke="var(--card-border)" strokeWidth="0.5" />
                      <text x={futuresChart.left - 4} y={y + 3} textAnchor="end" fontSize="6" fill="var(--text-secondary)">{value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</text>
                    </g>
                  );
                })}
                <line x1={futuresChart.left} x2={futuresChart.width - futuresChart.right} y1={futuresChart.top + futuresChart.plotHeight} y2={futuresChart.top + futuresChart.plotHeight} stroke="var(--text-secondary)" strokeWidth="0.5" opacity="0.5" />
                <line x1={futuresChart.left} x2={futuresChart.width - futuresChart.right} y1={futuresChart.top + futuresChart.plotHeight} y2={futuresChart.top + futuresChart.plotHeight} stroke="var(--text-secondary)" strokeWidth="0.5" opacity="0.5" />
                {futuresChart.days.map((day) => {
                  const slotWidth = futuresChart.plotWidth / futuresChart.days.length;
                  const barWidth = Math.min(slotWidth * 0.32, 6);
                  const oiHeight = (day.oi / futuresChart.maxOi) * futuresChart.plotHeight;
                  const volumeHeight = (day.volume / futuresChart.maxVolume) * futuresChart.plotHeight;
                  return (
                    <g key={`bars-${day.date}`} onMouseEnter={() => setFuturesHover(day)} onMouseLeave={() => setFuturesHover(null)}>
                      <rect x={day.x - barWidth} y={futuresChart.top + futuresChart.plotHeight - oiHeight} width={Math.max(barWidth, 0.5)} height={oiHeight} fill="#8b5cf6" opacity="0.45" rx="1">
                        <title>{`${formatFullDateLabel(day.date)} Total OI: ${formatOiCompact(day.oi)}`}</title>
                      </rect>
                      <rect x={day.x} y={futuresChart.top + futuresChart.plotHeight - volumeHeight} width={Math.max(barWidth, 0.5)} height={volumeHeight} fill="#06b6d4" opacity="0.45" rx="1">
                        <title>{`${formatFullDateLabel(day.date)} Total volume: ${formatOiCompact(day.volume)}`}</title>
                      </rect>
                    </g>
                  );
                })}
                {futuresChart.lines.map((line) => (
                  <g key={`line-${line.expiry}`}>
                    <polyline points={line.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={line.color} strokeWidth="1.2" strokeLinejoin="round" />
                    {line.points.map((point) => (
                      <circle key={point.date} cx={point.x} cy={point.y} r="2.5" fill={line.color} onMouseEnter={() => setFuturesHover(futuresChart.days.find((day) => day.date === point.date) || null)} onMouseLeave={() => setFuturesHover(null)}>
                        <title>{`${line.label} · ${formatFullDateLabel(point.date)}: ${point.close.toLocaleString('en-IN')}`}</title>
                      </circle>
                    ))}
                  </g>
                ))}
                {futuresHover && (() => {
                  const tooltipWidth = 150;
                  const tooltipHeight = 28 + futuresHover.closes.length * 12;
                  const tooltipX = Math.min(Math.max(futuresHover.x - tooltipWidth / 2, futuresChart.left), futuresChart.width - futuresChart.right - tooltipWidth);
                  return (
                    <g pointerEvents="none">
                      <rect x={tooltipX} y={futuresChart.top + 3} width={tooltipWidth} height={tooltipHeight} rx="3" fill="var(--card-bg-solid, #111827)" stroke="var(--card-border)" />
                      <text x={tooltipX + 7} y={futuresChart.top + 14} fontSize="8" fill="var(--text-primary)">{formatFullDateLabel(futuresHover.date)}</text>
                      {futuresHover.closes.map((item, index) => (
                        <text key={item.label} x={tooltipX + 7} y={futuresChart.top + 26 + index * 12} fontSize="8" fill={item.color}>{item.label}: {item.close.toLocaleString('en-IN')}</text>
                      ))}
                      <text x={tooltipX + 7} y={futuresChart.top + 26 + futuresHover.closes.length * 12} fontSize="8" fill="var(--text-secondary)">Total OI: {formatOiCompact(futuresHover.oi)} · Vol: {formatOiCompact(futuresHover.volume)}</text>
                    </g>
                  );
                })()}
                {futuresChart.days.map((day) => (
                  <text key={`label-${day.date}`} x={day.x} y={futuresChart.height - 20} textAnchor="middle" fontSize="5.5" fill="var(--text-secondary)">{day.date.slice(8)}</text>
                ))}
              </svg>
              <div className="oi-history__chart-legend">
                <span className="oi-history__chart-legend-item"><span className="oi-history__chart-legend-swatch" style={{ background: '#8b5cf6' }} /> Total OI</span>
                <span className="oi-history__chart-legend-item"><span className="oi-history__chart-legend-swatch" style={{ background: '#06b6d4' }} /> Total volume</span>
                {futuresChart.lines.map((line) => (
                  <span key={line.expiry} className="oi-history__chart-legend-item" title={line.tradingsymbol}><span className="oi-history__chart-legend-swatch" style={{ background: line.color }} /> {line.label}</span>
                ))}
              </div>
            </div>
          ) : futuresDateRows.length === 0 ? (
            <div className="oi-history__status">No futures data for {filterDate ? formatFullDateLabel(filterDate) : 'the selected date'}.</div>
          ) : (
          <div className="oi-history__table-scroll">
            <table className="oi-history__table oi-history__futures-table">
              <thead><tr>
                <th className="oi-history__futures-th--date">Month</th>
                <th className="oi-history__futures-th--price">Close</th>
                <th className="oi-history__futures-th--price">Price</th>
                <th className="oi-history__futures-th--oi">OI</th>
                <th className="oi-history__futures-th--oi">OI change</th>
                <th className="oi-history__futures-th--volume">Volume</th>
                <th className="oi-history__futures-th--signal">Signal</th>
              </tr></thead>
              <tbody>{futuresDateRows.map((row) => (
                <tr key={row.expiry}>
                  <td className="oi-history__futures-date" title={row.tradingsymbol}>{formatMonthLabel(row.expiry.slice(0, 7))}</td>
                  <td className="oi-history__futures-close">{row.close?.toLocaleString('en-IN') || '-'}</td>
                  <td className={row.priceChangePct !== null && row.priceChangePct >= 0 ? 'oi-history__futures-positive' : 'oi-history__futures-negative'}>
                    <span className="oi-history__cell-primary">{row.priceChangePct === null ? '-' : `${row.priceChangePct >= 0 ? '+' : ''}${row.priceChangePct.toFixed(2)}%`}</span>
                  </td>
                  <td className="oi-history__futures-oi">{row.oi?.toLocaleString('en-IN') || '-'}</td>
                  <td className={row.oiChangePct !== null && row.oiChangePct >= 0 ? 'oi-history__futures-positive' : 'oi-history__futures-negative'}>
                    <span className="oi-history__cell-primary">{row.oiChangePct === null ? '-' : `${row.oiChangePct >= 0 ? '+' : ''}${row.oiChangePct.toFixed(2)}%`}</span>
                  </td>
                  <td className="oi-history__futures-volume">{row.volume?.toLocaleString('en-IN') || '-'}</td>
                  <td className={`oi-history__futures-signal ${row.interpretation === 'Long buildup' || row.interpretation === 'Short covering' ? 'oi-history__futures-signal--bullish' : row.interpretation === 'Short buildup' || row.interpretation === 'Long unwinding' ? 'oi-history__futures-signal--bearish' : ''}`}>
                    {row.interpretation}{row.avgVolume && row.volume >= row.avgVolume ? ' · active volume' : ''}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          )}
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
            <div className="oi-history__table-header-left">
              <div>
                <div className="oi-history__table-title">OI Snapshot</div>
                <div className="oi-history__table-subtitle">
                  {filterDate ? formatFullDateLabel(filterDate) : 'Select a date'}
                  <span>Daily change vs previous session</span>
                </div>
              </div>
            </div>
            <div className="oi-history__table-meta">
              <span className="oi-history__table-count">{tableData.length} strikes</span>
              <span className="oi-history__table-count">{visibleTableExpiries.length} expiries</span>
              <button
                type="button"
                className="app-btn app-btn--icon oi-history__pattern-info-button"
                onClick={() => setShowPatternInfo((visible) => !visible)}
                title="Explain OI Snapshot patterns"
                aria-label="Explain OI Snapshot patterns"
                aria-expanded={showPatternInfo}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                </svg>
              </button>
            </div>
          </div>

        {showPatternInfo && (
          <div className="trap-info-detail" style={{ marginBottom: 12 }}>
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
              <li><strong style={{ color: '#22c55e' }}>Doubling Down (Long)</strong> — OI rising across multiple expiries while option price is rising. Buyers are adding conviction across expiries.</li>
              <li><strong style={{ color: '#ef4444' }}>Doubling Down (Short)</strong> — OI rising across multiple expiries while option price is falling. Sellers are adding conviction across expiries.</li>
              <li><strong style={{ color: '#ef4444' }}>Unwinding</strong> — OI falling across all expiries because existing positions are being closed. No meaningful new positions are replacing them.</li>
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
                        className="oi-history__cell--pattern oi-history__cell--pattern-ce"
                        style={{ color: patternColor(cePattern) }}
                        title={`CE pattern: ${cePattern}`}
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
                      <td className={`oi-history__cell--strike ${isAtm ? 'oi-history__cell--strike-atm' : ''}`} title={isAtm ? 'At-the-money strike' : `Strike ${strike}`}>
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
                        className="oi-history__cell--pattern oi-history__cell--pattern-pe"
                        style={{ color: patternColor(pePattern) }}
                        title={`PE pattern: ${pePattern}`}
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
            <div className="oi-history__chart-controls">
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
          </div>

          {analysisTab === 'history' && (
            <>
          <div className="oi-history__chart-pair">
            {/* CE Chart */}
            {(() => {
              const W = 700, H = 162, PAD_L = 50, PAD_R = 50, PAD_T = 16, PAD_B = 30;
              const plotW = W - PAD_L - PAD_R;
              const plotH = H - PAD_T - PAD_B;
              const { dates, dateMap, maxOi, maxCePrice } = chartData;
              const maxBarValue = showVolume
                ? Math.max(1, ...dates.flatMap((date) => visibleTableExpiries.map((exp) => dateMap.get(date)?.get(exp)?.ceVolume || 0)))
                : maxOi;
              const n = dates.length;
              if (n === 0 || maxOi === 0) return null;
              const expiryCount = Math.max(1, visibleTableExpiries.length);
              const slotW = plotW / n;
              const barW = Math.min((slotW * 0.8) / expiryCount, 10);
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
                        .map((exp) => ({ exp, value: showVolume ? dateMap.get(d)?.get(exp)?.ceVolume || 0 : dateMap.get(d)?.get(exp)?.ceOi || 0 }))
                        .filter((b) => b.value > 0);
                      const totalBarW = barW * expiryBars.length;
                      return expiryBars.map((b, j) => {
                        const barH = (b.value / maxBarValue) * plotH;
                        const bx = x - totalBarW / 2 + j * barW;
                        return (
                          <rect key={`${d}-${b.exp}`} x={bx} y={PAD_T + plotH - barH} width={Math.max(barW * 0.85, 0.5)} height={barH}
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
                        {formatOiCompact(Math.round(maxBarValue * frac))}
                      </text>
                    ))}

                    {/* X-axis: day numbers + month band */}
                    <ChartXAxis dates={dates} padL={PAD_L} plotW={plotW} h={H} />
                  </svg>
                </div>
              );
            })()}

            {/* PE Chart */}
            {(() => {
              const W = 700, H = 162, PAD_L = 50, PAD_R = 50, PAD_T = 16, PAD_B = 30;
              const plotW = W - PAD_L - PAD_R;
              const plotH = H - PAD_T - PAD_B;
              const { dates, dateMap, maxOi, maxPePrice } = chartData;
              const maxBarValue = showVolume
                ? Math.max(1, ...dates.flatMap((date) => visibleTableExpiries.map((exp) => dateMap.get(date)?.get(exp)?.peVolume || 0)))
                : maxOi;
              const n = dates.length;
              if (n === 0 || maxOi === 0) return null;
              const expiryCount = Math.max(1, visibleTableExpiries.length);
              const slotW = plotW / n;
              const barW = Math.min((slotW * 0.8) / expiryCount, 10);
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
                        .map((exp) => ({ exp, value: showVolume ? dateMap.get(d)?.get(exp)?.peVolume || 0 : dateMap.get(d)?.get(exp)?.peOi || 0 }))
                        .filter((b) => b.value > 0);
                      const totalBarW = barW * expiryBars.length;
                      return expiryBars.map((b, j) => {
                        const barH = (b.value / maxBarValue) * plotH;
                        const bx = x - totalBarW / 2 + j * barW;
                        return (
                          <rect key={`${d}-${b.exp}`} x={bx} y={PAD_T + plotH - barH} width={Math.max(barW * 0.85, 0.5)} height={barH}
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
                        {formatOiCompact(Math.round(maxBarValue * frac))}
                      </text>
                    ))}

                    {/* X-axis: day numbers + month band */}
                    <ChartXAxis dates={dates} padL={PAD_L} plotW={plotW} h={H} />
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
          <div className="oi-history__chart-metric-row">
            <div className="oi-history__metric-toggle" role="group" aria-label="Chart bar metric">
              <button type="button" className={`oi-history__volume-toggle ${!showVolume ? 'oi-history__volume-toggle--active' : ''}`} onClick={() => setShowVolume(false)} aria-pressed={!showVolume}>OI</button>
              <button type="button" className={`oi-history__volume-toggle ${showVolume ? 'oi-history__volume-toggle--active' : ''}`} onClick={() => setShowVolume(true)} aria-pressed={showVolume}>Volume</button>
            </div>
          </div>
            </>
          )}

          {analysisTab === 'setup' && (
            <div className={`oi-history__setup-dashboard oi-history__setup-dashboard--${chartData.tradeSetup.status.toLowerCase()}`}>
              <div className="oi-history__setup-titlebar">
                <div>
                  <span>TRADE SETUP</span>
                  <h3>Decision dashboard</h3>
                  <p>One view for buying momentum, selling decay, and the conditions that invalidate each idea.</p>
                </div>
                <div className="oi-history__setup-titlebar-meta">
                  <strong>{selectedStrike ?? '-'} STRIKE</strong>
                  <span>{filterDate} · {visibleTableExpiries.length} expiry{visibleTableExpiries.length === 1 ? '' : 'ies'}</span>
                </div>
              </div>
              <div className="oi-history__setup-choice-grid">
                <div className={`oi-history__setup-mode-card oi-history__setup-mode-card--${chartData.tradeSetup.status.toLowerCase()}`}>
                  <div className="oi-history__setup-mode-card-head">
                    <span>Option Buying Trade</span>
                    <strong>{chartData.tradeSetup.direction} {chartData.tradeSetup.status === 'Avoid' ? 'No Trade' : chartData.tradeSetup.status}</strong>
                  </div>
                  <div className="oi-history__readiness-meter">
                    <span>Buying setup</span>
                    <strong>{setupReadinessLabel(chartData.tradeSetup.status, readinessScore(chartData.tradeSetup.checklist))}</strong>
                    <div><span style={{ width: setupReadinessWidth(chartData.tradeSetup.status, readinessScore(chartData.tradeSetup.checklist)) }} /></div>
                  </div>
                  <p>{chartData.tradeSetup.action}</p>
                  <div className="oi-history__buying-summary">
                    <div className="oi-history__buying-summary-head">
                      <div>
                        <span>Nearest-expiry momentum</span>
                        <strong>{chartData.optionMomentum.nearestExpiry ? expiryLabel(chartData.optionMomentum.nearestExpiry, isMonthlyExpiry(chartData.optionMomentum.nearestExpiry)) : 'Unavailable'}</strong>
                      </div>
                      <em>Buying pressure</em>
                    </div>
                    <div className="oi-history__buying-summary-grid">
                      {(['CE', 'PE'] as const).map((optionType) => {
                        const side = optionType === 'CE' ? chartData.optionMomentum.ce : chartData.optionMomentum.pe;
                        return (
                          <div key={optionType} className="oi-history__buying-summary-side">
                            <div className="oi-history__buying-summary-side-head">
                              <strong>{optionType}</strong>
                              <span>{side ? (side.momentumPct >= 0 ? 'Momentum up' : 'Momentum down') : 'No history'}</span>
                            </div>
                            <div className={`oi-history__buying-summary-value ${side && side.momentumPct >= 0 ? 'is-positive' : 'is-negative'}`}>
                              <strong>{side ? formatPct(side.momentumPct) : '-'}</strong>
                              <small>premium change</small>
                            </div>
                            <div className="oi-history__buying-summary-metrics">
                              <span>OI <b>{side ? formatPct(side.oiChangePct) : '-'}</b></span>
                              <span>Vol <b>{side && side.latestVolume > 0 ? side.latestVolume.toLocaleString('en-IN') : '-'}</b></span>
                              <span>DTE <b>{side?.daysToExpiry ?? '-'}</b></span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="oi-history__setup-primary-action">
                    <span>Strategy</span>
                    <strong>{chartData.tradeSetup.strategy}</strong>
                  </div>
                  <div className="oi-history__setup-mini-plan">
                    <div>
                      <span>Trigger</span>
                      <strong>{chartData.tradeSetup.trigger}</strong>
                    </div>
                    <div>
                      <span>Stop</span>
                      <strong>{chartData.tradeSetup.invalidation}</strong>
                    </div>
                    <div>
                      <span>Target</span>
                      <strong>{chartData.tradeSetup.target}</strong>
                    </div>
                  </div>
                  {chartData.tradeSetup.status !== 'Avoid' &&
                    (chartData.tradeSetup.direction === 'Bullish' || chartData.tradeSetup.direction === 'Bearish') && (
                    <button
                      type="button"
                      className="oi-history__setup-trade-btn oi-history__setup-trade-btn--buy"
                      onClick={() => tradeFromSetup('buy')}
                    >
                      Buy {chartData.tradeSetup.direction === 'Bullish' ? 'CE' : 'PE'}
                    </button>
                  )}
                </div>

                <div className={`oi-history__setup-mode-card oi-history__setup-mode-card--${chartData.sellingSetup.status.toLowerCase()}`}>
                  <div className="oi-history__setup-mode-card-head">
                    <span>Option Selling Trade</span>
                    <strong>{chartData.sellingSetup.type} {chartData.sellingSetup.status === 'Avoid' ? 'No Trade' : chartData.sellingSetup.status}</strong>
                  </div>
                  <div className="oi-history__readiness-meter">
                    <span>Selling setup</span>
                    <strong>{setupReadinessLabel(chartData.sellingSetup.status, readinessScore(chartData.sellingSetup.checklist))}</strong>
                    <div><span style={{ width: setupReadinessWidth(chartData.sellingSetup.status, readinessScore(chartData.sellingSetup.checklist)) }} /></div>
                  </div>
                  <p>{chartData.sellingSetup.action}</p>
                  <div className="oi-history__buying-summary oi-history__decay-monitor">
                    <div className="oi-history__buying-summary-head">
                      <div>
                        <span>Nearest-expiry decay monitor</span>
                        <strong>{chartData.premiumDecay.nearestExpiry ? expiryLabel(chartData.premiumDecay.nearestExpiry, isMonthlyExpiry(chartData.premiumDecay.nearestExpiry)) : 'Unavailable'}</strong>
                      </div>
                      <em>Time decay</em>
                    </div>
                    <div className="oi-history__buying-summary-grid">
                      {(['CE', 'PE'] as const).map((optionType) => {
                        const side = optionType === 'CE' ? chartData.premiumDecay.ce : chartData.premiumDecay.pe;
                        return (
                          <div key={optionType} className="oi-history__buying-summary-side">
                            <div className="oi-history__buying-summary-side-head">
                              <strong>{optionType}</strong>
                              <span>{side ? (side.decayPct <= 0 ? 'Decay active' : 'Premium rising') : 'No history'}</span>
                            </div>
                            <div className={`oi-history__buying-summary-value ${side && side.decayPct <= 0 ? 'is-positive' : 'is-negative'}`}>
                              <strong>{side ? formatPct(side.decayPct) : '-'}</strong>
                              <small>premium change</small>
                            </div>
                            <div className="oi-history__buying-summary-metrics">
                              <span>OI <b>{side ? formatPct(side.oiChangePct) : '-'}</b></span>
                              <span>Vol <b>{side && side.latestVolume > 0 ? side.latestVolume.toLocaleString('en-IN') : '-'}</b></span>
                              <span>DTE <b>{side?.daysToExpiry ?? '-'}</b></span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="oi-history__setup-primary-action">
                    <span>Structure</span>
                    <strong>{chartData.sellingSetup.type === 'No Sell' ? 'Wait for support/resistance setup' : 'Prefer defined-risk credit spread'}</strong>
                  </div>
                  <div className="oi-history__setup-mini-plan">
                    <div>
                      <span>Trigger</span>
                      <strong>{chartData.sellingSetup.trigger}</strong>
                    </div>
                    <div>
                      <span>Stop</span>
                      <strong>{chartData.sellingSetup.invalidation}</strong>
                    </div>
                    <div>
                      <span>Target</span>
                      <strong>{chartData.sellingSetup.target}</strong>
                    </div>
                  </div>
                  {chartData.sellingSetup.status !== 'Avoid' &&
                    (chartData.sellingSetup.type === 'Call Sell' || chartData.sellingSetup.type === 'Put Sell') && (
                    <button
                      type="button"
                      className="oi-history__setup-trade-btn oi-history__setup-trade-btn--sell"
                      onClick={() => tradeFromSetup('sell')}
                    >
                      Sell {chartData.sellingSetup.type === 'Call Sell' ? 'CE' : 'PE'}
                    </button>
                  )}
                </div>
              </div>

              {signalPerformance && (
                <div className="oi-history__signal-performance oi-history__signal-performance--dashboard">
                  <div className="oi-history__signal-performance-head">
                    <span>Recorded setup performance</span>
                    <div>
                      <strong>{signalPerformance.total} signals · {signalPerformance.open} open · {signalPerformance.evaluated} evaluated</strong>
                      <button type="button" className="oi-history__signal-export" onClick={exportSignalResults}>Export CSV</button>
                    </div>
                  </div>
                  <div className={`oi-history__signal-confidence ${signalPerformance.evaluated >= 20 ? 'is-ready' : ''}`}>
                    {signalPerformance.evaluated >= 20
                      ? 'Performance sample is large enough for an initial review.'
                      : signalPerformance.open > 0
                        ? `${signalPerformance.open} signal${signalPerformance.open === 1 ? '' : 's'} remain open; current return is provisional until expiry.`
                        : `Preliminary sample: ${Math.max(0, 20 - signalPerformance.evaluated)} more evaluated signals needed before trusting the percentages.`}
                  </div>
                  <div className="oi-history__signal-performance-grid">
                    <span>Open <strong>{signalPerformance.open}</strong></span>
                    <span>Current open avg <strong>{signalPerformance.averageOpenReturn === null ? '-' : `${signalPerformance.averageOpenReturn >= 0 ? '+' : ''}${signalPerformance.averageOpenReturn.toFixed(1)}%`}</strong></span>
                    <span>Win rate <strong>{signalPerformance.winRate === null ? '-' : `${signalPerformance.winRate.toFixed(0)}%`}</strong></span>
                    <span>Avg return <strong>{signalPerformance.averageReturn === null ? '-' : `${signalPerformance.averageReturn >= 0 ? '+' : ''}${signalPerformance.averageReturn.toFixed(1)}%`}</strong></span>
                    <span>Avg best move <strong>{signalPerformance.averageMaxFavorable === null ? '-' : `+${signalPerformance.averageMaxFavorable.toFixed(1)}%`}</strong></span>
                    <span>Avg worst move <strong>{signalPerformance.averageMaxAdverse === null ? '-' : `${signalPerformance.averageMaxAdverse.toFixed(1)}%`}</strong></span>
                    <span>Sell <strong>{signalPerformance.sellWinRate === null ? '-' : `${signalPerformance.sellWinRate.toFixed(0)}% (${signalPerformance.sellEvaluated})`}</strong></span>
                    <span>Buy <strong>{signalPerformance.buyWinRate === null ? '-' : `${signalPerformance.buyWinRate.toFixed(0)}% (${signalPerformance.buyEvaluated})`}</strong></span>
                  </div>
                  <div className="oi-history__signal-breakdown">
                    {signalPerformance.optionBreakdown.map((item) => (
                      <span key={item.label}>
                        {item.label}
                        <strong>{item.winRate === null ? '-' : `${item.winRate.toFixed(0)}%`}</strong>
                        <small>{item.evaluated} evaluated{item.averageReturn === null ? '' : ` · ${item.averageReturn >= 0 ? '+' : ''}${item.averageReturn.toFixed(1)}% avg`}</small>
                      </span>
                    ))}
                  </div>
                  <div className="oi-history__signal-quality">
                    <span>Avg win <strong>{signalPerformance.averageWin === null ? '-' : `+${signalPerformance.averageWin.toFixed(1)}%`}</strong></span>
                    <span>Avg loss <strong>{signalPerformance.averageLoss === null ? '-' : `${signalPerformance.averageLoss.toFixed(1)}%`}</strong></span>
                    <span>Profit factor <strong>{signalPerformance.profitFactor === null ? '-' : signalPerformance.profitFactor === Infinity ? '∞' : signalPerformance.profitFactor.toFixed(2)}</strong></span>
                  </div>
                </div>
              )}

              <div className="oi-history__market-context" aria-label="Market context">
                <span className="oi-history__market-context-title">Market context</span>
                <div className="oi-history__market-context-items">
                  <span><small>Price</small><strong>{chartData.priceTrend.direction}</strong></span>
                  <span><small>Flow</small><strong>{chartData.biasSummary.bias} · {chartData.biasSummary.strength}</strong></span>
                  <span><small>Support</small><strong>{chartData.tradeLevels.supportStrike ?? '-'}</strong></span>
                  <span><small>Spot</small><strong>{chartData.tradeLevels.spot !== null ? chartData.tradeLevels.spot.toFixed(2) : '-'}</strong></span>
                  <span><small>Resistance</small><strong>{chartData.tradeLevels.resistanceStrike ?? '-'}</strong></span>
                  <span><small>Max OI</small><strong>{chartData.tradeLevels.maxOiStrike ?? '-'}</strong></span>
                </div>
              </div>

              <details className="oi-history__setup-detail-drawer">
                <summary>
                  <span>Why this setup?</span>
                  <em>Evidence, risk checks, and market context</em>
                </summary>
                <div className="oi-history__setup-evidence-grid">
                  <div className="oi-history__setup-detail-section oi-history__setup-detail-section--buying">
                    <div className="oi-history__setup-section-heading">
                      <span>Option buying</span>
                      <strong>{setupReadinessLabel(chartData.tradeSetup.status, readinessScore(chartData.tradeSetup.checklist))}</strong>
                    </div>
                  <div className="oi-history__setup-signal-strip">
                    {sortChecklistByStatus(chartData.tradeSetup.checklist).map((item) => (
                      <div key={item.label} className={`oi-history__signal-tile oi-history__signal-tile--${item.status}`}>
                        <span>{item.label}</span>
                        <strong>{checklistStatusText(item.status)}</strong>
                        <em>{item.answer}</em>
                      </div>
                    ))}
                  </div>
                  </div>
                  <div className="oi-history__setup-detail-section oi-history__setup-detail-section--selling">
                    <div className="oi-history__setup-section-heading">
                      <span>Option selling</span>
                      <strong>{setupReadinessLabel(chartData.sellingSetup.status, readinessScore(chartData.sellingSetup.checklist))}</strong>
                    </div>
                  <div className="oi-history__setup-signal-strip">
                    {sortChecklistByStatus(chartData.sellingSetup.checklist).map((item) => (
                      <div key={item.label} className={`oi-history__signal-tile oi-history__signal-tile--${item.status}`}>
                        <span>{item.label}</span>
                        <strong>{checklistStatusText(item.status)}</strong>
                        <em>{item.answer}</em>
                      </div>
                    ))}
                  </div>
                  </div>
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
              </details>
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

      {/* Clean old confirmation modal */}
      {confirmCleanOld && (
        <div className="oi-confirm-overlay" onClick={() => setConfirmCleanOld(false)}>
          <div className="oi-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h4 className="oi-confirm-modal__title">Clean Old Data</h4>
            <p className="oi-confirm-modal__text">
              Delete OI history for <strong>{scripOptions.find((o) => o.value === scrip)?.label || scrip}</strong> with expiry months older than <strong>{cleanupCutoffLabel}</strong>?
            </p>
            <p className="oi-confirm-modal__text">
              This keeps {cleanupCutoffLabel} and newer data for current comparisons. This cannot be undone.
            </p>
            <div className="oi-confirm-modal__actions">
              <button className="app-btn app-btn--secondary" onClick={() => setConfirmCleanOld(false)}>Cancel</button>
              <button className="app-btn app-btn--danger" onClick={handleCleanOld}>Clean Old Data</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OiHistory;
