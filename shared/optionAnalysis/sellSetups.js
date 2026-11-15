/**
 * Scored option sell recommendations behind the Option Analyzer's Strategy card.
 * Shared, so the card (browser) and the setups strategy
 * (server/tradeEngine/strategies/optionAnalyzerSetups.js) score a chain the same way.
 */

import { analyzeVelocityPattern } from './velocityPattern.js';
import { OptionType } from '../tradeEnums.js';
import { LevelSide, OiSignal, OptionSetup, SetupPattern, VelocityTrend } from '../analysisEnums.js';
import { calculateMaxPain, calculatePCR, findOiWalls, classifyOiSignal } from './oiLevels.js';
import { strikeGap, volumeMultiplier } from './setupScoring.js';

/** OI unwinding through the day: no reason to sell. */
const UNWIND_TRENDS = /** @type {import('../analysisEnums.js').VelocityTrendId[]} */ ([
  VelocityTrend.AcceleratingUnwind, VelocityTrend.SteadyUnwind, VelocityTrend.SlowingUnwind, VelocityTrend.Unwinding, VelocityTrend.MildUnwind,
]);

/**
 * @typedef {import('./chain.js').ChainRow} ChainRow
 * @typedef {import('./velocityPattern.js').OiSnapshot} OiSnapshot
 */

/**
 * @typedef {typeof OptionSetup.SellCe | typeof OptionSetup.SellPe | typeof OptionSetup.SellStraddle | typeof OptionSetup.SellStrangle} SellType
 */

/**
 * @typedef {object} ScoreBreakdown
 * @property {number} pinning 0–25
 * @property {number} oiWall 0–25
 * @property {number} velocity 0–20
 * @property {number} pcrExtreme 0–15
 * @property {number} timeDecay 0–15
 */

/**
 * @typedef {object} SellRecommendation
 * @property {SellType} type
 * @property {number[]} strikes 1 for CE/PE, 1 for straddle, 2 for strangle [CE, PE]
 * @property {number} score 0–100
 * @property {import('../analysisEnums.js').SetupPatternId} pattern dominant pattern
 * @property {string[]} reasons
 * @property {ScoreBreakdown} breakdown
 * @property {number} pop Probability of Profit (0–99)
 * @property {number} premium Premium amount (per unit)
 */

/**
 * Score 1: Pinning Detection (0–25)
 * Checks if spot has been hovering near max pain across snapshots
 * and if PCR is balanced (sellers defending both sides).
 * @param {OiSnapshot[]} snapshots
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {number} spotPrice
 * @returns {{ score: number, reasons: string[] }}
 */
