/**
 * Scored option buy recommendations behind the Option Analyzer's Strategy card.
 * Shared, so the card (browser) and the setups strategy
 * (server/tradeEngine/strategies/optionAnalyzerSetups.js) score a chain the same way.
 */

import { analyzeVelocityPattern } from './velocityPattern.js';
import { OptionType } from '../tradeEnums.js';
import { LevelSide, OiSignal, OptionSetup, SetupPattern, VelocityTrend } from '../analysisEnums.js';
import { calculatePCR, findOiWalls, classifyOiSignal } from './oiLevels.js';
import { strikeGap, volumeMultiplier } from './setupScoring.js';

/**
 * @typedef {import('./chain.js').ChainRow} ChainRow
 * @typedef {import('./velocityPattern.js').OiSnapshot} OiSnapshot
 */

/**
 * @typedef {typeof OptionSetup.BuyCe | typeof OptionSetup.BuyPe | typeof OptionSetup.BuyStraddle | typeof OptionSetup.BuyStrangle} BuyType
 */

/**
 * @typedef {object} BuyScoreBreakdown
 * @property {number} breakout 0–25
 * @property {number} directionalOi 0–25
 * @property {number} momentum 0–20
 * @property {number} pcrShift 0–15
 * @property {number} riskReward 0–15
 */

/**
 * @typedef {object} BuyRecommendation
 * @property {BuyType} type
 * @property {number[]} strikes
 * @property {number} score
 * @property {import('../analysisEnums.js').SetupPatternId} pattern
 * @property {string[]} reasons
 * @property {BuyScoreBreakdown} breakdown
 * @property {number} premium
 */

/**
 * Buy Score 1: Breakout Detection (0–25)
 * Detects OI walls weakening/unwinding — resistance or support breaking.
 * For buy-ce: CE resistance walls cracking (short covering on CE).
 * For buy-pe: PE support walls cracking (long unwinding on PE).
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {OiSnapshot[]} snapshots
 * @param {Map<number, number>} livePrices
 * @param {number} spotPrice
 * @param {Map<number, number>} [volumeData=new Map()]
 * @param {number} [avgVolume=0]
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreBreakout(
  type,
  chain,
  oiData,
  snapshots,
  livePrices,
  spotPrice,
  volumeData = new Map(),
  avgVolume = 0,
) {
  /** @type {string[]} */ const reasons = [];
  let score = 0;

  const walls = findOiWalls(chain, oiData, 1.3);
  // For buy CE: look for CE resistance walls weakening above spot
  // For buy PE: look for PE support walls weakening below spot
  const wallType = type === OptionType.CE ? LevelSide.Resistance : LevelSide.Support;
  const nearbyWalls = walls.filter(
    (w) => w.type === wallType &&
      (type === OptionType.CE ? w.strike > spotPrice && w.strike <= spotPrice + 300 : w.strike < spotPrice && w.strike >= spotPrice - 300),
  );

  if (nearbyWalls.length === 0 || snapshots.length === 0) return { score: 0, reasons };

  const firstSnap = snapshots[0];

  for (const wall of nearbyWalls) {
    const row = chain.find((r) => r.strike === wall.strike);
    const token = type === OptionType.CE ? row?.ce?.instrumentToken : row?.pe?.instrumentToken;
    if (!token) continue;

    const snapOi = Number(firstSnap.data[String(token)] || 0);
    const currentOi = oiData.get(token) || 0;
    if (snapOi <= 0) continue;

    const oiChangePct = ((currentOi - snapOi) / snapOi) * 100;
    const snapPrice = firstSnap.prices ? Number(firstSnap.prices[String(token)] || 0) : 0;
    const currentPrice = livePrices.get(token) || 0;
    const priceChangePct = snapPrice > 0 && currentPrice > 0
      ? ((currentPrice - snapPrice) / snapPrice) * 100
      : 0;

    const signal = classifyOiSignal(oiChangePct, priceChangePct);

    if (oiChangePct < -10) {
      score += 15;
      reasons.push(`${wallType} wall at ${wall.strike} breaking down (OI ${oiChangePct.toFixed(1)}%)`);
    } else if (oiChangePct < -5) {
      score += 10;
      reasons.push(`${wallType} wall at ${wall.strike} weakening (OI ${oiChangePct.toFixed(1)}%)`);
    }

    if (signal.signal === OiSignal.ShortCovering) {
      score += 10;
      reasons.push(`Short covering at ${wall.strike} — sellers exiting, ${type === OptionType.CE ? 'upside' : 'downside'} opening`);
    } else if (signal.signal === OiSignal.LongUnwinding) {
      score += 5;
      reasons.push(`Long unwinding at ${wall.strike} — ${wallType} weakening`);
    }

    const volMul = volumeMultiplier(token, volumeData, avgVolume);
    if (volMul >= 1.3 && score > 0) {
      score += 5;
      reasons.push('Breakout on surge volume — high conviction');
    } else if (volMul <= 0.6 && score > 0) {
      score = Math.round(score * 0.7);
      reasons.push('Low volume breakout — could be fake breakout');
    }

    break; // Score only the nearest wall
  }

  return { score: Math.min(25, score), reasons };
}

