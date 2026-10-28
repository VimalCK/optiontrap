/**
 * Option fair value
 *
 * A strike's IV is compared with a smooth volatility curve fitted through the
 * whole expiry, not with one flat IV: OTM puts normally carry more IV than
 * calls, and a flat IV would mark them all as "rich". The curve is a quadratic
 * in log-moneyness k = ln(K / F) fitted to the out-of-the-money side of each
 * strike (the liquid side). Fair value is the option's price at the curve's IV.
 *
 * Pricing is Black-76 on each expiry's forward rather than Black-Scholes on
 * spot. The forward is implied from put-call parity (see impliedForward in
 * oiFlow), so it already carries dividends and the market's own funding rate.
 *
 * The same pass gives each option its market-implied chance of finishing in
 * the money, the CE-vs-PE IV gap at its strike (a put-call parity check), and
 * the ATM straddle as the expected move for its expiry. realizedVol() measures
 * how much spot actually moved, to compare with ATM IV for the whole chain.
 */

import { bsPrice, d1, impliedForward, impliedVol, normCdf, yearsToExpiry } from './oiFlow';

/** IV this far above or below the curve, as a decimal (0.01 = 1 vol point), marks a strike expensive or cheap. */
export const RICH_IV_GAP = 0.01;
/** Premiums below this are too coarse (tick-sized) to fit the curve. */
const MIN_FIT_PRICE = 0.5;
const MIN_FIT_POINTS = 5;
export const REALIZED_WINDOW = 20;
const MIN_RETURNS = 5;
const TRADING_DAYS = 252;
/** ATM IV ÷ realised vol above / below these reads as options expensive / cheap overall. */
export const IV_RV_RICH = 1.25;
export const IV_RV_CHEAP = 0.9;

export type Richness = 'Expensive' | 'Fair' | 'Cheap';
export type VolVerdict = 'Options expensive' | 'Fairly priced' | 'Options cheap';

export interface FairInput {
  token: number;
  optionType: 'CE' | 'PE';
  strike: number;
  /** YYYY-MM-DD */
  expiry: string;
  price: number;
  spot: number;
  asOf: Date;
  volume?: number;
}

export interface FairReading {
  price: number;
  iv: number | null;
  /** IV of the fitted curve at this strike. */
  curveIv: number | null;
  /** Black-76 price at the curve IV, on the expiry's forward. */
  fairPrice: number | null;
  /** (price − fair) ÷ fair. */
  richPct: number | null;
  /** iv − curveIv. */
  ivGap: number | null;
  label: Richness | null;
  /** Market-implied chance of finishing in the money. */
  itmProb: number | null;
  /** CE IV − PE IV at the same strike and expiry; near zero when put-call parity holds. */
  pairIvGap: number | null;
  /** Distance from spot in ATM-straddle widths. */
  moveMultiple: number | null;
}

export interface ExpiryStats {
  expiry: string;
  atmStrike: number;
  atmIv: number | null;
  /** ATM CE + PE premium: the move the market prices in by expiry. */
  straddle: number | null;
  /** Forward price the expiry is priced on. */
  forward: number;
  /** 'parity' when implied from CE/PE prices, 'carry' when it fell back to spot × e^(rT). */
  forwardSource: 'parity' | 'carry';
}

export interface FairValueResult {
  byToken: Map<number, FairReading>;
  byExpiry: Map<string, ExpiryStats>;
}

/** Least-squares quadratic iv = a + b·k + c·k². Returns null when the system is singular. */
function fitQuadratic(points: { k: number; iv: number }[]): [number, number, number] | null {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (const { k, iv } of points) {
    const k2 = k * k;
    s0 += 1; s1 += k; s2 += k2; s3 += k2 * k; s4 += k2 * k2;
    t0 += iv; t1 += iv * k; t2 += iv * k2;
  }
  // Cramer's rule on the 3×3 normal equations.
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const a = [[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]];
  const t = [t0, t1, t2];
  const d = det(a);
  if (Math.abs(d) < 1e-18) return null;
  const solve = (col: number) => det(a.map((row, i) => row.map((v, j) => (j === col ? t[i] : v)))) / d;
  return [solve(0), solve(1), solve(2)];
}

