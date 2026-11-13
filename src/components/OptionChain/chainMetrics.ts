import type { OptionChainRow, OptionInstrument } from '@/services/optionChain';
import type { QuoteData } from '@/services/kiteApi';
import type { OiSnapshot } from '@/services/oiSnapshots';
import type { Tick } from '@/services/kiteTicker';
import { Exchange } from '../../../shared/tradeEnums.js';

/** Strikes each side of the ATM whose quotes are fetched while the market is closed (the chain shows 31). */
const QUOTE_STRIKES_EACH_SIDE = 15;
/** An OI change this large (vs the previous day) counts as a real move. */
const OI_CHANGE_SHARE = 0.03;
/** Volume this many times the chain's average confirms an OI move. */
const CONFIRMING_VOLUME = 1.5;
/** The tooltip's height above the tallest bar: the bar group is 180 px, plus a 16 px gap. */
const BAR_GROUP_PX = 180;
const TOOLTIP_GAP_PX = 16;
/** The narrowest a strike label can be without overlapping its neighbours. */
const STRIKE_LABEL_PX = 36;

export interface Change { pct: number; color: string }

/** The % change from `previous` with its colour class, or null without both values (or a zero base). */
export function percentChange(current: number | undefined, previous: number | undefined): Change | null {
  if (current === undefined || previous === undefined || previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  return { pct, color: pct > 0 ? 'positive' : pct < 0 ? 'negative' : '' };
}

export const signedPercent = (pct: number) => `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;

/** The live price of an option, or null until it has a positive one. */
export function optionPrice(instrument: OptionInstrument | null, prices: Map<number, number>): number | null {
  if (!instrument) return null;
  const live = prices.get(instrument.instrumentToken);
  return live !== undefined && live > 0 ? live : null;
}

export const valueOf = (instrument: OptionInstrument | null, values: Map<number, number>): number =>
  (instrument ? values.get(instrument.instrumentToken) || 0 : 0);

/** The largest CE or PE OI in the chain. */
export const maxChainOi = (chain: OptionChainRow[], oi: Map<number, number>): number =>
  chain.reduce((max, row) => Math.max(max, valueOf(row.ce, oi), valueOf(row.pe, oi)), 0);

/** The chain's instrument tokens, CE before PE strike by strike. */
export function chainTokens(chain: OptionChainRow[]): number[] {
  const tokens: number[] = [];
  for (const row of chain) {
    if (row.ce) tokens.push(row.ce.instrumentToken);
    if (row.pe) tokens.push(row.pe.instrumentToken);
  }
  return tokens;
}

/** The strikes whose quotes are fetched while closed: up to 15 each side of the ATM. */
export function quoteStrikes(chain: OptionChainRow[], atmStrike: number): OptionChainRow[] {
  const atmIndex = chain.findIndex((r) => r.strike === atmStrike);
  return chain.slice(Math.max(0, atmIndex - QUOTE_STRIKES_EACH_SIDE), Math.min(chain.length, atmIndex + QUOTE_STRIKES_EACH_SIDE + 1));
}

const quoteKey = (instrument: OptionInstrument) => `${Exchange.NFO}:${instrument.tradingsymbol}`;
const chainInstruments = (strikes: OptionChainRow[]) => strikes.flatMap((row) => [row.ce, row.pe].filter((i): i is OptionInstrument => i !== null));

/** The quote keys to request: the spot first (when known), then each option. */
export const quoteKeys = (strikes: OptionChainRow[], spotQuoteKey: string | null): string[] =>
  [...(spotQuoteKey ? [spotQuoteKey] : []), ...chainInstruments(strikes).map(quoteKey)];

export interface ChainPrices { prices: Map<number, number>; oi: Map<number, number>; close: Map<number, number> }

/** Each option's last price, OI and previous close (where positive) from its quote, and the keys with no quote. */
export function pricesFromQuotes(strikes: OptionChainRow[], quotes: Map<string, QuoteData>): ChainPrices & { missing: string[] } {
  const result: ChainPrices & { missing: string[] } = { prices: new Map(), oi: new Map(), close: new Map(), missing: [] };
  for (const instrument of chainInstruments(strikes)) {
    const quote = quotes.get(quoteKey(instrument));
    if (!quote) {
      result.missing.push(quoteKey(instrument));
      continue;
    }
    result.prices.set(instrument.instrumentToken, quote.last_price);
    result.oi.set(instrument.instrumentToken, quote.oi);
    if (quote.ohlc.close > 0) result.close.set(instrument.instrumentToken, quote.ohlc.close);
  }
  return result;
}

const byToken = (values: Record<string, number>) => new Map(Object.entries(values).map(([k, v]) => [Number(k), v]));

/** A server snapshot's prices, OI and closes by token (each only when the snapshot has it). */
export const pricesFromSnapshot = (snapshot: OiSnapshot): Partial<ChainPrices> => ({
  prices: snapshot.prices ? byToken(snapshot.prices) : undefined,
  oi: snapshot.data ? byToken(snapshot.data) : undefined,
  close: snapshot.close ? byToken(snapshot.close) : undefined,
});

/** The map with each tick's value (where `pick` gives one) set on its token; the same map when nothing changes. */
export function withTicks(prev: Map<number, number>, ticks: Tick[], pick: (tick: Tick) => number | undefined): Map<number, number> {
  const values = ticks.map((tick) => [tick.instrumentToken, pick(tick)] as const).filter((entry): entry is readonly [number, number] => entry[1] !== undefined);
  if (values.length === 0) return prev;
  const next = new Map(prev);
  for (const [token, value] of values) next.set(token, value);
  return next;
}

/** The chart's shaded expected range (the strikes within ± the move of the spot), as left/right % of the chart. */
export function expectedRangeBand(chain: OptionChainRow[], spot: number, move: number): { left: number; right: number } | null {
  if (!(move > 0) || !(spot > 0) || chain.length < 2) return null;
  const inside = chain.map((row) => row.strike >= spot - move && row.strike <= spot + move);
  const start = inside.indexOf(true);
  if (start === -1) return null;
  const end = inside.lastIndexOf(true);
  return { left: (start / chain.length) * 100, right: 100 - ((end + 1) / chain.length) * 100 };
}

/** An OI axis label in crore, lakh or thousand: 12500000 → 1.3Cr. */
export function oiAxisLabel(value: number): string {
  if (value <= 0) return '0';
  if (value >= 10000000) return `${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000) return `${(value / 100000).toFixed(1)}L`;
  return `${(value / 1000).toFixed(0)}K`;
}