/**
 * Buy Score 2: Directional OI Signal (0–25)
 * Checks for sustained Long Buildup (OI↑ + Price↑) on the option type being bought.
 * For buy-ce: Long Buildup on CE across snapshots = buyers entering calls = bullish.
 * For buy-pe: Long Buildup on PE across snapshots = buyers entering puts = bearish.
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {Map<number, number>} livePrices
 * @param {OiSnapshot[]} snapshots
 * @param {number} spotPrice
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreDirectionalOi(
  type,
  chain,
  oiData,
  livePrices,
  snapshots,
  spotPrice,
) {
  /** @type {string[]} */ const reasons = [];
  let score = 0;

  if (snapshots.length < 2) return { score: 0, reasons };

  const nearStrikes = chain.filter((r) => Math.abs(r.strike - spotPrice) <= 200);
  let longBuildupCount = 0;
  let totalChecked = 0;

  const firstSnap = snapshots[0];

  for (const row of nearStrikes) {
    const token = type === OptionType.CE ? row.ce?.instrumentToken : row.pe?.instrumentToken;
    if (!token) continue;

    const snapOi = Number(firstSnap.data[String(token)] || 0);
    const currentOi = oiData.get(token) || 0;
    if (snapOi <= 0) continue;

    const oiChangePct = ((currentOi - snapOi) / snapOi) * 100;
    const snapPrice = firstSnap.prices ? Number(firstSnap.prices[String(token)] || 0) : 0;
    const currentPrice = livePrices.get(token) || 0;
    const priceChangePct = snapPrice > 0 && currentPrice > 0
      ? ((currentPrice - snapPrice) / snapPrice) * 100
      : 0;

    const signal = classifyOiSignal(oiChangePct, priceChangePct);
    totalChecked++;

    if (signal.signal === OiSignal.LongBuildup) longBuildupCount++;
  }

  if (totalChecked === 0) return { score: 0, reasons };

  const ratio = longBuildupCount / totalChecked;

  if (ratio >= 0.6) {
    score = 25;
    reasons.push(`Strong ${type} Long Buildup across ${longBuildupCount}/${totalChecked} strikes — buyers entering aggressively`);
  } else if (ratio >= 0.4) {
    score = 18;
    reasons.push(`${type} Long Buildup on ${longBuildupCount}/${totalChecked} strikes — buyer conviction building`);
  } else if (ratio >= 0.2) {
    score = 10;
    reasons.push(`Early ${type} Long Buildup signal on ${longBuildupCount} strikes`);
  }

  return { score: Math.min(25, score), reasons };
}

