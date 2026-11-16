/**
 * Measures both the sell and the buy setups score with (sellSetups.js, buySetups.js).
 */

/**
 * @typedef {import('./chain.js').ChainRow} ChainRow
 * @typedef {import('./velocityPattern.js').OiSnapshot} OiSnapshot
 */

/**
 * Compute a volume multiplier for a token.
 * High volume (>1.5x avg) = 1.3 (boost)
 * Normal volume (0.8-1.5x avg) = 1.0 (neutral)
 * Low volume (<0.5x avg) = 0.6 (penalize)
 * Below average (0.5-0.8x) = 0.8
 * No data = 1.0
 * @param {number | undefined} token
 * @param {Map<number, number>} volumeData
 * @param {number} avgVolume
 * @returns {number}
 */
export function volumeMultiplier(
  token,
  volumeData,
  avgVolume,
) {
  if (!token || avgVolume <= 0 || volumeData.size === 0) return 1.0;
  const vol = volumeData.get(token) || 0;
  if (vol <= 0) return 1.0;
  const ratio = vol / avgVolume;
  if (ratio > 1.5) return 1.3;
  if (ratio > 0.8) return 1.0;
  if (ratio > 0.5) return 0.8;
  return 0.6;
}

/**
 * The gap between neighbouring strikes in the chain: 50 for NIFTY, 100 for
 * BANKNIFTY, 20 for a ₹1,400 stock. "Near" in the checks below means within
 * one gap, so they read every symbol the same way. 0 with fewer than two strikes.
 * @param {ChainRow[]} chain
 * @returns {number}
 */
export function strikeGap(chain) {
  const strikes = [...new Set(chain.map((r) => r.strike))].sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < strikes.length; i++) {
    const d = strikes[i] - strikes[i - 1];
    if (gap === 0 || d < gap) gap = d;
  }
  return gap;
}

/**
 * The standard normal cumulative distribution: the chance a normally
 * distributed move ends below `z` standard deviations. Abramowitz & Stegun
 * 7.1.26 (error under 1.5e-7).
 * @param {number} z
 * @returns {number}
 */
export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** The ATM straddle is worth about 0.8 standard deviations of the move to expiry (√(2/π)). */
const STRADDLE_TO_SD = 0.8;
/** How far back "recent" spot moves look: 3 snapshots, 30 minutes. */
const RECENT_SNAPSHOTS = 3;
/** A recent move against a side larger than this share of the expected move is a trend against it: no setups on that side. */
export const TREND_AGAINST_SHARE = 0.25;

/**
 * The expected move to expiry: the ATM straddle's premium. 0 without one.
 * @param {ChainRow[]} chain
 * @param {number | undefined} atmStrike
 * @param {Map<number, number>} livePrices
 * @returns {number}
 */
export function atmStraddle(chain, atmStrike, livePrices) {
  const atmRow = atmStrike ? chain.find((r) => r.strike === atmStrike) : undefined;
  if (!atmRow) return 0;
  const cePrice = atmRow.ce ? livePrices.get(atmRow.ce.instrumentToken) || 0 : 0;
  const pePrice = atmRow.pe ? livePrices.get(atmRow.pe.instrumentToken) || 0 : 0;
  return cePrice + pePrice;
}

/**
 * Probability (1–99) that spot ends between two prices at expiry, the move
 * normally distributed with its standard deviation taken from the ATM
 * straddle; 50 when there is no expected move to measure with.
 * @param {number} lower
 * @param {number} upper
 * @param {number} spotPrice
 * @param {number} expectedMove ATM straddle premium
 * @returns {number}
 */
export function rangePop(lower, upper, spotPrice, expectedMove) {
  if (expectedMove <= 0) return 50;
  const sd = expectedMove / STRADDLE_TO_SD;
  const pop = 100 * (normalCdf((upper - spotPrice) / sd) - normalCdf((lower - spotPrice) / sd));
  return Math.min(99, Math.max(1, pop));
}

/**
 * How far spot moved over the last 30 minutes of snapshots, up to now; 0
 * without an earlier spot. Snapshots are oldest first.
 * @param {OiSnapshot[]} snapshots
 * @param {number} spotPrice
 * @returns {number}
 */
export function recentSpotMove(snapshots, spotPrice) {
  const spots = [...snapshots.map((snap) => snap.spot ?? 0).filter((spot) => spot > 0), spotPrice];
  if (spots.length < 2) return 0;
  return spotPrice - spots[Math.max(0, spots.length - 1 - RECENT_SNAPSHOTS)];
}

/**
 * An option's OI and price change (%) since a snapshot; null without its OI then.
 * @param {number} token
 * @param {OiSnapshot} since
 * @param {Map<number, number>} oiData
 * @param {Map<number, number>} livePrices
 * @returns {{ oiPct: number, pricePct: number } | null}
 */
export function optionChange(token, since, oiData, livePrices) {
  const thenOi = Number(since.data[String(token)] || 0);
  if (thenOi <= 0) return null;
  const nowOi = oiData.get(token) || 0;
  const thenPrice = since.prices ? Number(since.prices[String(token)] || 0) : 0;
  const nowPrice = livePrices.get(token) || 0;
  return {
    oiPct: ((nowOi - thenOi) / thenOi) * 100,
    pricePct: thenPrice > 0 && nowPrice > 0 ? ((nowPrice - thenPrice) / thenPrice) * 100 : 0,
  };
}
