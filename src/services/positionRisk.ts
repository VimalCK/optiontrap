/**
 * Position Risk Service
 * Computes combined multi-leg risk metrics for open journal positions:
 *   - Live P&L (from streamed LTPs)
 *   - Max loss / max profit (expiry payoff across an underlying price range)
 *   - Breakeven point(s) (zero-crossings of the net payoff curve)
 *   - Invalidation-hit flag (live LTP crossed a leg's journal stopLossPrice)
 *
 * Positions are grouped by underlying + expiry so a spread (e.g. an iron
 * condor) is evaluated as a single strategy rather than isolated legs.
 *
 * All quantities on a Position are absolute contract quantities (already
 * lot-adjusted), matching the convention used elsewhere (Positions.tsx getPnL).
 */

import { Position } from './positions';

export interface LegRisk {
  position: Position;
  /** Current traded price of this leg (LTP), if available */
  ltp: number | null;
  /** Live P&L for this leg in currency */
  pnl: number | null;
  /** True when a stopLossPrice is set and the live LTP has crossed it */
  invalidationHit: boolean;
}

export interface RiskGroup {
  /** Grouping key: `${underlying}|${expiry}` */
  key: string;
  underlying: string;
  expiry: string;
  legs: LegRisk[];
  /** Sum of live per-leg P&L (null when no live prices are available) */
  livePnL: number | null;
  /**
   * Worst-case P&L at expiry (currency), or null when the loss is unbounded
   * (e.g. a naked short call, whose loss grows without limit as price rises).
   */
  maxLoss: number | null;
  /**
   * Best-case P&L at expiry (currency), or null when the profit is unbounded
   * (e.g. a long call, whose profit grows without limit as price rises, or a
   * long put, whose profit grows as price falls toward zero).
   */
  maxProfit: number | null;
  /** Underlying prices where the expiry payoff crosses zero */
  breakevens: number[];
  /** Any leg in the group has hit its invalidation (stop-loss) level */
  invalidationHit: boolean;
}

/**
 * Extract the underlying name from an F&O tradingsymbol.
 *   NIFTY25O0724500CE → NIFTY
 * Mirrors the convention already used in tradingview.ts.
 */
export function underlyingFromSymbol(tradingsymbol: string): string {
  const upper = tradingsymbol.toUpperCase();
  const stripped = upper.replace(/\d.*$/, '');
  return stripped || upper;
}

/**
 * Payoff of a single option leg at a given underlying expiry price.
 * Returns P&L in currency for the whole quantity.
 *
 *   Long CE : (max(S - K, 0) - premium) * qty
 *   Long PE : (max(K - S, 0) - premium) * qty
 *   Short   : negated intrinsic, plus premium collected
 */
function legPayoffAtExpiry(pos: Position, underlyingPrice: number): number {
  const intrinsic =
    pos.optionType === 'CE'
      ? Math.max(underlyingPrice - pos.strike, 0)
      : Math.max(pos.strike - underlyingPrice, 0);

  const perUnit =
    pos.side === 'BUY'
      ? intrinsic - pos.entryPrice
      : pos.entryPrice - intrinsic;

  return perUnit * pos.quantity;
}

/**
 * Live P&L for a single leg given its current LTP.
 */
function legLivePnL(pos: Position, ltp: number): number {
  return pos.side === 'BUY'
    ? (ltp - pos.entryPrice) * pos.quantity
    : (pos.entryPrice - ltp) * pos.quantity;
}

/**
 * Whether a leg's stop-loss has been breached by the live LTP.
 * Long legs are invalidated when price falls to/below the stop.
 * Short legs are invalidated when price rises to/above the stop.
 */
function isInvalidationHit(pos: Position, ltp: number | null): boolean {
  if (ltp == null || pos.stopLossPrice == null || pos.exited) return false;
  return pos.side === 'BUY' ? ltp <= pos.stopLossPrice : ltp >= pos.stopLossPrice;
}

