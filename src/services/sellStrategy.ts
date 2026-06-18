/**
 * Sell Strategy Engine
 * Composite scoring engine that evaluates multiple intraday patterns
 * and recommends optimal option selling opportunities.
 *
 * Uses OI snapshots (10-min intervals), live OI/price data, max pain,
 * PCR, OI walls, and velocity patterns to produce scored recommendations.
 */

import { OptionChainRow } from './optionChain';
import { OiSnapshot, analyzeVelocityPattern } from './oiSnapshots';
import { calculateMaxPain, calculatePCR, findOiWalls, classifyOiSignal } from './trapAnalysis';

// ── Types ──

export type SellType = 'sell-ce' | 'sell-pe' | 'sell-straddle' | 'sell-strangle';

export interface ScoreBreakdown {
  pinning: number;     // 0–25
  oiWall: number;      // 0–25
  velocity: number;    // 0–20
  pcrExtreme: number;  // 0–15
  timeDecay: number;   // 0–15
}

export interface SellRecommendation {
  type: SellType;
  strikes: number[];         // 1 for CE/PE, 1 for straddle, 2 for strangle [CE, PE]
  score: number;             // 0–100
  pattern: string;           // dominant pattern name
  reasons: string[];
  breakdown: ScoreBreakdown;
}

// ── Scoring Sub-functions ──

/**
 * Score 1: Pinning Detection (0–25)
 * Checks if spot has been hovering near max pain across snapshots
 * and if PCR is balanced (sellers defending both sides).
 */
function scorePinning(
  snapshots: OiSnapshot[],
  chain: OptionChainRow[],
  oiData: Map<number, number>,
  spotPrice: number,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const maxPain = calculateMaxPain(chain, oiData);
  if (maxPain === 0) return { score: 0, reasons };

  const distFromMaxPain = Math.abs(spotPrice - maxPain);

  // Check how many snapshots had spot within 50pts of max pain
  let pinnedCount = 0;
  for (const snap of snapshots) {
    if (snap.spot && snap.spot > 0) {
      if (Math.abs(snap.spot - maxPain) <= 50) pinnedCount++;
    }
  }

  // Current spot within 50pts of max pain
  if (distFromMaxPain <= 50) {
    score += 5;
    reasons.push(`Spot within ${distFromMaxPain.toFixed(0)}pts of max pain ${maxPain}`);
  }

  // Historical pinning across snapshots
  if (pinnedCount >= 3) {
    score += 10;
    reasons.push(`Spot pinned near max pain for ${pinnedCount * 10}+ minutes`);
  } else if (pinnedCount >= 2) {
    score += 7;
    reasons.push(`Spot near max pain in ${pinnedCount} snapshots`);
  }

  // PCR balance check
  const pcr = calculatePCR(chain, oiData);
  if (pcr >= 0.7 && pcr <= 1.3) {
    score += 10;
    reasons.push(`Balanced PCR (${pcr.toFixed(2)}) — sellers defending both sides`);
  } else if (pcr >= 0.5 && pcr <= 1.5) {
    score += 5;
    reasons.push(`Moderately balanced PCR (${pcr.toFixed(2)})`);
  }

  return { score: Math.min(25, score), reasons };
}

/**
 * Score 2: OI Wall Strength (0–25)
 * Checks if the target strike has an OI wall with fresh short buildup.
 */