/**
 * Buy Score 3: Momentum Confirmation (0–20)
 * Checks for velocity acceleration on the buy side
 * AND short covering / unwinding on the opposite side.
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {Map<number, number>} livePrices
 * @param {OiSnapshot[]} snapshots
 * @param {number} spotPrice
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreBuyMomentum(
  type,
  chain,
  oiData,
  livePrices,
  snapshots,
  spotPrice,
) {
  /** @type {string[]} */ const reasons = [];
  let score = 0;

  if (snapshots.length < 2) return { score: 0, reasons };

  const firstSnap = snapshots[0];
  const oppType = type === OptionType.CE ? OptionType.PE : OptionType.CE;

  // Check velocity on the buy side (near ATM)
  const gap = strikeGap(chain);
  const atmRow = chain.find((r) => Math.abs(r.strike - spotPrice) <= gap);
  if (atmRow) {
    const buyToken = type === OptionType.CE ? atmRow.ce?.instrumentToken : atmRow.pe?.instrumentToken;
    if (buyToken) {
      const currentOi = oiData.get(buyToken) || 0;
      if (currentOi > 0) {
        const pattern = analyzeVelocityPattern(buyToken, currentOi, snapshots);
        if (pattern) {
          if (pattern.trend === VelocityTrend.AcceleratingBuildup) {
            score += 12;
            reasons.push(`Accelerating ${type} buildup at ATM — momentum surging`);
          } else if (pattern.trend === VelocityTrend.SteadyBuildup) {
            score += 8;
            reasons.push(`Steady ${type} buildup at ATM — sustained buying pressure`);
          } else if (pattern.trend === VelocityTrend.Buildup || pattern.trend === VelocityTrend.MildBuildup) {
            score += 5;
            reasons.push(`${type} buildup at ATM — buyers active`);
          }
        }
      }
    }
  }

  // Check opposite side for short covering / unwinding
  let oppUnwindCount = 0;
  let oppChecked = 0;
  const nearStrikes = chain.filter((r) => Math.abs(r.strike - spotPrice) <= 200);

  for (const row of nearStrikes) {
    const token = oppType === OptionType.CE ? row.ce?.instrumentToken : row.pe?.instrumentToken;
    if (!token) continue;

    const snapOi = Number(firstSnap.data[String(token)] || 0);
    const currentOi = oiData.get(token) || 0;
    if (snapOi <= 0) continue;

    const oiChangePct = ((currentOi - snapOi) / snapOi) * 100;
    const snapPrice = firstSnap.prices ? Number(firstSnap.prices[String(token)] || 0) : 0;
    const currentPrice = livePrices.get(token) || 0;
    const priceChangePct = snapPrice > 0 && currentPrice > 0
      ? ((currentPrice - snapPrice) / snapPrice) * 100
      : 0;

    const signal = classifyOiSignal(oiChangePct, priceChangePct);
    oppChecked++;
    if (signal.signal === OiSignal.ShortCovering || signal.signal === OiSignal.LongUnwinding) oppUnwindCount++;
  }

  if (oppChecked > 0 && oppUnwindCount / oppChecked >= 0.3) {
    score += 8;
    reasons.push(`${oppType.toUpperCase()} unwinding on ${oppUnwindCount} strikes — opposite side retreating`);
  }

  return { score: Math.min(20, score), reasons };
}

/**
 * Buy Score 4: PCR Shift (0–15)
 * Checks if PCR is trending in a direction that favours the buy.
 * For buy-ce: rising PCR = bullish (PE sellers > CE sellers).
 * For buy-pe: falling PCR = bearish (CE sellers > PE sellers).
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {OiSnapshot[]} snapshots
 * @returns {{ score: number, reasons: string[] }}
 */
function scorePcrShift(
  type,
  chain,
  oiData,
  snapshots,
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

  // For buy-ce: rising PCR is favourable (bullish)
  // For buy-pe: falling PCR is favourable (bearish)
  let trendingCount = 0;
  for (let i = 1; i < pcrHistory.length; i++) {
    const delta = pcrHistory[i] - pcrHistory[i - 1];
    if (type === OptionType.CE && delta > 0.02) trendingCount++;
    if (type === OptionType.PE && delta < -0.02) trendingCount++;
  }

  let score = 0;
  const direction = type === OptionType.CE ? 'rising' : 'falling';
  const bias = type === OptionType.CE ? 'bullish' : 'bearish';

  if (trendingCount >= 3) {
    score = 15;
    reasons.push(`PCR ${direction} for ${trendingCount} intervals (${currentPcr.toFixed(2)}) — strong ${bias} shift`);
  } else if (trendingCount >= 2) {
    score = 10;
    reasons.push(`PCR ${direction} (${currentPcr.toFixed(2)}) — ${bias} momentum building`);
  } else if (trendingCount >= 1) {
    score = 5;
    reasons.push(`PCR starting to ${type === OptionType.CE ? 'rise' : 'fall'} (${currentPcr.toFixed(2)}) — early ${bias} signal`);
  }

  return { score: Math.min(15, score), reasons };
}