/**
 * Fit a volatility curve over log-moneyness, dropping outliers once.
 * The result only answers inside the fitted range: extrapolated wings are not trusted.
 */
export function fitSmile(points: { k: number; iv: number }[]): ((k: number) => number | null) | null {
  if (points.length < MIN_FIT_POINTS) return null;
  let coef = fitQuadratic(points);
  if (!coef) return null;

  const residuals = points.map(({ k, iv }) => iv - (coef![0] + coef![1] * k + coef![2] * k * k));
  const sorted = residuals.map(Math.abs).sort((x, y) => x - y);
  const mad = sorted[Math.floor(sorted.length / 2)];
  const limit = Math.max(3 * 1.4826 * mad, 0.005);
  const kept = points.filter((_, i) => Math.abs(residuals[i]) <= limit);
  if (kept.length >= MIN_FIT_POINTS && kept.length < points.length) coef = fitQuadratic(kept) ?? coef;

  const [a, b, c] = coef;
  const used = kept.length >= MIN_FIT_POINTS ? kept : points;
  const minK = Math.min(...used.map((p) => p.k));
  const maxK = Math.max(...used.map((p) => p.k));
  return (k: number) => {
    if (k < minK - 1e-9 || k > maxK + 1e-9) return null;
    const iv = a + b * k + c * k * k;
    return iv > 0 ? iv : null;
  };
}

const liquid = (option: FairInput | undefined): option is FairInput =>
  option !== undefined && option.price >= MIN_FIT_PRICE && option.volume !== 0;

/** Fair value, richness and context for every option in one day's chain. */
export function computeFairValues(inputs: FairInput[]): FairValueResult {
  const byExpiryInputs = new Map<string, FairInput[]>();
  for (const input of inputs) {
    const list = byExpiryInputs.get(input.expiry);
    if (list) list.push(input);
    else byExpiryInputs.set(input.expiry, [input]);
  }

  const byToken = new Map<number, FairReading>();
  const byExpiry = new Map<string, ExpiryStats>();

  for (const [expiry, list] of byExpiryInputs) {
    const spot = list[0].spot;
    const t = yearsToExpiry(list[0].asOf, expiry);

    // Options per strike, to pair CE with PE.
    const byStrike = new Map<number, { CE?: FairInput; PE?: FairInput }>();
    for (const input of list) {
      const entry = byStrike.get(input.strike) ?? {};
      entry[input.optionType] = input;
      byStrike.set(input.strike, entry);
    }

    // Black-76 on the forward = Black-Scholes on this dividend-adjusted spot.
    const { forward, source: forwardSource, pricingSpot } = impliedForward(list, spot, t);

    const ivs = new Map<number, number | null>();
    for (const input of list) ivs.set(input.token, impliedVol(input.optionType, input.price, pricingSpot, input.strike, t));

    // Curve points: the out-of-the-money side of each strike.
    const points: { k: number; iv: number }[] = [];
    for (const [strike, pair] of byStrike) {
      const otm = strike >= forward ? pair.CE : pair.PE;
      if (!liquid(otm)) continue;
      const iv = ivs.get(otm.token);
      if (iv != null) points.push({ k: Math.log(strike / forward), iv });
    }
    const smile = fitSmile(points);

    // ATM: strike nearest spot.
    let atmStrike = list[0].strike;
    for (const strike of byStrike.keys()) {
      if (Math.abs(strike - spot) < Math.abs(atmStrike - spot)) atmStrike = strike;
    }
    const atm = byStrike.get(atmStrike)!;
    const atmIvs = [atm.CE, atm.PE].map((o) => (o ? ivs.get(o.token) : null)).filter((v): v is number => v != null);
    const straddle = atm.CE && atm.PE && atm.CE.price > 0 && atm.PE.price > 0 ? atm.CE.price + atm.PE.price : null;
    byExpiry.set(expiry, {
      expiry,
      atmStrike,
      atmIv: atmIvs.length ? atmIvs.reduce((a, b) => a + b, 0) / atmIvs.length : null,
      straddle,
      forward,
      forwardSource,
    });

    for (const input of list) {
      const iv = ivs.get(input.token) ?? null;
      const curveIv = smile && t > 0 ? smile(Math.log(input.strike / forward)) : null;
      const fairPrice = curveIv !== null ? bsPrice(input.optionType, pricingSpot, input.strike, t, curveIv) : null;
      const richPct = fairPrice !== null && fairPrice > 0 ? (input.price - fairPrice) / fairPrice : null;
      const ivGap = iv !== null && curveIv !== null ? iv - curveIv : null;
      const label: Richness | null = ivGap === null ? null : ivGap >= RICH_IV_GAP ? 'Expensive' : ivGap <= -RICH_IV_GAP ? 'Cheap' : 'Fair';

      let itmProb: number | null = null;
      if (iv !== null) {
        const d2 = d1(pricingSpot, input.strike, t, iv) - iv * Math.sqrt(t);
        itmProb = input.optionType === 'CE' ? normCdf(d2) : normCdf(-d2);
      }

      const pair = byStrike.get(input.strike)!;
      const ceIv = pair.CE ? ivs.get(pair.CE.token) : null;
      const peIv = pair.PE ? ivs.get(pair.PE.token) : null;

      byToken.set(input.token, {
        price: input.price,
        iv,
        curveIv,
        fairPrice,
        richPct,
        ivGap,
        label,
        itmProb,
        pairIvGap: ceIv != null && peIv != null ? ceIv - peIv : null,
        moveMultiple: straddle ? Math.abs(input.strike - spot) / straddle : null,
      });
    }
  }

  return { byToken, byExpiry };
}