function scoreOiWall(
  strike: number,
  type: 'ce' | 'pe',
  chain: OptionChainRow[],
  oiData: Map<number, number>,
  snapshots: OiSnapshot[],
  livePrices: Map<number, number>,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const walls = findOiWalls(chain, oiData, 1.3);
  const wallType = type === 'ce' ? 'resistance' : 'support';

  // Find wall at or near the strike (within 100pts)
  const relevantWalls = walls.filter(
    (w) => w.type === wallType && Math.abs(w.strike - strike) <= 100,
  );

  if (relevantWalls.length === 0) return { score: 0, reasons };

  const bestWall = relevantWalls.sort((a, b) => b.strength - a.strength)[0];

  // Wall strength scoring
  if (bestWall.strength >= 2.0) {
    score += 15;
    reasons.push(`Strong ${wallType} wall at ${bestWall.strike} (${bestWall.strength.toFixed(1)}x avg OI)`);
  } else if (bestWall.strength >= 1.5) {
    score += 10;
    reasons.push(`${wallType === 'resistance' ? 'Resistance' : 'Support'} wall at ${bestWall.strike} (${bestWall.strength.toFixed(1)}x avg OI)`);
  } else {
    score += 5;
    reasons.push(`Mild ${wallType} at ${bestWall.strike} (${bestWall.strength.toFixed(1)}x avg OI)`);
  }

  // Check if wall OI is growing (short buildup confirmation)
  if (snapshots.length > 0) {
    const firstSnap = snapshots[0];
    const row = chain.find((r) => r.strike === bestWall.strike);
    const token = type === 'ce' ? row?.ce?.instrumentToken : row?.pe?.instrumentToken;

    if (token) {
      const snapOi = Number(firstSnap.data[String(token)] || 0);
      const currentOi = oiData.get(token) || 0;
      const snapPrice = firstSnap.prices ? Number(firstSnap.prices[String(token)] || 0) : 0;
      const currentPrice = livePrices.get(token) || 0;

      if (snapOi > 0 && currentOi > snapOi) {
        const oiChangePct = ((currentOi - snapOi) / snapOi) * 100;
        const priceChangePct = snapPrice > 0 && currentPrice > 0
          ? ((currentPrice - snapPrice) / snapPrice) * 100
          : 0;

        const signal = classifyOiSignal(oiChangePct, priceChangePct);
        if (signal.signal === 'short-buildup') {
          score += 10;
          reasons.push(`Short buildup confirmed at wall — new sellers entering (OI +${oiChangePct.toFixed(1)}%)`);
        } else if (signal.signal === 'long-buildup') {
          score += 5;
          reasons.push(`Fresh positions building at wall (OI +${oiChangePct.toFixed(1)}%)`);
        }
      }
    }
  }

  return { score: Math.min(25, score), reasons };
}

/**
 * Score 3: Velocity Confirmation (0–20)
 * Checks if sellers are actively building at this strike
 * using the full intraday velocity pattern.
 */
function scoreVelocity(
  token: number | undefined,
  currentOi: number,
  snapshots: OiSnapshot[],
): { score: number; reasons: string[] } {
  if (!token || currentOi <= 0 || snapshots.length < 2) {
    return { score: 0, reasons: [] };
  }

  const reasons: string[] = [];
  const pattern = analyzeVelocityPattern(token, currentOi, snapshots);

  if (!pattern) return { score: 0, reasons };

  let score = 0;
  const label = pattern.label;

  if (label === 'Accelerating Buildup') {
    score = 20;
    reasons.push('Accelerating OI buildup — sellers adding aggressively');
  } else if (label === 'Steady Buildup') {
    score = 15;
    reasons.push('Steady OI buildup — consistent seller positioning');
  } else if (label === 'Buildup' || label === 'Mild Buildup') {
    score = 10;
    reasons.push('OI buildup detected — sellers are positioning');
  } else if (label === 'Stable') {
    score = 5;
    reasons.push('OI stable — no exit pressure from sellers');
  } else if (label.includes('Unwind') || label === 'Short Covering') {
    score = 0;
    // No reason added — negative signal shouldn't be shown as a reason TO sell
  } else if (label === 'Volatile') {
    score = 2;
  }

  return { score: Math.min(20, score), reasons };
}

/**
 * Score 4: PCR Extreme (0–15)
 * Checks for sustained extreme PCR that favours selling one side.
 */
function scorePcrExtreme(
  snapshots: OiSnapshot[],
  chain: OptionChainRow[],
  oiData: Map<number, number>,
  type: 'ce' | 'pe',
): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  // Compute PCR at each snapshot using that snapshot's OI data
  const pcrHistory: number[] = [];
  for (const snap of snapshots) {
    let totalCeOi = 0;
    let totalPeOi = 0;
    for (const row of chain) {
      if (row.ce) totalCeOi += Number(snap.data[String(row.ce.instrumentToken)] || 0);
      if (row.pe) totalPeOi += Number(snap.data[String(row.pe.instrumentToken)] || 0);
    }
    if (totalCeOi > 0) pcrHistory.push(totalPeOi / totalCeOi);
  }

  // Current PCR
  const currentPcr = calculatePCR(chain, oiData);
  pcrHistory.push(currentPcr);

  if (pcrHistory.length < 2) return { score: 0, reasons };

  // For sell-ce: low PCR is favourable (bearish bias, calls decay)
  // For sell-pe: high PCR is favourable (bullish bias, puts decay)
  const threshold = type === 'ce' ? 0.6 : 1.8;
  const isFavourable = type === 'ce'
    ? (pcr: number) => pcr < threshold
    : (pcr: number) => pcr > threshold;

  // Count consecutive favourable readings from the end
  let consecutive = 0;
  for (let i = pcrHistory.length - 1; i >= 0; i--) {
    if (isFavourable(pcrHistory[i])) consecutive++;
    else break;
  }

  let score = 0;
  if (consecutive >= 3) {
    score = 15;
    reasons.push(`PCR extreme (${currentPcr.toFixed(2)}) sustained for ${consecutive * 10}+ min — strong ${type === 'ce' ? 'bearish' : 'bullish'} bias`);
  } else if (consecutive >= 2) {
    score = 10;
    reasons.push(`PCR extreme (${currentPcr.toFixed(2)}) for ${consecutive * 10}+ min — ${type === 'ce' ? 'bearish' : 'bullish'} bias building`);
  } else if (consecutive >= 1) {
    score = 5;
    reasons.push(`PCR trending ${type === 'ce' ? 'low' : 'high'} (${currentPcr.toFixed(2)}) — early ${type === 'ce' ? 'bearish' : 'bullish'} signal`);
  }

  return { score: Math.min(15, score), reasons };
}