/**
 * Buy Score 5: Risk/Reward (0–15)
 * Scores strikes near ATM where premium vs expected move gives favourable risk/reward.
 * ATM and slightly OTM (within 1 SD) are best for buying.
 * @param {number} strike
 * @param {number} spotPrice
 * @param {number} expectedMove
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @param {number} premium
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreRiskReward(
  strike,
  spotPrice,
  expectedMove,
  type,
  premium,
) {
  /** @type {string[]} */ const reasons = [];
  let score = 0;

  if (expectedMove <= 0 || premium <= 0) return { score: 0, reasons };

  // Distance from ATM as fraction of expected move
  const distance = type === OptionType.CE ? strike - spotPrice : spotPrice - strike;
  const distanceFraction = distance / expectedMove;

  // ATM or slightly OTM is best for buying
  if (distanceFraction >= 0 && distanceFraction <= 0.3) {
    score += 10;
    reasons.push(`Near ATM — high delta, strong directional exposure`);
  } else if (distanceFraction > 0.3 && distanceFraction <= 0.7) {
    score += 7;
    reasons.push(`Slightly OTM — good risk/reward balance`);
  } else if (distanceFraction > 0.7 && distanceFraction <= 1.0) {
    score += 4;
    reasons.push(`OTM within expected move — reasonable if momentum sustains`);
  }

  // Breakeven ratio: premium vs expected move (lower = better for buyer)
  const breakevenRatio = premium / expectedMove;
  if (breakevenRatio < 0.3) {
    score += 5;
    reasons.push(`Low premium relative to expected move (${(breakevenRatio * 100).toFixed(0)}%) — favourable risk/reward`);
  } else if (breakevenRatio < 0.5) {
    score += 3;
    reasons.push(`Moderate premium vs expected move (${(breakevenRatio * 100).toFixed(0)}%)`);
  }

  return { score: Math.min(15, score), reasons };
}

/**
 * @param {BuyScoreBreakdown} breakdown
 * @returns {import('../analysisEnums.js').SetupPatternId}
 */
function getBuyDominantPattern(breakdown) {
  /** @type {[import('../analysisEnums.js').SetupPatternId, number][]} */ const entries = [
    [SetupPattern.Breakout, breakdown.breakout],
    [SetupPattern.DirectionalOi, breakdown.directionalOi],
    [SetupPattern.Momentum, breakdown.momentum],
    [SetupPattern.PcrShift, breakdown.pcrShift],
    [SetupPattern.RiskReward, breakdown.riskReward],
  ];

  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][1] > 0 ? entries[0][0] : SetupPattern.Mixed;
}

/**
 * @typedef {object} BuyStrikeScore
 * @property {number} strike
 * @property {import('../tradeEnums.js').OptionTypeId} type
 * @property {number} score
 * @property {import('../analysisEnums.js').SetupPatternId} pattern
 * @property {string[]} reasons
 * @property {BuyScoreBreakdown} breakdown
 * @property {number} premium
 */

/**
 * Compute buy recommendations for the visible option chain.
 * Targets ATM and slightly OTM strikes where directional conviction is highest.
 * Requires at least 2 snapshots.
 *
 * Returns up to 5 recommendations sorted by score, filtered above 30.
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {Map<number, number>} livePrices
 * @param {Map<number, number>} _prevDayOi
 * @param {Map<number, number>} _closePrices
 * @param {OiSnapshot[]} snapshots
 * @param {number} spotPrice
 * @param {number} [_daysToExpiry]
 * @param {number} [atmStrike]
 * @param {Map<number, number>} [volumeData=new Map()]
 * @param {number} [avgVolume=0]
 * @returns {BuyRecommendation[]}
 */