/** Annualised volatility of daily log returns over the last `window` closes (oldest first). */
export function realizedVol(closes: number[], window = REALIZED_WINDOW): number | null {
  const recent = closes.filter((c) => c > 0).slice(-(window + 1));
  const returns: number[] = [];
  for (let i = 1; i < recent.length; i++) returns.push(Math.log(recent[i] / recent[i - 1]));
  if (returns.length < MIN_RETURNS) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * TRADING_DAYS);
}

export function volVerdict(atmIv: number | null, realized: number | null): VolVerdict | null {
  if (atmIv === null || realized === null || realized <= 0) return null;
  const ratio = atmIv / realized;
  if (ratio >= IV_RV_RICH) return 'Options expensive';
  if (ratio <= IV_RV_CHEAP) return 'Options cheap';
  return 'Fairly priced';
}

/** Colour of the fair-value line; a light grey kept clear of the expiry palette and the rich / cheap colours. */
export const FAIR_LINE_COLOR = '#cbd5e1';

export function richnessColor(label: Richness | null): string {
  if (label === 'Expensive') return '#f59e0b';
  if (label === 'Cheap') return '#38bdf8';
  return 'var(--text-secondary)';
}

function rupees(value: number): string {
  return `₹${value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : value.toFixed(0)}`;
}

/** Short lines explaining a fair-value reading, for tooltips. */
export function describeFair(reading: FairReading): string[] {
  const lines: string[] = [];
  if (reading.fairPrice !== null && reading.curveIv !== null && reading.richPct !== null) {
    const pct = reading.richPct * 100;
    lines.push(`Fair ${rupees(reading.fairPrice)} at curve IV ${(reading.curveIv * 100).toFixed(1)}% · market ${rupees(reading.price)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%, ${reading.label})`);
  } else {
    lines.push('Fair value unavailable (outside the fitted curve or no IV)');
  }
  if (reading.pairIvGap !== null) {
    const gap = reading.pairIvGap * 100;
    lines.push(`CE IV − PE IV at this strike: ${gap >= 0 ? '+' : ''}${gap.toFixed(1)} pts`);
  }
  const context: string[] = [];
  if (reading.itmProb !== null) context.push(`ITM chance ${(reading.itmProb * 100).toFixed(0)}%`);
  if (reading.moveMultiple !== null) context.push(`${reading.moveMultiple.toFixed(1)}× expected move from spot`);
  if (context.length) lines.push(context.join(' · '));
  return lines;
}