/**
 * Score 5: Time Decay Bonus (0–15)
 * Closer to expiry = better for sellers (theta works in their favour).
 */
function scoreTimeDecay(daysToExpiry: number | undefined): { score: number; reasons: string[] } {
  if (daysToExpiry === undefined || daysToExpiry < 0) return { score: 0, reasons: [] };

  const reasons: string[] = [];
  let score = 0;

  if (daysToExpiry === 0) {
    score = 15;
    reasons.push('Expiry day — maximum theta decay, sellers benefit most');
  } else if (daysToExpiry === 1) {
    score = 12;
    reasons.push('1 DTE — aggressive theta decay favouring sellers');
  } else if (daysToExpiry === 2) {
    score = 8;
    reasons.push('2 DTE — significant theta acceleration');
  } else if (daysToExpiry === 3) {
    score = 5;
    reasons.push('3 DTE — theta starting to accelerate');
  }

  return { score, reasons };
}

// ── Main Engine ──

interface StrikeScore {
  strike: number;
  type: 'ce' | 'pe';
  score: number;
  pattern: string;
  reasons: string[];
  breakdown: ScoreBreakdown;
}

/**
 * Compute sell recommendations for the visible option chain.
 * Requires at least 2 snapshots (20 minutes of market data).
 *
 * Returns up to 5 recommendations sorted by score, filtered above 30.
 */