export function computeBuyRecommendations(
  chain,
  oiData,
  livePrices,
  _prevDayOi,
  _closePrices,
  snapshots,
  spotPrice,
  _daysToExpiry,
  atmStrike,
  volumeData = new Map(),
  avgVolume = 0,
) {
  if (chain.length === 0 || spotPrice === 0 || snapshots.length < 2) return [];

  // Expected move from ATM straddle
  let expectedMove = 0;
  if (atmStrike) {
    const atmRow = chain.find((r) => r.strike === atmStrike);
    if (atmRow) {
      const cePrice = atmRow.ce ? livePrices.get(atmRow.ce.instrumentToken) || 0 : 0;
      const pePrice = atmRow.pe ? livePrices.get(atmRow.pe.instrumentToken) || 0 : 0;
      expectedMove = cePrice + pePrice;
    }
  }

  // Score each ATM/slightly OTM strike for CE and PE buying
  /** @type {BuyStrikeScore[]} */ const strikeScores = [];

  for (const row of chain) {
    // CE buying: ATM and slightly OTM (above spot, within 1.5x expected move)
    const ceDistance = row.strike - spotPrice;
    if (row.ce && ceDistance >= -50 && (expectedMove <= 0 || ceDistance <= expectedMove * 1.5)) {
      const ceToken = row.ce.instrumentToken;
      const premium = livePrices.get(ceToken) || 0;
      if (premium <= 0) continue;

      const breakoutResult = scoreBreakout(OptionType.CE, chain, oiData, snapshots, livePrices, spotPrice, volumeData, avgVolume);
      const directionalResult = scoreDirectionalOi(OptionType.CE, chain, oiData, livePrices, snapshots, spotPrice);
      const momentumResult = scoreBuyMomentum(OptionType.CE, chain, oiData, livePrices, snapshots, spotPrice);
      const pcrResult = scorePcrShift(OptionType.CE, chain, oiData, snapshots);
      const rrResult = scoreRiskReward(row.strike, spotPrice, expectedMove, OptionType.CE, premium);

      /** @type {BuyScoreBreakdown} */ const breakdown = {
        breakout: breakoutResult.score,
        directionalOi: directionalResult.score,
        momentum: momentumResult.score,
        pcrShift: pcrResult.score,
        riskReward: rrResult.score,
      };

      const totalScore = breakdown.breakout + breakdown.directionalOi + breakdown.momentum + breakdown.pcrShift + breakdown.riskReward;
      const reasons = [...breakoutResult.reasons, ...directionalResult.reasons, ...momentumResult.reasons, ...pcrResult.reasons, ...rrResult.reasons];

      strikeScores.push({
        strike: row.strike,
        type: OptionType.CE,
        score: totalScore,
        pattern: getBuyDominantPattern(breakdown),
        reasons,
        breakdown,
        premium,
      });
    }

    // PE buying: ATM and slightly OTM (below spot, within 1.5x expected move)
    const peDistance = spotPrice - row.strike;
    if (row.pe && peDistance >= -50 && (expectedMove <= 0 || peDistance <= expectedMove * 1.5)) {
      const peToken = row.pe.instrumentToken;
      const premium = livePrices.get(peToken) || 0;
      if (premium <= 0) continue;

      const breakoutResult = scoreBreakout(OptionType.PE, chain, oiData, snapshots, livePrices, spotPrice, volumeData, avgVolume);
      const directionalResult = scoreDirectionalOi(OptionType.PE, chain, oiData, livePrices, snapshots, spotPrice);
      const momentumResult = scoreBuyMomentum(OptionType.PE, chain, oiData, livePrices, snapshots, spotPrice);
      const pcrResult = scorePcrShift(OptionType.PE, chain, oiData, snapshots);
      const rrResult = scoreRiskReward(row.strike, spotPrice, expectedMove, OptionType.PE, premium);

      /** @type {BuyScoreBreakdown} */ const breakdown = {
        breakout: breakoutResult.score,
        directionalOi: directionalResult.score,
        momentum: momentumResult.score,
        pcrShift: pcrResult.score,
        riskReward: rrResult.score,
      };

      const totalScore = breakdown.breakout + breakdown.directionalOi + breakdown.momentum + breakdown.pcrShift + breakdown.riskReward;
      const reasons = [...breakoutResult.reasons, ...directionalResult.reasons, ...momentumResult.reasons, ...pcrResult.reasons, ...rrResult.reasons];

      strikeScores.push({
        strike: row.strike,
        type: OptionType.PE,
        score: totalScore,
        pattern: getBuyDominantPattern(breakdown),
        reasons,
        breakdown,
        premium,
      });
    }
  }

  /** @type {BuyRecommendation[]} */ const recommendations = [];

  for (const ss of strikeScores) {
    if (ss.score >= 30) {
      recommendations.push({
        type: ss.type === OptionType.CE ? OptionSetup.BuyCe : OptionSetup.BuyPe,
        strikes: [ss.strike],
        score: ss.score,
        pattern: ss.pattern,
        reasons: ss.reasons,
        breakdown: ss.breakdown,
        premium: ss.premium,
      });
    }
  }

  const ceScores = strikeScores.filter((s) => s.type === OptionType.CE);
  const peScores = strikeScores.filter((s) => s.type === OptionType.PE);
  const gap = strikeGap(chain);

  for (const ce of ceScores) {
    const pe = peScores.find((p) => p.strike === ce.strike);
    if (pe && Math.abs(ce.strike - spotPrice) <= gap) {
      const straddleScore = Math.round((ce.score + pe.score) / 2);
      if (straddleScore >= 35) {
        /** @type {BuyScoreBreakdown} */ const mergedBreakdown = {
          breakout: Math.max(ce.breakdown.breakout, pe.breakdown.breakout),
          directionalOi: Math.max(ce.breakdown.directionalOi, pe.breakdown.directionalOi),
          momentum: Math.max(ce.breakdown.momentum, pe.breakdown.momentum),
          pcrShift: Math.round((ce.breakdown.pcrShift + pe.breakdown.pcrShift) / 2),
          riskReward: Math.round((ce.breakdown.riskReward + pe.breakdown.riskReward) / 2),
        };
        recommendations.push({
          type: OptionSetup.BuyStraddle,
          strikes: [ce.strike],
          score: straddleScore,
          pattern: getBuyDominantPattern(mergedBreakdown),
          reasons: [...new Set([...ce.reasons, ...pe.reasons])],
          breakdown: mergedBreakdown,
          premium: ce.premium + pe.premium,
        });
      }
    }
  }

  const topCe = ceScores.filter((s) => s.score >= 35).sort((a, b) => b.score - a.score)[0];
  const topPe = peScores.filter((s) => s.score >= 35).sort((a, b) => b.score - a.score)[0];

  if (topCe && topPe && topCe.strike !== topPe.strike) {
    const strangleScore = Math.round((topCe.score + topPe.score) / 2);
    if (strangleScore >= 35) {
      /** @type {BuyScoreBreakdown} */ const mergedBreakdown = {
        breakout: Math.max(topCe.breakdown.breakout, topPe.breakdown.breakout),
        directionalOi: Math.max(topCe.breakdown.directionalOi, topPe.breakdown.directionalOi),
        momentum: Math.round((topCe.breakdown.momentum + topPe.breakdown.momentum) / 2),
        pcrShift: Math.round((topCe.breakdown.pcrShift + topPe.breakdown.pcrShift) / 2),
        riskReward: Math.round((topCe.breakdown.riskReward + topPe.breakdown.riskReward) / 2),
      };
      recommendations.push({
        type: OptionSetup.BuyStrangle,
        strikes: [topCe.strike, topPe.strike],
        score: strangleScore,
        pattern: getBuyDominantPattern(mergedBreakdown),
        reasons: [...new Set([...topCe.reasons, ...topPe.reasons])],
        breakdown: mergedBreakdown,
        premium: topCe.premium + topPe.premium,
      });
    }
  }

  return recommendations.sort((a, b) => b.score - a.score).slice(0, 5);
}
