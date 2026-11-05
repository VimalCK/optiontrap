/**
 * OI levels of an option chain: the OI + price signal at a strike, max pain,
 * PCR and OI walls. Shared by the Option Analyzer (browser: trap analysis,
 * edge scores, the Strategy card) and the Option Analyzer setups strategy
 * (server), so both read a chain the same way.
 */

/** @typedef {import('./chain.js').ChainRow} ChainRow */

/**
 * OI + Price signal classification
 * Determines market sentiment at a strike based on OI and price changes.
 * @typedef {'long-buildup' | 'short-buildup' | 'long-unwinding' | 'short-covering' | 'neutral'} OiSignal
 */

/**
 * @typedef {object} OiSignalResult
 * @property {OiSignal} signal
 * @property {string} label
 * @property {string} description
 * @property {'bullish' | 'bearish' | 'neutral'} sentiment
 */

/**
 * Classify OI + Price action signal
 * - OI ↑ + Price ↑ = Long Buildup (bullish)
 * - OI ↑ + Price ↓ = Short Buildup (bearish)
 * - OI ↓ + Price ↓ = Long Unwinding (bearish)
 * - OI ↓ + Price ↑ = Short Covering (bullish)
 * @param {number} oiChange
 * @param {number} priceChange
 * @returns {OiSignalResult}
 */
export function classifyOiSignal(oiChange, priceChange) {
  if (oiChange === 0 && priceChange === 0) {
    return { signal: 'neutral', label: 'Neutral', description: 'No significant change', sentiment: 'neutral' };
  }

  if (oiChange > 0 && priceChange > 0) {
    return { signal: 'long-buildup', label: 'Long Buildup', description: 'New longs entering — bulls are aggressive', sentiment: 'bullish' };
  }
  if (oiChange > 0 && priceChange <= 0) {
    return { signal: 'short-buildup', label: 'Short Buildup', description: 'New shorts entering — bears are aggressive', sentiment: 'bearish' };
  }
  if (oiChange < 0 && priceChange < 0) {
    return { signal: 'long-unwinding', label: 'Long Unwinding', description: 'Longs exiting — bulls giving up', sentiment: 'bearish' };
  }
  if (oiChange < 0 && priceChange >= 0) {
    return { signal: 'short-covering', label: 'Short Covering', description: 'Shorts exiting — bears giving up', sentiment: 'bullish' };
  }

  return { signal: 'neutral', label: 'Neutral', description: 'Mixed signals', sentiment: 'neutral' };
}

/**
 * Calculate Max Pain — the strike price at which the maximum number of
 * options (both CE and PE) expire worthless, causing maximum loss to buyers.
 * Price tends to gravitate toward max pain near expiry.
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @returns {number}
 */
export function calculateMaxPain(
  chain,
  oiData,
) {
  if (chain.length === 0) return 0;

  let minPain = Infinity;
  let maxPainStrike = 0;

  for (const targetRow of chain) {
    const target = targetRow.strike;
    let totalPain = 0;

    for (const row of chain) {
      // CE pain: if spot (target) < strike, CE expires worthless (no pain to CE buyers)
      // if spot (target) > strike, CE is ITM, loss to CE sellers = (target - strike) * OI
      if (row.ce) {
        const ceOi = oiData.get(row.ce.instrumentToken) || 0;
        if (target > row.strike) {
          totalPain += (target - row.strike) * ceOi;
        }
      }

      // PE pain: if spot (target) > strike, PE expires worthless (no pain to PE buyers)
      // if spot (target) < strike, PE is ITM, loss to PE sellers = (strike - target) * OI
      if (row.pe) {
        const peOi = oiData.get(row.pe.instrumentToken) || 0;
        if (target < row.strike) {
          totalPain += (row.strike - target) * peOi;
        }
      }
    }

    if (totalPain < minPain) {
      minPain = totalPain;
      maxPainStrike = target;
    }
  }

  return maxPainStrike;
}

/**
 * Calculate Put-Call Ratio for the visible chain
 * PCR = Total PE OI / Total CE OI
 * PCR > 1 = more puts (bullish signal — put sellers are confident)
 * PCR < 1 = more calls (bearish signal — call sellers are confident)
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @returns {number}
 */
export function calculatePCR(
  chain,
  oiData,
) {
  let totalCeOi = 0;
  let totalPeOi = 0;

  for (const row of chain) {
    if (row.ce) totalCeOi += oiData.get(row.ce.instrumentToken) || 0;
    if (row.pe) totalPeOi += oiData.get(row.pe.instrumentToken) || 0;
  }

  if (totalCeOi === 0) return 0;
  return totalPeOi / totalCeOi;
}

/**
 * Find major OI walls (support/resistance levels)
 * Returns strikes with OI significantly above average
 * @typedef {object} OiWall
 * @property {number} strike
 * @property {'resistance' | 'support'} type
 * @property {number} oi
 * @property {number} strength ratio above average (e.g., 2.5 = 2.5x average)
 */

/**
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {number} [threshold=1.5]
 * @returns {OiWall[]}
 */
export function findOiWalls(
  chain,
  oiData,
  threshold = 1.5, // minimum ratio above average to qualify as a wall
) {
  /** @type {OiWall[]} */ const walls = [];

  // Calculate average OI for CE and PE separately
  let totalCeOi = 0;
  let totalPeOi = 0;
  let ceCount = 0;
  let peCount = 0;

  for (const row of chain) {
    if (row.ce) {
      const oi = oiData.get(row.ce.instrumentToken) || 0;
      if (oi > 0) { totalCeOi += oi; ceCount++; }
    }
    if (row.pe) {
      const oi = oiData.get(row.pe.instrumentToken) || 0;
      if (oi > 0) { totalPeOi += oi; peCount++; }
    }
  }

  const avgCeOi = ceCount > 0 ? totalCeOi / ceCount : 0;
  const avgPeOi = peCount > 0 ? totalPeOi / peCount : 0;

  for (const row of chain) {
    // CE OI wall = Resistance (sellers defend this level from going up)
    if (row.ce && avgCeOi > 0) {
      const ceOi = oiData.get(row.ce.instrumentToken) || 0;
      const strength = ceOi / avgCeOi;
      if (strength >= threshold) {
        walls.push({ strike: row.strike, type: 'resistance', oi: ceOi, strength });
      }
    }

    // PE OI wall = Support (sellers defend this level from going down)
    if (row.pe && avgPeOi > 0) {
      const peOi = oiData.get(row.pe.instrumentToken) || 0;
      const strength = peOi / avgPeOi;
      if (strength >= threshold) {
        walls.push({ strike: row.strike, type: 'support', oi: peOi, strength });
      }
    }
  }

  // Sort by strength descending
  return walls.sort((a, b) => b.strength - a.strength);
}