export function computeSellRecommendations(
  chain: OptionChainRow[],
  oiData: Map<number, number>,
  livePrices: Map<number, number>,
  _prevDayOi: Map<number, number>,
  _closePrices: Map<number, number>,
  snapshots: OiSnapshot[],
  spotPrice: number,
  daysToExpiry?: number,
): SellRecommendation[] {
  if (chain.length === 0 || spotPrice === 0 || snapshots.length < 2) return [];

  // Market-level scores (same for all strikes)
  const pinningResult = scorePinning(snapshots, chain, oiData, spotPrice);
  const timeDecayResult = scoreTimeDecay(daysToExpiry);

  // Score each OTM strike for CE and PE selling
  const strikeScores: StrikeScore[] = [];

  for (const row of chain) {
    // CE selling: strikes above spot (OTM calls)
    if (row.ce && row.strike > spotPrice) {
      const ceToken = row.ce.instrumentToken;
      const currentOi = oiData.get(ceToken) || 0;
      const premium = livePrices.get(ceToken) || 0;
      if (premium <= 0 || currentOi <= 0) continue;

      const wallResult = scoreOiWall(row.strike, 'ce', chain, oiData, snapshots, livePrices);
      const velocityResult = scoreVelocity(ceToken, currentOi, snapshots);
      const pcrResult = scorePcrExtreme(snapshots, chain, oiData, 'ce');

      const breakdown: ScoreBreakdown = {
        pinning: pinningResult.score,
        oiWall: wallResult.score,
        velocity: velocityResult.score,
        pcrExtreme: pcrResult.score,
        timeDecay: timeDecayResult.score,
      };

      const totalScore = breakdown.pinning + breakdown.oiWall + breakdown.velocity + breakdown.pcrExtreme + breakdown.timeDecay;
      const reasons = [...pinningResult.reasons, ...wallResult.reasons, ...velocityResult.reasons, ...pcrResult.reasons, ...timeDecayResult.reasons];

      // Determine dominant pattern
      const pattern = getDominantPattern(breakdown);

      strikeScores.push({ strike: row.strike, type: 'ce', score: totalScore, pattern, reasons, breakdown });
    }

    // PE selling: strikes below spot (OTM puts)
    if (row.pe && row.strike < spotPrice) {
      const peToken = row.pe.instrumentToken;
      const currentOi = oiData.get(peToken) || 0;
      const premium = livePrices.get(peToken) || 0;
      if (premium <= 0 || currentOi <= 0) continue;

      const wallResult = scoreOiWall(row.strike, 'pe', chain, oiData, snapshots, livePrices);
      const velocityResult = scoreVelocity(peToken, currentOi, snapshots);
      const pcrResult = scorePcrExtreme(snapshots, chain, oiData, 'pe');

      const breakdown: ScoreBreakdown = {
        pinning: pinningResult.score,
        oiWall: wallResult.score,
        velocity: velocityResult.score,
        pcrExtreme: pcrResult.score,
        timeDecay: timeDecayResult.score,
      };

      const totalScore = breakdown.pinning + breakdown.oiWall + breakdown.velocity + breakdown.pcrExtreme + breakdown.timeDecay;
      const reasons = [...pinningResult.reasons, ...wallResult.reasons, ...velocityResult.reasons, ...pcrResult.reasons, ...timeDecayResult.reasons];

      const pattern = getDominantPattern(breakdown);

      strikeScores.push({ strike: row.strike, type: 'pe', score: totalScore, pattern, reasons, breakdown });
    }
  }

  // Build recommendations
  const recommendations: SellRecommendation[] = [];

  // Individual CE and PE recommendations
  for (const ss of strikeScores) {
    if (ss.score >= 30) {
      recommendations.push({
        type: ss.type === 'ce' ? 'sell-ce' : 'sell-pe',
        strikes: [ss.strike],
        score: ss.score,
        pattern: ss.pattern,
        reasons: ss.reasons,
        breakdown: ss.breakdown,
      });
    }
  }

  // Straddle: same strike, both CE and PE (near ATM, within 100pts)
  const ceScores = strikeScores.filter((s) => s.type === 'ce');
  const peScores = strikeScores.filter((s) => s.type === 'pe');

  for (const ce of ceScores) {
    const pe = peScores.find((p) => p.strike === ce.strike);
    if (pe && Math.abs(ce.strike - spotPrice) <= 100) {
      const straddleScore = Math.min(ce.score, pe.score);
      if (straddleScore >= 40) {
        const mergedBreakdown: ScoreBreakdown = {
          pinning: Math.max(ce.breakdown.pinning, pe.breakdown.pinning),
          oiWall: Math.min(ce.breakdown.oiWall, pe.breakdown.oiWall),
          velocity: Math.min(ce.breakdown.velocity, pe.breakdown.velocity),
          pcrExtreme: Math.min(ce.breakdown.pcrExtreme, pe.breakdown.pcrExtreme),
          timeDecay: ce.breakdown.timeDecay,
        };
        recommendations.push({
          type: 'sell-straddle',
          strikes: [ce.strike],
          score: straddleScore,
          pattern: getDominantPattern(mergedBreakdown),
          reasons: [...new Set([...ce.reasons, ...pe.reasons])],
          breakdown: mergedBreakdown,
        });
      }
    }
  }

  // Strangle: top CE + top PE at different strikes
  const topCe = ceScores.filter((s) => s.score >= 40).sort((a, b) => b.score - a.score)[0];
  const topPe = peScores.filter((s) => s.score >= 40).sort((a, b) => b.score - a.score)[0];

  if (topCe && topPe && topCe.strike !== topPe.strike) {
    const strangleScore = Math.round((topCe.score + topPe.score) / 2);
    if (strangleScore >= 40) {
      const mergedBreakdown: ScoreBreakdown = {
        pinning: Math.max(topCe.breakdown.pinning, topPe.breakdown.pinning),
        oiWall: Math.round((topCe.breakdown.oiWall + topPe.breakdown.oiWall) / 2),
        velocity: Math.round((topCe.breakdown.velocity + topPe.breakdown.velocity) / 2),
        pcrExtreme: Math.round((topCe.breakdown.pcrExtreme + topPe.breakdown.pcrExtreme) / 2),
        timeDecay: topCe.breakdown.timeDecay,
      };
      recommendations.push({
        type: 'sell-strangle',
        strikes: [topCe.strike, topPe.strike],
        score: strangleScore,
        pattern: getDominantPattern(mergedBreakdown),
        reasons: [...new Set([...topCe.reasons, ...topPe.reasons])],
        breakdown: mergedBreakdown,
      });
    }
  }

  // Sort by score descending, return top 5
  return recommendations.sort((a, b) => b.score - a.score).slice(0, 5);
}

/**
 * Determine the dominant pattern from the score breakdown.
 */
function getDominantPattern(breakdown: ScoreBreakdown): string {
  const entries: [string, number][] = [
    ['Pinning', breakdown.pinning],
    ['Wall Defense', breakdown.oiWall],
    ['Velocity Confirmed', breakdown.velocity],
    ['PCR Extreme', breakdown.pcrExtreme],
    ['Theta Decay', breakdown.timeDecay],
  ];

  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][1] > 0 ? entries[0][0] : 'Mixed';
}
