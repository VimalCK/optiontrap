/**
 * IV-based OI flow
 *
 * The classic OI + price labels read an option's premium change as buying or
 * selling pressure, but a premium also moves with spot (delta), time (theta)
 * and chain-wide IV swings. Implied volatility strips out spot and time, and
 * comparing a strike's IV change with the ATM IV change of the same expiry
 * strips out chain-wide moves. What remains is closer to demand or supply for
 * that one option:
 *
 * - OI ↑ + IV ↑ vs ATM = Buyers Adding (buyers are paying up)
 * - OI ↑ + IV ↓ vs ATM = Writers Adding (writers are pressing premiums down)
 * - OI ↓ + IV ↓ vs ATM = Buyers Exiting
 * - OI ↓ + IV ↑ vs ATM = Writers Covering
 *
 * Kite does not publish IV, so it is solved from the premium with Black-76 on
 * each expiry's put-call parity forward (see impliedForward), which keeps
 * dividends out of the IV.
 * Each reading also carries freshness measures that make OI changes comparable
 * across strikes: delta-weighted size, how unusual the change is for this
 * strike, how much of the day's volume opened new positions, and how much of
 * the OI is recent.
 */

import type { OptionChainRow } from './optionChain';

export const RISK_FREE_RATE = 0.065;

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;
/** Below this the solved IV is too noisy to read (the last hours before expiry). */
const MIN_YEARS = 2 / (365 * 24);

/** Relative IV change, in vol points as a decimal (0.005 = 0.5 pts), that counts as a move. */
export const IV_MOVE_THRESHOLD = 0.005;
/** Fallback OI move threshold when the strike has too little history to judge what is unusual. */
export const OI_MOVE_PCT = 0.02;
/** OI change this many times the strike's median daily change counts as a move. */
export const UNUSUAL_RATIO = 1.5;
/** Ignore OI changes smaller than this share of the previous OI, however unusual. */
const MIN_OI_MOVE_PCT = 0.005;
const MIN_HISTORY_CHANGES = 3;
const HISTORY_WINDOW = 10;
export const RECENT_SESSIONS = 3;

export type FlowLabel =
  | 'Buyers Adding'
  | 'Writers Adding'
  | 'Buyers Exiting'
  | 'Writers Covering'
  | 'Unclear'
  | 'Stable'
  | '-';

export interface FlowInput {
  token: number;
  optionType: 'CE' | 'PE';
  strike: number;
  /** YYYY-MM-DD */
  expiry: string;
  oi: number;
  prevOi: number | undefined;
  price: number;
  prevPrice: number | undefined;
  spot: number;
  prevSpot: number | undefined;
  asOf: Date;
  prevAsOf: Date;
  /** Contracts traded today. */
  volume?: number;
  /** Daily closing OI before today, oldest first; the last value is prevOi. */
  oiHistory?: number[];
}

export interface FlowReading {
  label: FlowLabel;
  iv: number | null;
  prevIv: number | null;
  /** Change in IV, as a decimal (0.01 = 1 vol point). */
  ivChange: number | null;
  /** ATM IV change of the same expiry. */
  atmIvChange: number | null;
  /** ivChange minus atmIvChange: the part of the move specific to this strike. */
  relIvChange: number | null;
  delta: number | null;
  oiChange: number | null;
  /** OI change × |delta|: exposure in units of the underlying. */
  deltaOiChange: number | null;
  /** OI change ÷ volume: near 1 means trades opened new positions, near 0 means churn. */
  churn: number | null;
  /** |OI change| ÷ this strike's median daily |OI change|. */
  unusual: number | null;
  /** Share of current OI added over the last RECENT_SESSIONS sessions. */
  recentShare: number | null;
}

/** 15:30 IST on a YYYY-MM-DD date, when NSE options close. */
export function marketCloseIST(date: string): Date {
  return new Date(`${date}T15:30:00+05:30`);
}

/** Close of the last weekday before today in IST (exchange holidays are not known here). */
export function previousSessionClose(now = new Date()): Date {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  do {
    day.setUTCDate(day.getUTCDate() - 1);
  } while (day.getUTCDay() === 0 || day.getUTCDay() === 6);
  return marketCloseIST(day.toISOString().slice(0, 10));
}

export function yearsToExpiry(asOf: Date, expiry: string): number {
  return (marketCloseIST(expiry.slice(0, 10)).getTime() - asOf.getTime()) / MS_PER_YEAR;
}