/**
 * Compute risk groups from open positions and a map of live prices.
 *
 * Max profit / max loss are derived analytically from the piecewise-linear
 * expiry payoff (kinks at strikes) and its tail slopes, so an unbounded side
 * is reported as null rather than an arbitrary scan-range artifact.
 *
 * @param positions      Open (non-exited) positions from the journal.
 * @param livePrices     Map of instrumentToken → current LTP.
 */
export function computeRiskGroups(
  positions: Position[],
  livePrices: Map<number, number>,
): RiskGroup[] {
  const open = positions.filter((p) => !p.exited);

  // Group by underlying + expiry
  const groups = new Map<string, Position[]>();
  for (const pos of open) {
    const underlying = underlyingFromSymbol(pos.tradingsymbol);
    const key = `${underlying}|${pos.expiry}`;
    const list = groups.get(key);
    if (list) list.push(pos);
    else groups.set(key, [pos]);
  }

  const result: RiskGroup[] = [];

  for (const [key, legsPos] of groups) {
    const [underlying, expiry] = key.split('|');

    // Build per-leg risk
    const legs: LegRisk[] = legsPos.map((pos) => {
      const ltp = livePrices.get(pos.instrumentToken) ?? null;
      const pnl = ltp != null ? legLivePnL(pos, ltp) : null;
      return { position: pos, ltp, pnl, invalidationHit: isInvalidationHit(pos, ltp) };
    });

    const anyLive = legs.some((l) => l.pnl != null);
    const livePnL = anyLive
      ? legs.reduce((s, l) => s + (l.pnl ?? 0), 0)
      : null;

    // The expiry payoff is piecewise-linear with kinks only at the strikes,
    // so its finite extrema can only occur at a strike, at price 0, or in the
    // limit as price → ∞. We evaluate payoff at those candidate points and use
    // the tail slopes to decide which side (if any) is unbounded.
    const strikes = [...new Set(legsPos.map((p) => p.strike))].sort((a, b) => a - b);

    // Tail slopes (P&L change per +1 in underlying price):
    //   High tail (price → ∞): only calls are ITM → net call quantity.
    //   Low tail  (price → 0):  only puts are ITM, and their intrinsic
    //     increases as price falls, so slope w.r.t. a *falling* price is the
    //     net put quantity.
    const netCallQty = signedQty(legsPos, 'CE');
    const netPutQty = signedQty(legsPos, 'PE');

    // Profit unbounded upward if net long calls; loss unbounded upward if net short calls.
    const profitUnboundedUp = netCallQty > 0;
    const lossUnboundedUp = netCallQty < 0;
    // Profit unbounded downward if net long puts; loss unbounded downward if net short puts.
    const profitUnboundedDown = netPutQty > 0;
    const lossUnboundedDown = netPutQty < 0;

    // Evaluate payoff at the kink points (strikes) and at price 0.
    const candidatePrices = [0, ...strikes];
    let finiteMax = -Infinity;
    let finiteMin = Infinity;
    for (const price of candidatePrices) {
      const payoff = groupPayoff(legsPos, price);
      if (payoff > finiteMax) finiteMax = payoff;
      if (payoff < finiteMin) finiteMin = payoff;
    }

    const maxProfit = profitUnboundedUp || profitUnboundedDown
      ? null
      : Number(finiteMax.toFixed(2));
    const maxLoss = lossUnboundedUp || lossUnboundedDown
      ? null
      : Number(finiteMin.toFixed(2));

    // Breakevens: scan between 0 and just past the highest strike for zero
    // crossings of the piecewise-linear payoff.
    const breakevens = findBreakevens(legsPos, strikes);

    result.push({
      key,
      underlying,
      expiry,
      legs,
      livePnL,
      maxLoss,
      maxProfit,
      breakevens,
      invalidationHit: legs.some((l) => l.invalidationHit),
    });
  }

  // Sort by nearest expiry first
  return result.sort((a, b) => a.expiry.localeCompare(b.expiry));
}

