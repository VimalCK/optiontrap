import type { OiCellData, OiHistoryRow, OiTableRow } from './types';
import { classifyPattern } from './analysis';
import { todayIST } from './helpers';
import { marketCloseIST, type FlowInput } from '@/services/oiFlow';
import type { FairInput } from '@/services/fairValue';
import { OptionType, isOptionType } from '../../../shared/tradeEnums.js';
import { StrikeMode, type StrikeModeId } from '../../../shared/appEnums.js';

/** The Strikes picker: a number of strikes each side of the ATM, every stored strike, or one specific strike. */
export const STRIKE_RANGE = Object.freeze({ All: 0, Specific: -1 });
export const STRIKE_RANGE_CHOICES = [5, 10, 20, STRIKE_RANGE.All, STRIKE_RANGE.Specific];
export const DEFAULT_STRIKE_RANGE = 10;

/** Which strikes the server fetches for a Strikes choice. */
export const strikeModeFor = (strikeRange: number): StrikeModeId => (
  strikeRange === STRIKE_RANGE.Specific ? StrikeMode.Specific : strikeRange === STRIKE_RANGE.All ? StrikeMode.AllStored : StrikeMode.AtmRange
);

/** OI below this share of the grid's largest is dimmed: it adapts to any scrip (indices have millions, stocks thousands). */
const SIGNIFICANT_OI_SHARE = 0.05;
const MIN_SIGNIFICANT_OI = 1000;