/** Premiums below this are too coarse (tick-sized) to read parity from. */
const MIN_PARITY_PRICE = 0.5;
/** Parity forwards from this many strikes nearest the money are combined by median. */
const PARITY_STRIKES = 5;
const MIN_PARITY_STRIKES = 3;
/** A parity forward further than this from spot × e^(rT) is treated as bad data. */
const MAX_FORWARD_GAP = 0.03;

export interface ParityLeg {
  optionType: 'CE' | 'PE';
  strike: number;
  price: number;
  volume?: number;
}

export interface ForwardEstimate {
  forward: number;
  /** 'parity' when implied from CE/PE prices, 'carry' when it fell back to spot × e^(rT). */
  source: 'parity' | 'carry';
  /**
   * Spot to give the Black-Scholes helpers so they price Black-76 on the forward:
   * forward × e^(−rT). It sits below spot by the value of dividends due before expiry.
   */
  pricingSpot: number;
}

/**
 * One expiry's forward, implied by put-call parity F = K + e^(rT)(C − P) as the median
 * over the strikes nearest the money (where both legs trade most). This carries
 * dividends and the market's own funding rate. Falls back to spot × e^(rT) when too
 * few strikes have both legs, or when parity lands implausibly far from it.
 */
export function impliedForward(legs: ParityLeg[], spot: number, years: number): ForwardEstimate {
  const growth = Math.exp(RISK_FREE_RATE * years);
  const carry = { forward: spot * growth, source: 'carry' as const, pricingSpot: spot };
  if (!(years > 0) || !(spot > 0)) return carry;

  const byStrike = new Map<number, { CE?: number; PE?: number }>();
  for (const leg of legs) {
    if (!(leg.price >= MIN_PARITY_PRICE) || leg.volume === 0) continue;
    const entry = byStrike.get(leg.strike) ?? {};
    entry[leg.optionType] = leg.price;
    byStrike.set(leg.strike, entry);
  }
  const candidates: { gap: number; forward: number }[] = [];
  for (const [strike, { CE, PE }] of byStrike) {
    if (CE === undefined || PE === undefined) continue;
    candidates.push({ gap: Math.abs(CE - PE), forward: strike + growth * (CE - PE) });
  }
  if (candidates.length < MIN_PARITY_STRIKES) return carry;

  const nearest = candidates.sort((x, y) => x.gap - y.gap).slice(0, PARITY_STRIKES).map((c) => c.forward);
  const forward = median(nearest)!;
  if (Math.abs(forward / carry.forward - 1) > MAX_FORWARD_GAP) return carry;
  return { forward, source: 'parity', pricingSpot: forward / growth };
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, error < 1.5e-7). */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export function d1(spot: number, strike: number, years: number, vol: number, rate = RISK_FREE_RATE): number {
  return (Math.log(spot / strike) + (rate + (vol * vol) / 2) * years) / (vol * Math.sqrt(years));
}

export function bsPrice(type: 'CE' | 'PE', spot: number, strike: number, years: number, vol: number, rate = RISK_FREE_RATE): number {
  const a = d1(spot, strike, years, vol, rate);
  const b = a - vol * Math.sqrt(years);
  const discounted = strike * Math.exp(-rate * years);
  return type === 'CE'
    ? spot * normCdf(a) - discounted * normCdf(b)
    : discounted * normCdf(-b) - spot * normCdf(-a);
}

export function bsDelta(type: 'CE' | 'PE', spot: number, strike: number, years: number, vol: number, rate = RISK_FREE_RATE): number {
  const n = normCdf(d1(spot, strike, years, vol, rate));
  return type === 'CE' ? n : n - 1;
}