/** Combined payoff of all legs in a group at an underlying expiry price. */
function groupPayoff(legs: Position[], underlyingPrice: number): number {
  let total = 0;
  for (const leg of legs) total += legPayoffAtExpiry(leg, underlyingPrice);
  return total;
}

export interface PayoffPoint {
  /** Underlying price */
  price: number;
  /** Net P&L at expiry for that price */
  payoff: number;
}

export interface PayoffCurve {
  points: PayoffPoint[];
  minPrice: number;
  maxPrice: number;
  minPayoff: number;
  maxPayoff: number;
}

/**
 * Sample the expiry payoff curve for a risk group across a sensible price
 * range for charting. The range is centred on `spot` (or the strike midpoint)
 * and widened to comfortably include all strikes and both breakevens.
 *
 * @param group  Risk group to chart.
 * @param spot   Current underlying price (optional; used to centre the range).
 * @param steps  Number of sample points (default 120).
 */
export function samplePayoffCurve(
  group: RiskGroup,
  spot?: number,
  steps = 120,
): PayoffCurve {
  const legs = group.legs.map((l) => l.position);
  const strikes = legs.map((p) => p.strike);
  const minStrike = Math.min(...strikes);
  const maxStrike = Math.max(...strikes);

  const anchors = [minStrike, maxStrike, ...group.breakevens];
  if (spot && spot > 0) anchors.push(spot);
  const lowAnchor = Math.min(...anchors);
  const highAnchor = Math.max(...anchors);

  const centre = spot && spot > 0 ? spot : (minStrike + maxStrike) / 2;
  const pad = Math.max((highAnchor - lowAnchor) * 0.25, centre * 0.1, 1);
  const lo = Math.max(0, lowAnchor - pad);
  const hi = highAnchor + pad;

  const points: PayoffPoint[] = [];
  let minPayoff = Infinity;
  let maxPayoff = -Infinity;

  // Sample uniformly, but also force-include the strikes and breakevens so the
  // kinks render sharply rather than being smoothed over.
  const forced = [...new Set([...strikes, ...group.breakevens].filter((p) => p >= lo && p <= hi))];
  const uniform = Array.from({ length: steps + 1 }, (_, i) => lo + (i * (hi - lo)) / steps);
  const prices = [...uniform, ...forced].sort((a, b) => a - b);

  for (const price of prices) {
    const payoff = groupPayoff(legs, price);
    points.push({ price, payoff });
    if (payoff < minPayoff) minPayoff = payoff;
    if (payoff > maxPayoff) maxPayoff = payoff;
  }

  return { points, minPrice: lo, maxPrice: hi, minPayoff, maxPayoff };
}

/**
 * Net signed contract quantity for one option type (BUY positive, SELL negative).
 */
function signedQty(legs: Position[], type: 'CE' | 'PE'): number {
  return legs
    .filter((l) => l.optionType === type)
    .reduce((s, l) => s + (l.side === 'SELL' ? -l.quantity : l.quantity), 0);
}

/**
 * Find breakeven underlying prices — zero-crossings of the piecewise-linear
 * expiry payoff. The payoff is linear between consecutive strikes, so we
 * evaluate at 0, each strike, and a point beyond the top strike, then
 * interpolate any sign change.
 */
function findBreakevens(legs: Position[], strikes: number[]): number[] {
  const topStrike = strikes.length ? strikes[strikes.length - 1] : 0;
  // A point beyond the highest strike so an upward-sloping tail can cross zero.
  const beyond = topStrike + Math.max(topStrike * 0.5, 1);
  const points = [0, ...strikes, beyond];

  const breakevens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const y0 = groupPayoff(legs, p0);
    const y1 = groupPayoff(legs, p1);
    if ((y0 < 0 && y1 >= 0) || (y0 > 0 && y1 <= 0)) {
      const t = y0 / (y0 - y1);
      breakevens.push(Number((p0 + t * (p1 - p0)).toFixed(2)));
    }
  }
  return breakevens;
}
