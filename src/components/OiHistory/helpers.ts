import type { FuturesHistoryRow, RolloverPattern } from './types';

/** Default scrip options shown before dynamic list loads */
export const DEFAULT_SCRIP_OPTIONS = [
  { value: 'NIFTY50', label: 'NIFTY 50' },
  { value: 'BANKNIFTY', label: 'BANK NIFTY' },
];

export const RECENT_SCRIPS_KEY = 'optiontrap_oi_history_recent_scrips';
export const MAX_RECENT_SCRIPS = 5;

export function loadRecentScrips(): string[] {
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

export function saveRecentScrips(scrips: string[]): void {
  localStorage.setItem(RECENT_SCRIPS_KEY, JSON.stringify(scrips.slice(0, MAX_RECENT_SCRIPS)));
}

/** Compact OI display: 11,400,000 → 11.4M, 850,000 → 850K */
export function formatOiCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

/** Format OI with change: "1.9M (+37%)" */
export function formatOiWithChg(oi: number, prev: number | undefined): { text: string; chgCls: string } {
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
export function currentMonthIST(): string {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function addMonths(month: string, delta: number): string {
  const [year, monthIndex] = month.split('-').map(Number);
  const date = new Date(year, monthIndex - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Format a month string (YYYY-MM) to label (e.g., "July 2026") */
/** Price line colours per futures month, nearest first (OI/volume bars use purple/cyan). */
export const FUTURES_LINE_COLORS = ['#22c55e', '#f59e0b', '#ec4899', '#3b82f6'];

/** Daily price/OI changes and signal for one futures contract's history. */
export function buildFuturesSeries(contractRows: FuturesHistoryRow[]) {
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

export function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Format a month string (YYYY-MM) to short label (e.g., "Jul '26") */
export function formatMonthShortLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const mon = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' });
  return `${mon} '${String(y).slice(2)}`;
}

/** Format a full date (YYYY-MM-DD) to label (e.g., "Mon, Jul 1") */
export function formatFullDateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Determine price direction: 'up' if price rose, 'down' if fell, null if unknown */
export function priceDirection(
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

export function classifyOptionMove(oi: number, prevOi: number | undefined, close: number, prevClose: number | undefined): RolloverPattern {
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

export function patternBiasScore(pattern: RolloverPattern, optionType: 'CE' | 'PE'): number {
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

export function pctChange(start: number, end: number): number | null {
  if (start <= 0) return null;
  return ((end - start) / start) * 100;
}

export function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(0)}%`;
}

export function formatPcr(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return value.toFixed(2);
}