function scorePinning(
  snapshots,
  chain,
  oiData,
  spotPrice,
) {
  /** @type {string[]} */ const reasons = [];
  let score = 0;

  const maxPain = calculateMaxPain(chain, oiData);
  if (maxPain === 0) return { score: 0, reasons };

  const distFromMaxPain = Math.abs(spotPrice - maxPain);
  const gap = strikeGap(chain);

  let pinnedCount = 0;
  for (const snap of snapshots) {
    if (snap.spot && snap.spot > 0) {
      if (Math.abs(snap.spot - maxPain) <= gap) pinnedCount++;
    }
  }

  if (distFromMaxPain <= gap) {
    score += 5;
    reasons.push(`Spot within ${distFromMaxPain.toFixed(0)}pts of max pain ${maxPain}`);
  }

  if (pinnedCount >= 3) {
    score += 10;
    reasons.push(`Spot pinned near max pain for ${pinnedCount * 10}+ minutes`);
  } else if (pinnedCount >= 2) {
    score += 7;
    reasons.push(`Spot near max pain in ${pinnedCount} snapshots`);
  }

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
 * @param {number} strike
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {OiSnapshot[]} snapshots
 * @param {Map<number, number>} livePrices
 * @param {Map<number, number>} [volumeData=new Map()]
 * @param {number} [avgVolume=0]
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreOiWall(
  strike,
  type,
  chain,
  oiData,
  snapshots,
  livePrices,
  volumeData = new Map(),
  avgVolume = 0,
) {
  /** @type {string[]} */ const reasons = [];
  let score = 0;

  const walls = findOiWalls(chain, oiData, 1.3);
  const wallType = type === OptionType.CE ? LevelSide.Resistance : LevelSide.Support;

  // Find wall at or near the strike (within 100pts)
  const relevantWalls = walls.filter(
    (w) => w.type === wallType && Math.abs(w.strike - strike) <= 100,
  );

  if (relevantWalls.length === 0) return { score: 0, reasons };

  const bestWall = relevantWalls.sort((a, b) => b.strength - a.strength)[0];

  if (bestWall.strength >= 2.0) {
    score += 15;
    reasons.push(`Strong ${wallType} wall at ${bestWall.strike} (${bestWall.strength.toFixed(1)}x avg OI)`);
  } else if (bestWall.strength >= 1.5) {
    score += 10;
    reasons.push(`${wallType} wall at ${bestWall.strike} (${bestWall.strength.toFixed(1)}x avg OI)`);
  } else {
    score += 5;
    reasons.push(`Mild ${wallType} at ${bestWall.strike} (${bestWall.strength.toFixed(1)}x avg OI)`);
  }

  {
    const wallRow = chain.find((r) => r.strike === bestWall.strike);
    const wallToken = type === OptionType.CE ? wallRow?.ce?.instrumentToken : wallRow?.pe?.instrumentToken;
    const volMul = volumeMultiplier(wallToken, volumeData, avgVolume);
    if (volMul >= 1.3) {
      reasons.push('Wall built on high volume — strong institutional defense');
    } else if (volMul <= 0.6) {
      score = Math.round(score * 0.6);
      reasons.push('Wall on thin volume — may break easily');
    }
  }

  if (snapshots.length > 0) {
    const firstSnap = snapshots[0];
    const row = chain.find((r) => r.strike === bestWall.strike);
    const token = type === OptionType.CE ? row?.ce?.instrumentToken : row?.pe?.instrumentToken;

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
        if (signal.signal === OiSignal.ShortBuildup) {
          score += 10;
          reasons.push(`Short buildup confirmed at wall — new sellers entering (OI +${oiChangePct.toFixed(1)}%)`);
        } else if (signal.signal === OiSignal.LongBuildup) {
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
 * @param {number | undefined} token
 * @param {number} currentOi
 * @param {OiSnapshot[]} snapshots
 * @param {Map<number, number>} [volumeData=new Map()]
 * @param {number} [avgVolume=0]
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreVelocity(
  token,
  currentOi,
  snapshots,
  volumeData = new Map(),
  avgVolume = 0,
) {
  if (!token || currentOi <= 0 || snapshots.length < 2) {
    return { score: 0, reasons: [] };
  }

  /** @type {string[]} */ const reasons = [];
  const pattern = analyzeVelocityPattern(token, currentOi, snapshots);

  if (!pattern) return { score: 0, reasons };

  let score = 0;
  const { trend } = pattern;

  if (trend === VelocityTrend.AcceleratingBuildup) {
    score = 20;
    reasons.push('Accelerating OI buildup — sellers adding aggressively');
  } else if (trend === VelocityTrend.SteadyBuildup) {
    score = 15;
    reasons.push('Steady OI buildup — consistent seller positioning');
  } else if (trend === VelocityTrend.Buildup || trend === VelocityTrend.MildBuildup) {
    score = 10;
    reasons.push('OI buildup detected — sellers are positioning');
  } else if (trend === VelocityTrend.Stable) {
    score = 5;
    reasons.push('OI stable — no exit pressure from sellers');
  } else if (UNWIND_TRENDS.includes(trend)) {
    score = 0;
    // No reason added — negative signal shouldn't be shown as a reason TO sell
  } else if (trend === VelocityTrend.Volatile) {
    score = 2;
  }

  if (score > 0) {
    const volMul = volumeMultiplier(token, volumeData, avgVolume);
    score = Math.round(score * volMul);
    if (volMul >= 1.3) {
      reasons.push('Volume-confirmed buildup — high conviction');
    } else if (volMul <= 0.6) {
      reasons.push('Low volume — buildup may not hold');
    }
  }

  return { score: Math.min(20, score), reasons };
}

/**
 * Score 4: PCR Extreme (0–15)
 * Checks for sustained extreme PCR that favours selling one side.
 * @param {OiSnapshot[]} snapshots
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @returns {{ score: number, reasons: string[] }}
 */
function scorePcrExtreme(
  snapshots,
  chain,
  oiData,
  type,
) {
  /** @type {string[]} */ const reasons = [];

  /** @type {number[]} */ const pcrHistory = [];
  for (const snap of snapshots) {
    let totalCeOi = 0;
    let totalPeOi = 0;
    for (const row of chain) {
      if (row.ce) totalCeOi += Number(snap.data[String(row.ce.instrumentToken)] || 0);
      if (row.pe) totalPeOi += Number(snap.data[String(row.pe.instrumentToken)] || 0);
    }
    if (totalCeOi > 0) pcrHistory.push(totalPeOi / totalCeOi);
  }

  const currentPcr = calculatePCR(chain, oiData);
  pcrHistory.push(currentPcr);

  if (pcrHistory.length < 2) return { score: 0, reasons };

  // For sell-ce: low PCR is favourable (bearish bias, calls decay)
  // For sell-pe: high PCR is favourable (bullish bias, puts decay)
  const threshold = type === OptionType.CE ? 0.6 : 1.8;
  const isFavourable = type === OptionType.CE
    ? (/** @type {number} */ pcr) => pcr < threshold
    : (/** @type {number} */ pcr) => pcr > threshold;

  let consecutive = 0;
  for (let i = pcrHistory.length - 1; i >= 0; i--) {
    if (isFavourable(pcrHistory[i])) consecutive++;
    else break;
  }

  let score = 0;
  if (consecutive >= 3) {
    score = 15;
    reasons.push(`PCR extreme (${currentPcr.toFixed(2)}) sustained for ${consecutive * 10}+ min — strong ${type === OptionType.CE ? 'bearish' : 'bullish'} bias`);
  } else if (consecutive >= 2) {
    score = 10;
    reasons.push(`PCR extreme (${currentPcr.toFixed(2)}) for ${consecutive * 10}+ min — ${type === OptionType.CE ? 'bearish' : 'bullish'} bias building`);
  } else if (consecutive >= 1) {
    score = 5;
    reasons.push(`PCR trending ${type === OptionType.CE ? 'low' : 'high'} (${currentPcr.toFixed(2)}) — early ${type === OptionType.CE ? 'bearish' : 'bullish'} signal`);
  }

  return { score: Math.min(15, score), reasons };
}

/**
 * Score 5: Time Decay Bonus (0–15)
 * Closer to expiry = better for sellers (theta works in their favour).
 * @param {number | undefined} daysToExpiry
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreTimeDecay(daysToExpiry) {
  if (daysToExpiry === undefined || daysToExpiry < 0) return { score: 0, reasons: [] };

  /** @type {string[]} */ const reasons = [];
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

/**
 * @typedef {object} StrikeScore
 * @property {number} strike
 * @property {import('../tradeEnums.js').OptionTypeId} type
 * @property {number} score
 * @property {import('../analysisEnums.js').SetupPatternId} pattern
 * @property {string[]} reasons
 * @property {ScoreBreakdown} breakdown
 * @property {number} pop
 * @property {number} premium
 */

/**
 * Calculate Probability of Profit for selling an option.
 * Uses a simplified normal distribution approximation based on expected move.
 * @param {number} strike
 * @param {number} spotPrice
 * @param {number} expectedMove
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @returns {number}
 */
function calculatePOP(strike, spotPrice, expectedMove, type) {
  if (expectedMove <= 0) return 50;
  const sd = expectedMove;
  const distance = type === OptionType.CE ? strike - spotPrice : spotPrice - strike;
  const zScore = distance / sd;
  const pop = 100 / (1 + Math.exp(-1.7 * zScore));
  return Math.min(99, Math.max(1, pop));
}

/**
 * Compute sell recommendations for the visible option chain.
 * Requires at least 2 snapshots (20 minutes of market data).
 *
 * Returns up to 5 recommendations sorted by score, filtered above 30.
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {Map<number, number>} livePrices
 * @param {Map<number, number>} _prevDayOi
 * @param {Map<number, number>} _closePrices
 * @param {OiSnapshot[]} snapshots
 * @param {number} spotPrice
 * @param {number} [daysToExpiry]
 * @param {number} [atmStrike]
 * @param {Map<number, number>} [volumeData=new Map()]
 * @param {number} [avgVolume=0]
 * @returns {SellRecommendation[]}
 */
export function computeSellRecommendations(
  chain,
  oiData,
  livePrices,
  _prevDayOi,
  _closePrices,
  snapshots,
  spotPrice,
  daysToExpiry,
  atmStrike,
  volumeData = new Map(),
  avgVolume = 0,
) {
  if (chain.length === 0 || spotPrice === 0 || snapshots.length < 2) return [];

  // Expected move from ATM straddle premium (for POP calculation)
  let expectedMove = 0;
  if (atmStrike) {
    const atmRow = chain.find((r) => r.strike === atmStrike);
    if (atmRow) {
      const cePrice = atmRow.ce ? livePrices.get(atmRow.ce.instrumentToken) || 0 : 0;
      const pePrice = atmRow.pe ? livePrices.get(atmRow.pe.instrumentToken) || 0 : 0;
      expectedMove = cePrice + pePrice;
    }
  }

  const pinningResult = scorePinning(snapshots, chain, oiData, spotPrice);
  const timeDecayResult = scoreTimeDecay(daysToExpiry);

  /** @type {StrikeScore[]} */ const strikeScores = [];

  for (const row of chain) {
    if (row.ce && row.strike > spotPrice) {
      const ceToken = row.ce.instrumentToken;
      const currentOi = oiData.get(ceToken) || 0;
      const premium = livePrices.get(ceToken) || 0;
      if (premium <= 0 || currentOi <= 0) continue;

      const wallResult = scoreOiWall(row.strike, OptionType.CE, chain, oiData, snapshots, livePrices, volumeData, avgVolume);
      const velocityResult = scoreVelocity(ceToken, currentOi, snapshots, volumeData, avgVolume);
      const pcrResult = scorePcrExtreme(snapshots, chain, oiData, OptionType.CE);

      /** @type {ScoreBreakdown} */ const breakdown = {
        pinning: pinningResult.score,
        oiWall: wallResult.score,
        velocity: velocityResult.score,
        pcrExtreme: pcrResult.score,
        timeDecay: timeDecayResult.score,
      };

      const totalScore = breakdown.pinning + breakdown.oiWall + breakdown.velocity + breakdown.pcrExtreme + breakdown.timeDecay;
      const reasons = [...pinningResult.reasons, ...wallResult.reasons, ...velocityResult.reasons, ...pcrResult.reasons, ...timeDecayResult.reasons];

      const pattern = getDominantPattern(breakdown);
      const pop = calculatePOP(row.strike, spotPrice, expectedMove, OptionType.CE);

      strikeScores.push({ strike: row.strike, type: OptionType.CE, score: totalScore, pattern, reasons, breakdown, pop, premium });
    }

    if (row.pe && row.strike < spotPrice) {
      const peToken = row.pe.instrumentToken;
      const currentOi = oiData.get(peToken) || 0;
      const premium = livePrices.get(peToken) || 0;
      if (premium <= 0 || currentOi <= 0) continue;

      const wallResult = scoreOiWall(row.strike, OptionType.PE, chain, oiData, snapshots, livePrices, volumeData, avgVolume);
      const velocityResult = scoreVelocity(peToken, currentOi, snapshots, volumeData, avgVolume);
      const pcrResult = scorePcrExtreme(snapshots, chain, oiData, OptionType.PE);

      /** @type {ScoreBreakdown} */ const breakdown = {
        pinning: pinningResult.score,
        oiWall: wallResult.score,
        velocity: velocityResult.score,
        pcrExtreme: pcrResult.score,
        timeDecay: timeDecayResult.score,
      };

      const totalScore = breakdown.pinning + breakdown.oiWall + breakdown.velocity + breakdown.pcrExtreme + breakdown.timeDecay;
      const reasons = [...pinningResult.reasons, ...wallResult.reasons, ...velocityResult.reasons, ...pcrResult.reasons, ...timeDecayResult.reasons];

      const pattern = getDominantPattern(breakdown);
      const pop = calculatePOP(row.strike, spotPrice, expectedMove, OptionType.PE);

      strikeScores.push({ strike: row.strike, type: OptionType.PE, score: totalScore, pattern, reasons, breakdown, pop, premium });
    }
  }

  /** @type {SellRecommendation[]} */ const recommendations = [];

  for (const ss of strikeScores) {
    if (ss.score >= 30) {
      recommendations.push({
        type: ss.type === OptionType.CE ? OptionSetup.SellCe : OptionSetup.SellPe,
        strikes: [ss.strike],
        score: ss.score,
        pattern: ss.pattern,
        reasons: ss.reasons,
        breakdown: ss.breakdown,
        pop: ss.pop,
        premium: ss.premium,
      });
    }
  }

  const ceScores = strikeScores.filter((s) => s.type === OptionType.CE);
  const peScores = strikeScores.filter((s) => s.type === OptionType.PE);

  for (const ce of ceScores) {
    const pe = peScores.find((p) => p.strike === ce.strike);
    if (pe && Math.abs(ce.strike - spotPrice) <= 100) {
      const straddleScore = Math.min(ce.score, pe.score);
      if (straddleScore >= 40) {
        /** @type {ScoreBreakdown} */ const mergedBreakdown = {
          pinning: Math.max(ce.breakdown.pinning, pe.breakdown.pinning),
          oiWall: Math.min(ce.breakdown.oiWall, pe.breakdown.oiWall),
          velocity: Math.min(ce.breakdown.velocity, pe.breakdown.velocity),
          pcrExtreme: Math.min(ce.breakdown.pcrExtreme, pe.breakdown.pcrExtreme),
          timeDecay: ce.breakdown.timeDecay,
        };
        recommendations.push({
          type: OptionSetup.SellStraddle,
          strikes: [ce.strike],
          score: straddleScore,
          pattern: getDominantPattern(mergedBreakdown),
          reasons: [...new Set([...ce.reasons, ...pe.reasons])],
          breakdown: mergedBreakdown,
          pop: Math.min(ce.pop, pe.pop),
          premium: ce.premium + pe.premium,
        });
      }
    }
  }

  const topCe = ceScores.filter((s) => s.score >= 40).sort((a, b) => b.score - a.score)[0];
  const topPe = peScores.filter((s) => s.score >= 40).sort((a, b) => b.score - a.score)[0];

  if (topCe && topPe && topCe.strike !== topPe.strike) {
    const strangleScore = Math.round((topCe.score + topPe.score) / 2);
    if (strangleScore >= 40) {
      /** @type {ScoreBreakdown} */ const mergedBreakdown = {
        pinning: Math.max(topCe.breakdown.pinning, topPe.breakdown.pinning),
        oiWall: Math.round((topCe.breakdown.oiWall + topPe.breakdown.oiWall) / 2),
        velocity: Math.round((topCe.breakdown.velocity + topPe.breakdown.velocity) / 2),
        pcrExtreme: Math.round((topCe.breakdown.pcrExtreme + topPe.breakdown.pcrExtreme) / 2),
        timeDecay: topCe.breakdown.timeDecay,
      };
      recommendations.push({
        type: OptionSetup.SellStrangle,
        strikes: [topCe.strike, topPe.strike],
        score: strangleScore,
        pattern: getDominantPattern(mergedBreakdown),
        reasons: [...new Set([...topCe.reasons, ...topPe.reasons])],
        breakdown: mergedBreakdown,
        pop: Math.min(topCe.pop, topPe.pop),
        premium: topCe.premium + topPe.premium,
      });
    }
  }

  return recommendations.sort((a, b) => b.score - a.score).slice(0, 5);
}

/**
 * @param {ScoreBreakdown} breakdown
 * @returns {import('../analysisEnums.js').SetupPatternId}
 */
function getDominantPattern(breakdown) {
  /** @type {[import('../analysisEnums.js').SetupPatternId, number][]} */ const entries = [
    [SetupPattern.Pinning, breakdown.pinning],
    [SetupPattern.WallDefense, breakdown.oiWall],
    [SetupPattern.VelocityConfirmed, breakdown.velocity],
    [SetupPattern.PcrExtreme, breakdown.pcrExtreme],
    [SetupPattern.ThetaDecay, breakdown.timeDecay],
  ];

  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][1] > 0 ? entries[0][0] : SetupPattern.Mixed;
}
