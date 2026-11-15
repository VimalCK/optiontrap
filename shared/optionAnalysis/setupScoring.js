/**
 * Measures both the sell and the buy setups score with (sellSetups.js, buySetups.js).
 */

/**
 * @typedef {import('./chain.js').ChainRow} ChainRow
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
