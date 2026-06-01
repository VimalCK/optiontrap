/**
 * Edge Score Engine
 * Calculates probability of profit and risk-reward score for option selling.
 * Recommends optimal strikes based on multiple factors.
 */

import { OptionChainRow } from './optionChain';
import { calculateMaxPain, findOiWalls } from './trapAnalysis';

export interface StrikeEdge {
  strike: number;
  type: 'ce' | 'pe';
  premium: number;
  distanceFromSpot: number;
  distancePct: number; // % distance from spot
  pop: number; // Probability of Profit (0-100)
  oiWallStrength: number; // OI wall multiplier (0 = no wall, 2+ = strong wall)
  maxPainAlignment: number; // 0-1, how well aligned with max pain
  edgeScore: number; // Combined score (higher = better)
  reasons: string[];
}

/**
 * Calculate expected move from ATM straddle premium.
 * Expected move ≈ ATM CE price + ATM PE price
 */
export function calculateExpectedMove(
  chain: OptionChainRow[],
  atmStrike: number,
  livePrices: Map<number, number>,
): number {
  const atmRow = chain.find((r) => r.strike === atmStrike);
  if (!atmRow) return 0;

  const cePrice = atmRow.ce ? livePrices.get(atmRow.ce.instrumentToken) || 0 : 0;
  const pePrice = atmRow.pe ? livePrices.get(atmRow.pe.instrumentToken) || 0 : 0;

  return cePrice + pePrice;
}

/**
 * Calculate Probability of Profit for selling an option.
 * Uses a simplified normal distribution approximation based on expected move.
 * 
 * POP for selling CE at strike X = P(spot stays below X at expiry)
 * POP for selling PE at strike X = P(spot stays above X at expiry)
 */
function calculatePOP(
  strike: number,
  spotPrice: number,
  expectedMove: number,
  type: 'ce' | 'pe',
): number {
  if (expectedMove <= 0) return 50;

  // Standard deviation ≈ expected move (1 SD covers ~68%)
  const sd = expectedMove;
  const distance = type === 'ce' ? strike - spotPrice : spotPrice - strike;

  // Number of standard deviations away
  const zScore = distance / sd;

  // Approximate cumulative normal distribution
  // P(spot stays below strike for CE) or P(spot stays above strike for PE)
  // Using a simple sigmoid approximation
  const pop = 100 / (1 + Math.exp(-1.7 * zScore));

  return Math.min(99, Math.max(1, pop));
}

/**
 * Calculate edge score for all strikes.
 * Returns ranked list of best strikes for selling.
 */
export function calculateEdgeScores(
  chain: OptionChainRow[],
  oiData: Map<number, number>,
  livePrices: Map<number, number>,
  spotPrice: number,
  atmStrike: number,
): StrikeEdge[] {
  if (chain.length === 0 || spotPrice === 0) return [];

  const expectedMove = calculateExpectedMove(chain, atmStrike, livePrices);
  const maxPain = calculateMaxPain(chain, oiData);
  const walls = findOiWalls(chain, oiData, 1.3);

  const results: StrikeEdge[] = [];

  for (const row of chain) {
    // Skip ATM and near-ATM strikes (too risky for selling)
    const distFromAtm = Math.abs(row.strike - atmStrike);
    if (distFromAtm < 50) continue;

    // CE selling (strikes above spot)
    if (row.ce && row.strike > spotPrice) {
      const premium = livePrices.get(row.ce.instrumentToken) || 0;
      if (premium <= 0) continue;

      const distance = row.strike - spotPrice;
      const distancePct = (distance / spotPrice) * 100;
      const pop = calculatePOP(row.strike, spotPrice, expectedMove, 'ce');

      // OI wall strength at this strike (CE OI = resistance)
      const ceOi = oiData.get(row.ce.instrumentToken) || 0;
      const wall = walls.find((w) => w.strike === row.strike && w.type === 'resistance');
      const oiWallStrength = wall ? wall.strength : 0;

      // Max pain alignment: selling CE above max pain is good (price gravitates down to max pain)
      const maxPainAlignment = row.strike > maxPain ? Math.min(1, (row.strike - maxPain) / 200) : 0;

      // Edge score formula
      const edgeScore = (
        pop * 0.4 +                          // 40% weight: probability of profit
        oiWallStrength * 10 +                // OI wall defense
        maxPainAlignment * 15 +              // Max pain alignment
        Math.min(distancePct * 5, 20) +      // Distance bonus (capped)
        (premium > 10 ? Math.min(premium / 5, 15) : 0) // Premium value
      );

      const reasons: string[] = [];
      if (pop >= 70) reasons.push(`${pop.toFixed(0)}% probability of profit`);
      if (oiWallStrength >= 1.5) reasons.push(`Strong OI wall (${oiWallStrength.toFixed(1)}x avg)`);
      if (maxPainAlignment > 0.5) reasons.push(`Well above max pain ${maxPain}`);
      if (distance > expectedMove) reasons.push(`Outside expected move (${expectedMove.toFixed(0)} pts)`);

      results.push({
        strike: row.strike,
        type: 'ce',
        premium,
        distanceFromSpot: distance,
        distancePct,
        pop,
        oiWallStrength,
        maxPainAlignment,
        edgeScore,
        reasons,
      });
    }

    // PE selling (strikes below spot)
    if (row.pe && row.strike < spotPrice) {
      const premium = livePrices.get(row.pe.instrumentToken) || 0;
      if (premium <= 0) continue;

      const distance = spotPrice - row.strike;
      const distancePct = (distance / spotPrice) * 100;
      const pop = calculatePOP(row.strike, spotPrice, expectedMove, 'pe');

      // OI wall strength at this strike (PE OI = support)
      const peOi = oiData.get(row.pe.instrumentToken) || 0;
      const wall = walls.find((w) => w.strike === row.strike && w.type === 'support');
      const oiWallStrength = wall ? wall.strength : 0;

      // Max pain alignment: selling PE below max pain is good (price gravitates up to max pain)
      const maxPainAlignment = row.strike < maxPain ? Math.min(1, (maxPain - row.strike) / 200) : 0;

      // Edge score formula
      const edgeScore = (
        pop * 0.4 +
        oiWallStrength * 10 +
        maxPainAlignment * 15 +
        Math.min(distancePct * 5, 20) +
        (premium > 10 ? Math.min(premium / 5, 15) : 0)
      );

      const reasons: string[] = [];
      if (pop >= 70) reasons.push(`${pop.toFixed(0)}% probability of profit`);
      if (oiWallStrength >= 1.5) reasons.push(`Strong OI wall (${oiWallStrength.toFixed(1)}x avg)`);
      if (maxPainAlignment > 0.5) reasons.push(`Well below max pain ${maxPain}`);
      if (distance > expectedMove) reasons.push(`Outside expected move (${expectedMove.toFixed(0)} pts)`);

      results.push({
        strike: row.strike,
        type: 'pe',
        premium,
        distanceFromSpot: distance,
        distancePct,
        pop,
        oiWallStrength,
        maxPainAlignment,
        edgeScore,
        reasons,
      });
    }
  }

  // Sort by edge score descending
  return results.sort((a, b) => b.edgeScore - a.edgeScore);
}