/** Every other strike label at least; more apart when the columns are too narrow for one each. */
export const strikeLabelStep = (chartWidth: number, columns: number): number =>
  (chartWidth > 0 && columns > 0 ? Math.max(2, Math.ceil(STRIKE_LABEL_PX / (chartWidth / columns))) : 2);

export interface OiBar {
  oi: number;
  prevOi: number;
  /** Today's OI as % of the chart height. */
  height: number;
  /** The part added since yesterday, as % of the bar (0 when OI fell or there is no yesterday). */
  addedPct: number;
  /** Yesterday's OI as % of the chart height when it was higher (a marker of the OI that left), else null. */
  shedMarker: number | null;
  /** The OI moved over 3% on volume over 1.5× the chain's average. */
  confirmed: boolean;
}

/** One option's OI bar against the chart's largest OI. */
export function oiBar(oi: number, prevOi: number, volume: number, maxOi: number, averageVolume: number): OiBar {
  const height = maxOi > 0 ? (oi / maxOi) * 100 : 0;
  const prevHeight = maxOi > 0 ? (Math.min(prevOi, oi) / maxOi) * 100 : 0;
  const changed = prevOi > 0 && Math.abs(oi - prevOi) / prevOi > OI_CHANGE_SHARE;
  return {
    oi,
    prevOi,
    height,
    addedPct: oi > prevOi && prevOi > 0 ? ((height - prevHeight) / height) * 100 : 0,
    shedMarker: prevOi > oi && maxOi > 0 ? (prevOi / maxOi) * 100 : null,
    confirmed: changed && volume > averageVolume * CONFIRMING_VOLUME,
  };
}

/** How far above the column's bottom a tooltip sits so it clears the chart's tallest bar. */
export function tooltipBottomPx(chain: OptionChainRow[], oi: Map<number, number>, maxOi: number): number {
  const tallest = maxOi > 0 ? (maxChainOi(chain, oi) / maxOi) * 100 : 0;
  return (tallest / 100) * BAR_GROUP_PX + TOOLTIP_GAP_PX;
}