const EXPIRY_PALETTE = ['#6366f1', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#06b6d4'];

export const sortedUnique = (values: (string | null)[]): string[] => [...new Set(values.filter((v): v is string => !!v))].sort();

/** Consecutive dates grouped by their month (YYYY-MM), in order. */
export function groupDatesByMonth(dates: string[]): { month: string; dates: string[] }[] {
  const groups: { month: string; dates: string[] }[] = [];
  for (const date of dates) {
    const month = date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.dates.push(date);
    else groups.push({ month, dates: [date] });
  }
  return groups;
}

/** The date a freshly loaded history opens on: its latest date from the current month on, else its latest. */
export function latestVisibleDate(rows: OiHistoryRow[], currentMonth: string): string | null {
  const dates = sortedUnique(rows.map((r) => r.date));
  if (dates.length === 0) return null;
  const visible = dates.filter((date) => date.slice(0, 7) >= currentMonth);
  return visible[visible.length - 1] || dates[dates.length - 1];
}

/** Each row's OI and close (where it traded) by instrument token. */
export function oiAndCloseByToken(rows: OiHistoryRow[]): { oi: Map<number, number>; close: Map<number, number> } {
  const oi = new Map<number, number>();
  const close = new Map<number, number>();
  for (const r of rows) {
    oi.set(r.instrumentToken, r.oi);
    if (r.close > 0) close.set(r.instrumentToken, r.close);
  }
  return { oi, close };
}

/** Daily OI per option token, oldest first, for judging how unusual and how recent an OI change is. */
export function oiSeriesByToken(rows: OiHistoryRow[]): Map<number, { date: string; oi: number }[]> {
  const map = new Map<number, { date: string; oi: number }[]>();
  for (const r of rows) {
    if (!r.optionType) continue;
    const list = map.get(r.instrumentToken);
    if (list) list.push({ date: r.date, oi: r.oi });
    else map.set(r.instrumentToken, [{ date: r.date, oi: r.oi }]);
  }
  for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return map;
}

export function rowsByDate(rows: OiHistoryRow[]): Map<string, OiHistoryRow[]> {
  const map = new Map<string, OiHistoryRow[]>();
  for (const r of rows) {
    const list = map.get(r.date);
    if (list) list.push(r);
    else map.set(r.date, [r]);
  }
  return map;
}

/** When a day's prices were taken: the close, or now for today's rows, which are a live snapshot until the close. */
export function snapshotTime(date: string, now = new Date()): Date {
  const close = marketCloseIST(date);
  return date === todayIST(now) ? new Date(Math.min(now.getTime(), close.getTime())) : close;
}

/** The priced options of a day (of one expiry when given), as fair-value inputs. */
export function fairInputs(rows: OiHistoryRow[], date: string, expiry?: string, now = new Date()): FairInput[] {
  const asOf = snapshotTime(date, now);
  const inputs: FairInput[] = [];
  for (const r of rows) {
    if (!r.strike || !r.expiry || !isOptionType(r.optionType) || !(r.spotClose > 0) || !(r.close > 0)) continue;
    if (expiry && r.expiry !== expiry) continue;
    inputs.push({ token: r.instrumentToken, optionType: r.optionType, strike: r.strike, expiry: r.expiry, price: r.close, spot: r.spotClose, asOf, volume: r.volume });
  }
  return inputs;
}

/** The day's options against the previous day, as OI flow inputs; each carries its OI on every date before the day. */
export function flowInputs(
  dayRows: OiHistoryRow[],
  prevRows: OiHistoryRow[],
  date: string,
  prevDate: string,
  oiSeries: Map<number, { date: string; oi: number }[]>,
  now = new Date(),
): FlowInput[] {
  const prev = oiAndCloseByToken(prevRows);
  const prevSpot = prevRows.find((r) => r.spotClose > 0)?.spotClose;
  const asOf = snapshotTime(date, now);
  const prevAsOf = marketCloseIST(prevDate);
  const inputs: FlowInput[] = [];
  for (const r of dayRows) {
    if (!r.strike || !r.expiry || !isOptionType(r.optionType) || !(r.spotClose > 0)) continue;
    inputs.push({
      token: r.instrumentToken,
      optionType: r.optionType,
      strike: r.strike,
      expiry: r.expiry,
      oi: r.oi,
      prevOi: prev.oi.get(r.instrumentToken),
      price: r.close,
      prevPrice: prev.close.get(r.instrumentToken),
      spot: r.spotClose,
      prevSpot,
      asOf,
      prevAsOf,
      volume: r.volume,
      oiHistory: (oiSeries.get(r.instrumentToken) ?? []).filter((entry) => entry.date < date).map((entry) => entry.oi),
    });
  }
  return inputs;
}

/** The strike nearest the day's spot (the first row's), or null without strikes. */
export function nearestStrike(dayRows: OiHistoryRow[]): number | null {
  if (dayRows.length === 0) return null;
  const spot = dayRows[0].spotClose;
  const strikes = sortedUniqueNumbers(dayRows.map((r) => r.strike));
  if (strikes.length === 0) return null;
  let closest = strikes[0];
  for (const s of strikes) {
    if (Math.abs(s - spot) < Math.abs(closest - spot)) closest = s;
  }
  return closest;
}

const sortedUniqueNumbers = (values: (number | null)[]): number[] => [...new Set(values.filter((v): v is number => !!v))].sort((a, b) => a - b);

const emptyCell = (): OiCellData => ({
  ceOi: 0, peOi: 0,
  cePrevOi: undefined, pePrevOi: undefined,
  ceClose: 0, peClose: 0,
  cePrevClose: undefined, pePrevClose: undefined,
  ceToken: undefined, peToken: undefined,
  ceTradingsymbol: undefined, peTradingsymbol: undefined,
  ceExpiry: undefined, peExpiry: undefined,
});

/** The day's rows as a strike × expiry grid of CE and PE cells, each with the previous day's OI and close. */
function oiGrid(dayRows: OiHistoryRow[], prevRows: OiHistoryRow[], expiries: string[]): Map<number, Map<string, OiCellData>> {
  const prev = oiAndCloseByToken(prevRows);
  const shown = new Set(expiries);
  const grid = new Map<number, Map<string, OiCellData>>();
  for (const r of dayRows) {
    if (!r.strike || !r.optionType || !r.expiry || !shown.has(r.expiry)) continue;
    let strikeCells = grid.get(r.strike);
    if (!strikeCells) grid.set(r.strike, (strikeCells = new Map()));
    let cell = strikeCells.get(r.expiry);
    if (!cell) strikeCells.set(r.expiry, (cell = emptyCell()));

    const prevOi = prev.oi.get(r.instrumentToken);
    const prevClose = prev.close.get(r.instrumentToken);
    if (r.optionType === OptionType.CE) {
      Object.assign(cell, { ceOi: r.oi, ceClose: r.close, ceToken: r.instrumentToken, ceTradingsymbol: r.tradingsymbol, ceExpiry: r.expiry, cePrevOi: prevOi, cePrevClose: prevClose });
    } else {
      Object.assign(cell, { peOi: r.oi, peClose: r.close, peToken: r.instrumentToken, peTradingsymbol: r.tradingsymbol, peExpiry: r.expiry, pePrevOi: prevOi, pePrevClose: prevClose });
    }
  }
  return grid;
}

type SideSeries = Map<string, { oi: number; prevOi: number | undefined; close: number; prevClose: number | undefined }>;

/**
 * The OI table: one row per strike with its cells, each side's OI pattern, and the OI summed over the weekly expiries
 * (all expiries when there is no weekly). A strike whose OI never reaches 5% of the grid's largest is dimmed.
 */
export function buildOiTable(
  dayRows: OiHistoryRow[],
  prevRows: OiHistoryRow[],
  expiries: string[],
  isMonthlyExpiry: (expiry: string) => boolean,
): OiTableRow[] {
  if (dayRows.length === 0 || expiries.length === 0) return [];
  const grid = oiGrid(dayRows, prevRows, expiries);

  let maxOi = 0;
  for (const cells of grid.values()) {
    for (const cell of cells.values()) maxOi = Math.max(maxOi, cell.ceOi, cell.peOi);
  }
  const significantOi = Math.max(MIN_SIGNIFICANT_OI, maxOi * SIGNIFICANT_OI_SHARE);

  return [...grid.entries()]
    .sort(([a], [b]) => a - b)
    .map(([strike, cells]) => {
      const ceSeries: SideSeries = new Map();
      const peSeries: SideSeries = new Map();
      for (const [expiry, cell] of cells) {
        if (cell.ceOi > 0) ceSeries.set(expiry, { oi: cell.ceOi, prevOi: cell.cePrevOi, close: cell.ceClose, prevClose: cell.cePrevClose });
        if (cell.peOi > 0) peSeries.set(expiry, { oi: cell.peOi, prevOi: cell.pePrevOi, close: cell.peClose, prevClose: cell.pePrevClose });
      }
      const weekly = expiries.filter((expiry) => !isMonthlyExpiry(expiry) && cells.has(expiry));
      let ceConsolidatedOi = 0;
      let peConsolidatedOi = 0;
      for (const expiry of weekly.length > 0 ? weekly : expiries) {
        const cell = cells.get(expiry);
        if (!cell) continue;
        ceConsolidatedOi += cell.ceOi;
        peConsolidatedOi += cell.peOi;
      }
      return {
        strike,
        cells,
        cePattern: classifyPattern(ceSeries, expiries),
        pePattern: classifyPattern(peSeries, expiries),
        ceConsolidatedOi,
        peConsolidatedOi,
        dimmed: ![...cells.values()].some((cell) => cell.ceOi > significantOi || cell.peOi > significantOi),
      };
    });
}

/** The rows the Strikes choice shows: the specific strike, `strikeRange` strikes each side of the ATM, or all. */
export function strikesInRange(rows: OiTableRow[], strikeRange: number, specificStrike: number | null, atmStrike: number | null): OiTableRow[] {
  if (strikeRange === STRIKE_RANGE.Specific) {
    return specificStrike === null ? [] : rows.filter((row) => row.strike === specificStrike);
  }
  if (strikeRange > 0 && atmStrike && rows.length > 0) {
    const atmIndex = rows.findIndex((r) => r.strike >= atmStrike);
    const center = atmIndex >= 0 ? atmIndex : Math.floor(rows.length / 2);
    return rows.slice(Math.max(0, center - strikeRange), Math.min(rows.length, center + strikeRange + 1));
  }
  return rows;
}

export const maxConsolidatedOi = (rows: OiTableRow[]): number =>
  rows.reduce((max, row) => Math.max(max, row.ceConsolidatedOi, row.peConsolidatedOi), 0);

/** One colour per expiry, in order, cycling through the palette. */
export function expiryColors(expiries: string[]): Map<string, string> {
  return new Map(expiries.map((expiry, i) => [expiry, EXPIRY_PALETTE[i % EXPIRY_PALETTE.length]]));
}

/** One side of a grid cell: its instrument, symbol and day close (any may be missing). */
export const cellOption = (cell: OiCellData, optionType: string) => (optionType === OptionType.CE
  ? { token: cell.ceToken, tradingsymbol: cell.ceTradingsymbol, close: cell.ceClose }
  : { token: cell.peToken, tradingsymbol: cell.peTradingsymbol, close: cell.peClose });