/** IV that reproduces the premium, or null when the premium has no time value or inputs are unusable. */
export function impliedVol(type: 'CE' | 'PE', price: number, spot: number, strike: number, years: number, rate = RISK_FREE_RATE): number | null {
  if (!(price > 0) || !(spot > 0) || !(strike > 0) || !(years >= MIN_YEARS)) return null;
  const discounted = strike * Math.exp(-rate * years);
  const intrinsic = type === 'CE' ? Math.max(0, spot - discounted) : Math.max(0, discounted - spot);
  if (price <= intrinsic + 1e-6) return null;

  let lo = 0.005;
  let hi = 5;
  if (price > bsPrice(type, spot, strike, years, hi, rate)) return null;
  if (price < bsPrice(type, spot, strike, years, lo, rate)) return null;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (bsPrice(type, spot, strike, years, mid, rate) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** |OI change| relative to the strike's median daily |OI change|, or null without enough history. */
function unusualRatio(oiChange: number, oiHistory: number[] | undefined): number | null {
  if (!oiHistory || oiHistory.length < MIN_HISTORY_CHANGES + 1) return null;
  const recent = oiHistory.slice(-(HISTORY_WINDOW + 1));
  const changes: number[] = [];
  for (let i = 1; i < recent.length; i++) changes.push(Math.abs(recent[i] - recent[i - 1]));
  const typical = median(changes);
  if (!typical) return null;
  return Math.abs(oiChange) / typical;
}

function recentShare(oi: number, oiHistory: number[] | undefined): number | null {
  if (!oiHistory || oiHistory.length < RECENT_SESSIONS || !(oi > 0)) return null;
  const base = oiHistory[oiHistory.length - RECENT_SESSIONS];
  return Math.min(1, (oi - base) / oi);
}

export function classifyFlow(oiMoved: boolean, oiChange: number, relIvChange: number | null): FlowLabel {
  if (relIvChange === null) return '-';
  if (!oiMoved) return 'Stable';
  if (Math.abs(relIvChange) < IV_MOVE_THRESHOLD) return 'Unclear';
  if (oiChange > 0) return relIvChange > 0 ? 'Buyers Adding' : 'Writers Adding';
  return relIvChange < 0 ? 'Buyers Exiting' : 'Writers Covering';
}

/** ATM IV change per expiry: the average of the CE and PE nearest to spot that have an IV change. */
function atmIvChanges(inputs: FlowInput[], ivChanges: Map<number, number>): Map<string, number> {
  const nearest = new Map<string, { CE?: { dist: number; chg: number }; PE?: { dist: number; chg: number } }>();
  for (const input of inputs) {
    const chg = ivChanges.get(input.token);
    if (chg === undefined) continue;
    const dist = Math.abs(input.strike - input.spot);
    const entry = nearest.get(input.expiry) ?? {};
    const best = entry[input.optionType];
    if (!best || dist < best.dist) entry[input.optionType] = { dist, chg };
    nearest.set(input.expiry, entry);
  }

  const result = new Map<string, number>();
  for (const [expiry, entry] of nearest) {
    const values = [entry.CE?.chg, entry.PE?.chg].filter((v): v is number => v !== undefined);
    if (values.length) result.set(expiry, values.reduce((a, b) => a + b, 0) / values.length);
  }
  return result;
}

/** Flow readings for a chain snapshot, keyed by instrument token. Pass every strike so ATM can be found. */
export function computeFlowReadings(inputs: FlowInput[]): Map<number, FlowReading> {
  const solved = new Map<number, { iv: number | null; prevIv: number | null; delta: number | null }>();
  const ivChanges = new Map<number, number>();

  // Price each expiry on its parity forward, today and at the previous close, so a
  // dividend going ex between the two doesn't read as an IV move.
  const byExpiry = new Map<string, FlowInput[]>();
  for (const input of inputs) {
    const list = byExpiry.get(input.expiry);
    if (list) list.push(input);
    else byExpiry.set(input.expiry, [input]);
  }
  const pricingSpots = new Map<string, { now: number; prev: number | undefined }>();
  for (const [expiry, list] of byExpiry) {
    const first = list[0];
    const now = impliedForward(list, first.spot, yearsToExpiry(first.asOf, expiry)).pricingSpot;
    const prevSpot = list.find((i) => i.prevSpot !== undefined)?.prevSpot;
    const prevLegs = list.flatMap((i) => (i.prevPrice !== undefined ? [{ ...i, price: i.prevPrice, volume: undefined }] : []));
    const prev = prevSpot !== undefined
      ? impliedForward(prevLegs, prevSpot, yearsToExpiry(first.prevAsOf, expiry)).pricingSpot
      : undefined;
    pricingSpots.set(expiry, { now, prev });
  }

  for (const input of inputs) {
    const years = yearsToExpiry(input.asOf, input.expiry);
    const prevYears = yearsToExpiry(input.prevAsOf, input.expiry);
    const spots = pricingSpots.get(input.expiry)!;
    const iv = impliedVol(input.optionType, input.price, spots.now, input.strike, years);
    const prevIv = input.prevPrice !== undefined && spots.prev !== undefined
      ? impliedVol(input.optionType, input.prevPrice, spots.prev, input.strike, prevYears)
      : null;
    const delta = iv !== null ? bsDelta(input.optionType, spots.now, input.strike, years, iv) : null;
    solved.set(input.token, { iv, prevIv, delta });
    if (iv !== null && prevIv !== null) ivChanges.set(input.token, iv - prevIv);
  }

  const atm = atmIvChanges(inputs, ivChanges);
  const readings = new Map<number, FlowReading>();

  for (const input of inputs) {
    const { iv, prevIv, delta } = solved.get(input.token)!;
    const ivChange = ivChanges.get(input.token) ?? null;
    const atmIvChange = atm.get(input.expiry) ?? null;
    const relIvChange = ivChange !== null ? ivChange - (atmIvChange ?? 0) : null;

    const hasPrevOi = input.prevOi !== undefined && input.prevOi > 0;
    const oiChange = hasPrevOi ? input.oi - input.prevOi! : null;
    const unusual = oiChange !== null ? unusualRatio(oiChange, input.oiHistory) : null;
    let oiMoved = false;
    if (oiChange !== null) {
      const pct = Math.abs(oiChange) / input.prevOi!;
      oiMoved = unusual !== null ? unusual >= UNUSUAL_RATIO && pct >= MIN_OI_MOVE_PCT : pct > OI_MOVE_PCT;
    }

    readings.set(input.token, {
      label: oiChange === null ? '-' : classifyFlow(oiMoved, oiChange, relIvChange),
      iv,
      prevIv,
      ivChange,
      atmIvChange,
      relIvChange,
      delta,
      oiChange,
      deltaOiChange: oiChange !== null && delta !== null ? oiChange * Math.abs(delta) : null,
      churn: oiChange !== null && input.volume ? oiChange / input.volume : null,
      unusual,
      recentShare: recentShare(input.oi, input.oiHistory),
    });
  }

  return readings;
}

/**
 * Flow readings for a live chain against the previous close. There is no daily
 * OI history here, so OI moves fall back to the flat threshold and the
 * unusual / recent-share measures stay empty.
 */
export function computeLiveFlow(
  chain: OptionChainRow[],
  oiData: Map<number, number>,
  prevDayOi: Map<number, number>,
  livePrices: Map<number, number>,
  closePrices: Map<number, number>,
  spot: number,
  prevSpot: number | undefined,
  volumeData?: Map<number, number>,
  now = new Date(),
): Map<number, FlowReading> {
  if (!(spot > 0)) return new Map();
  const prevAsOf = previousSessionClose(now);
  const inputs: FlowInput[] = [];
  for (const row of chain) {
    for (const option of [row.ce, row.pe]) {
      if (!option) continue;
      const oi = oiData.get(option.instrumentToken);
      const price = livePrices.get(option.instrumentToken);
      if (oi === undefined || price === undefined) continue;
      inputs.push({
        token: option.instrumentToken,
        optionType: option.instrumentType,
        strike: row.strike,
        expiry: option.expiry,
        oi,
        prevOi: prevDayOi.get(option.instrumentToken),
        price,
        prevPrice: closePrices.get(option.instrumentToken),
        spot,
        prevSpot,
        asOf: now,
        prevAsOf,
        volume: volumeData?.get(option.instrumentToken),
      });
    }
  }
  return computeFlowReadings(inputs);
}

export function flowColor(label: FlowLabel): string {
  if (label === 'Buyers Adding' || label === 'Writers Covering') return '#22c55e';
  if (label === 'Writers Adding' || label === 'Buyers Exiting') return '#ef4444';
  return 'var(--text-secondary)';
}

function signed(value: number, digits = 1): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function compact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : value > 0 ? '+' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

/** Short lines explaining a reading, for tooltips. */
export function describeFlow(reading: FlowReading): string[] {
  const lines: string[] = [];
  if (reading.iv !== null) {
    let line = `IV ${(reading.iv * 100).toFixed(1)}%`;
    if (reading.ivChange !== null) line += ` (${signed(reading.ivChange * 100)} pts`;
    if (reading.ivChange !== null && reading.relIvChange !== null && reading.atmIvChange !== null) line += `, ${signed(reading.relIvChange * 100)} vs ATM`;
    if (reading.ivChange !== null) line += ')';
    lines.push(line);
  } else {
    lines.push('IV unavailable (no time value or too close to expiry)');
  }
  if (reading.deltaOiChange !== null && reading.delta !== null) {
    lines.push(`Delta-weighted OI chg ${compact(reading.deltaOiChange)} (delta ${reading.delta.toFixed(2)})`);
  }
  if (reading.unusual !== null) lines.push(`${reading.unusual.toFixed(1)}× this strike's usual daily OI change`);
  if (reading.churn !== null) lines.push(`OI chg is ${signed(reading.churn * 100, 0)}% of volume (low = churn)`);
  if (reading.recentShare !== null) lines.push(`${(reading.recentShare * 100).toFixed(0)}% of OI added in last ${RECENT_SESSIONS} sessions`);
  return lines;
}
