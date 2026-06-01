/**
 * Trap Analysis Engine
 * Combines OI data, price action, max pain, and PCR to detect
 * whether a position is likely to get trapped.
 */

import { OptionChainRow } from './optionChain';

/**
 * OI + Price signal classification
 * Determines market sentiment at a strike based on OI and price changes.
 */
export type OiSignal = 'long-buildup' | 'short-buildup' | 'long-unwinding' | 'short-covering' | 'neutral';

export interface OiSignalResult {
  signal: OiSignal;
  label: string;
  description: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
}

/**
 * Classify OI + Price action signal
 * - OI ↑ + Price ↑ = Long Buildup (bullish)
 * - OI ↑ + Price ↓ = Short Buildup (bearish)
 * - OI ↓ + Price ↓ = Long Unwinding (bearish)
 * - OI ↓ + Price ↑ = Short Covering (bullish)
 */
export function classifyOiSignal(oiChange: number, priceChange: number): OiSignalResult {
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
 */
export function calculateMaxPain(
  chain: OptionChainRow[],
  oiData: Map<number, number>,
): number {
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
 */
export function calculatePCR(
  chain: OptionChainRow[],
  oiData: Map<number, number>,
): number {
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
 */
export interface OiWall {
  strike: number;
  type: 'resistance' | 'support';
  oi: number;
  strength: number; // ratio above average (e.g., 2.5 = 2.5x average)
}

export function findOiWalls(
  chain: OptionChainRow[],
  oiData: Map<number, number>,
  threshold: number = 1.5, // minimum ratio above average to qualify as a wall
): OiWall[] {
  const walls: OiWall[] = [];

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

/**
 * Trap Verdict — the main analysis
 */
export type TrapVerdict = 'safe' | 'caution' | 'likely-trapped';

export interface TrapAnalysis {
  verdict: TrapVerdict;
  verdictLabel: string;
  trapScore: number;
  reasons: string[];
  maxPain: number;
  pcr: number;
  oiSignal: OiSignalResult;
  nearestResistance: OiWall | null;
  nearestSupport: OiWall | null;
  distanceToMaxPain: number; // in points from target strike
}

/**
 * Analyze whether a position at a given strike is likely to get trapped.
 * 
 * @param positionType 'buy-ce' | 'buy-pe' | 'sell-ce' | 'sell-pe'
 * @param strike The strike you're entering
 * @param spotPrice Current NIFTY spot
 * @param chain Full option chain
 * @param oiData Current OI map
 * @param prevDayOi Previous day OI map (for change calculation)
 * @param closePrices Previous close prices (for price change)
 * @param livePrices Current prices
 */
export function analyzeTrap(
  positionType: 'buy-ce' | 'buy-pe' | 'sell-ce' | 'sell-pe',
  strike: number,
  spotPrice: number,
  chain: OptionChainRow[],
  oiData: Map<number, number>,
  prevDayOi: Map<number, number>,
  closePrices: Map<number, number>,
  livePrices: Map<number, number>,
): TrapAnalysis {
  const reasons: string[] = [];

  // 1. Calculate Max Pain
  const maxPain = calculateMaxPain(chain, oiData);
  const distanceToMaxPain = Math.abs(strike - maxPain);

  // 2. Calculate PCR
  const pcr = calculatePCR(chain, oiData);

  // 3. Get OI signal for the specific strike
  const row = chain.find((r) => r.strike === strike);
  let oiSignal: OiSignalResult = { signal: 'neutral', label: 'Neutral', description: 'No data', sentiment: 'neutral' };

  if (row) {
    const instrument = positionType.includes('ce') ? row.ce : row.pe;
    if (instrument) {
      const currentOi = oiData.get(instrument.instrumentToken) || 0;
      const prevOi = prevDayOi.get(instrument.instrumentToken) || 0;
      const currentPrice = livePrices.get(instrument.instrumentToken) || 0;
      const prevClose = closePrices.get(instrument.instrumentToken) || 0;

      const oiChange = prevOi > 0 ? ((currentOi - prevOi) / prevOi) * 100 : 0;
      const priceChange = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;

      oiSignal = classifyOiSignal(oiChange, priceChange);
    }
  }

  // 4. Find OI walls
  const walls = findOiWalls(chain, oiData);
  const resistanceWalls = walls.filter((w) => w.type === 'resistance' && w.strike > spotPrice);
  const supportWalls = walls.filter((w) => w.type === 'support' && w.strike < spotPrice);
  const nearestResistance = resistanceWalls.length > 0 ? resistanceWalls[resistanceWalls.length - 1] : null;
  const nearestSupport = supportWalls.length > 0 ? supportWalls[0] : null;

  // 5. Score the position
  let trapScore = 0; // 0 = safe, higher = more trapped

  // Max Pain analysis
  if (positionType === 'buy-ce') {
    // Buying call — you need price to go UP
    if (strike > maxPain) {
      trapScore += 2;
      reasons.push(`Target strike ${strike} is above max pain ${maxPain} — price tends to fall toward max pain near expiry`);
    }
    // Check resistance wall above
    if (nearestResistance && nearestResistance.strike <= strike) {
      trapScore += 2;
      reasons.push(`Heavy CE OI wall at ${nearestResistance.strike} (${nearestResistance.strength.toFixed(1)}x avg) — sellers defending this level`);
    }
    // PCR check
    if (pcr < 0.7) {
      trapScore += 1;
      reasons.push(`Low PCR (${pcr.toFixed(2)}) — market skewed bearish, calls may struggle`);
    }
    // OI signal check
    if (oiSignal.sentiment === 'bearish') {
      trapScore += 2;
      reasons.push(`${oiSignal.label} at this strike — ${oiSignal.description}`);
    }
  } else if (positionType === 'buy-pe') {
    // Buying put — you need price to go DOWN
    if (strike < maxPain) {
      trapScore += 2;
      reasons.push(`Target strike ${strike} is below max pain ${maxPain} — price tends to rise toward max pain near expiry`);
    }
    // Check support wall below
    if (nearestSupport && nearestSupport.strike >= strike) {
      trapScore += 2;
      reasons.push(`Heavy PE OI wall at ${nearestSupport.strike} (${nearestSupport.strength.toFixed(1)}x avg) — sellers defending this level`);
    }
    // PCR check
    if (pcr > 1.5) {
      trapScore += 1;
      reasons.push(`High PCR (${pcr.toFixed(2)}) — market skewed bullish, puts may struggle`);
    }
    // OI signal check
    if (oiSignal.sentiment === 'bullish') {
      trapScore += 2;
      reasons.push(`${oiSignal.label} at this strike — ${oiSignal.description}`);
    }
  } else if (positionType === 'sell-ce') {
    // Selling call — you need price to stay below strike
    if (strike < maxPain) {
      trapScore += 2;
      reasons.push(`Sold CE at ${strike} which is below max pain ${maxPain} — price may rise toward max pain`);
    }
    if (oiSignal.signal === 'long-buildup') {
      trapScore += 2;
      reasons.push(`Long Buildup at this strike — aggressive buying may push price through`);
    }
  } else if (positionType === 'sell-pe') {
    // Selling put — you need price to stay above strike
    if (strike > maxPain) {
      trapScore += 2;
      reasons.push(`Sold PE at ${strike} which is above max pain ${maxPain} — price may fall toward max pain`);
    }
    if (oiSignal.signal === 'short-buildup') {
      trapScore += 2;
      reasons.push(`Short Buildup at this strike — aggressive selling may push price through`);
    }
  }

  // Add positive signals
  if (reasons.length === 0) {
    if (positionType === 'buy-ce' && oiSignal.sentiment === 'bullish') {
      reasons.push(`${oiSignal.label} — supportive for your long call position`);
    } else if (positionType === 'buy-pe' && oiSignal.sentiment === 'bearish') {
      reasons.push(`${oiSignal.label} — supportive for your long put position`);
    } else {
      reasons.push('No significant trap signals detected');
    }
  }

  // Determine verdict
  let verdict: TrapVerdict;
  let verdictLabel: string;
  if (trapScore >= 4) {
    verdict = 'likely-trapped';
    verdictLabel = 'Likely Trapped';
  } else if (trapScore >= 2) {
    verdict = 'caution';
    verdictLabel = 'Caution';
  } else {
    verdict = 'safe';
    verdictLabel = 'Looks Safe';
  }

  return {
    verdict,
    verdictLabel,
    trapScore,
    reasons,
    maxPain,
    pcr,
    oiSignal,
    nearestResistance,
    nearestSupport,
    distanceToMaxPain,
  };
}
