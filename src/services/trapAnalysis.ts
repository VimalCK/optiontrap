/**
 * Trap Analysis Engine
 * Combines OI data, price action, max pain, and PCR to detect
 * whether a position is likely to get trapped.
 */

import { OptionChainRow } from './optionChain';

import { calculateMaxPain, calculatePCR, classifyOiSignal, findOiWalls } from '../../shared/optionAnalysis/oiLevels.js';
import type { OiSignalResult, OiWall } from '../../shared/optionAnalysis/oiLevels.js';

/** The OI levels (signal, max pain, PCR, walls) live in shared/, used by the trade engine too. */
export * from '../../shared/optionAnalysis/oiLevels.js';

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
 * Pre-computed shared context for a full option chain analysis pass.
 * Compute once via buildTrapContext() then pass to every analyzeTrap() call
 * to avoid O(n³) recomputation when analyzing all strikes in the map view.
 */
export interface TrapContext {
  maxPain: number;
  pcr: number;
  nearestResistance: OiWall | null;
  nearestSupport: OiWall | null;
}

/**
 * Build the shared context that is identical for every strike in a chain.
 * Call once per tick/render cycle, then pass the result to analyzeTrap().
 */
export function buildTrapContext(
  chain: OptionChainRow[],
  oiData: Map<number, number>,
  spotPrice: number,
): TrapContext {
  const maxPain = calculateMaxPain(chain, oiData);
  const pcr = calculatePCR(chain, oiData);

  const walls = findOiWalls(chain, oiData);
  const resistanceWalls = walls.filter((w) => w.type === 'resistance' && w.strike > spotPrice);
  const supportWalls = walls.filter((w) => w.type === 'support' && w.strike < spotPrice);
  const nearestResistance = resistanceWalls.sort((a, b) => a.strike - b.strike)[0] ?? null;
  const nearestSupport = supportWalls.sort((a, b) => b.strike - a.strike)[0] ?? null;

  return { maxPain, pcr, nearestResistance, nearestSupport };
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
 * @param daysToExpiry Days remaining until expiry (optional)
 * @param ctx Pre-computed shared context from buildTrapContext() — pass this
 *            when analyzing all strikes in a loop to avoid O(n³) recomputation.
 *            If omitted, shared context is computed internally (fine for single-strike use).
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
  daysToExpiry?: number,
  ctx?: TrapContext,
): TrapAnalysis {
  const reasons: string[] = [];

  // 1. Max Pain and PCR — use pre-computed context if provided, otherwise compute now
  const { maxPain, pcr, nearestResistance, nearestSupport } =
    ctx ?? buildTrapContext(chain, oiData, spotPrice);

  const distanceToMaxPain = Math.abs(strike - maxPain);

  // 2. Get OI signal for the specific strike
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

  // 3. Score the position
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

  // 6. Apply Expiry Time Pressure
  // Closer to expiry = trap signals are more dangerous (max pain gravity is stronger,
  // theta decay is faster, OI walls are harder to break with less time)
  if (daysToExpiry !== undefined && daysToExpiry >= 0 && trapScore > 0) {
    let timePressureBonus = 0;
    if (daysToExpiry <= 1) {
      // Expiry day or next day — maximum pressure
      timePressureBonus = 2;
      reasons.push(`Expiry in ${daysToExpiry}d — max pain gravity and theta decay at peak`);
    } else if (daysToExpiry <= 3) {
      // Within 3 days — high pressure
      timePressureBonus = 1;
      reasons.push(`Expiry in ${daysToExpiry}d — time pressure increasing significantly`);
    }
    // No bonus for 4+ days — time is still on your side
    trapScore += timePressureBonus;
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
