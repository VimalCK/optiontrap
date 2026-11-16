/**
 * Scored option sell recommendations behind the Option Analyzer's Strategy card.
 * Shared, so the card (browser) and the setups strategy
 * (server/tradeEngine/strategies/optionAnalyzerSetups.js) score a chain the same way.
 *
 * A side is only sold when spot isn't trending against it. Each strike is then
 * scored on what makes that strike good to sell: its probability of profit, a
 * wall protecting it, sellers building at it, the premium it pays, and whether
 * the day's regime (pinning or a PCR bias) favours it.
 */

import { analyzeVelocityPattern } from './velocityPattern.js';
import { OptionType } from '../tradeEnums.js';
import { LevelSide, OiSignal, OptionSetup, SetupPattern, VelocityTrend } from '../analysisEnums.js';
import { calculateMaxPain, calculatePCR, findOiWalls, classifyOiSignal } from './oiLevels.js';
import { TREND_AGAINST_SHARE, atmStraddle, optionChange, rangePop, recentSpotMove, strikeGap, volumeMultiplier } from './setupScoring.js';

/** Each part's maximum points; they add up to 100. */
export const SELL_SCORE_MAX = Object.freeze({
  probability: 30,
  oiWall: 25,
  velocity: 20,
  premiumValue: 15,
  regime: 10,
});

const PINNING_MAX = 25;
const PCR_EXTREME_MAX = 15;

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
 * @property {number} probability 0–30
 * @property {number} oiWall 0–25
 * @property {number} velocity 0–20
 * @property {number} premiumValue 0–15
 * @property {number} regime 0–10
 */

/**
 * @typedef {object} SellRecommendation
 * @property {SellType} type
 * @property {number[]} strikes 1 for CE/PE, 1 for straddle, 2 for strangle [CE, PE]
 * @property {number} score 0–100
 * @property {import('../analysisEnums.js').SetupPatternId} pattern dominant pattern
 * @property {string[]} reasons
 * @property {ScoreBreakdown} breakdown
 * @property {number} pop Probability of Profit (1–99)
 * @property {number} premium Premium amount (per unit)
 */

/** @typedef {{ score: number, reasons: string[] }} PartScore */

/**
 * Pinning (0–25): spot hovering near max pain across snapshots, with a
 * balanced PCR (sellers defending both sides).
 * @param {OiSnapshot[]} snapshots
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {number} spotPrice
 * @returns {PartScore}
 */
function scorePinning(snapshots, chain, oiData, spotPrice) {
  /** @type {string[]} */ const reasons = [];
  let score = 0;

  const maxPain = calculateMaxPain(chain, oiData);
  if (maxPain === 0) return { score: 0, reasons };

  const distFromMaxPain = Math.abs(spotPrice - maxPain);
  const gap = strikeGap(chain);

  let pinnedCount = 0;
  for (const snap of snapshots) {
    if (snap.spot && snap.spot > 0 && Math.abs(snap.spot - maxPain) <= gap) pinnedCount++;
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

  return { score: Math.min(PINNING_MAX, score), reasons };
}

/**
 * PCR extreme (0–15): a sustained PCR that favours selling this side.
 * @param {OiSnapshot[]} snapshots
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @returns {PartScore}
 */
function scorePcrExtreme(snapshots, chain, oiData, type) {
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

  // Selling calls: a low PCR (bearish bias) is favourable; selling puts: a high one.
  const isFavourable = type === OptionType.CE
    ? (/** @type {number} */ pcr) => pcr < 0.6
    : (/** @type {number} */ pcr) => pcr > 1.8;

  let consecutive = 0;
  for (let i = pcrHistory.length - 1; i >= 0; i--) {
    if (isFavourable(pcrHistory[i])) consecutive++;
    else break;
  }

  const bias = type === OptionType.CE ? 'bearish' : 'bullish';
  let score = 0;
  if (consecutive >= 3) {
    score = 15;
    reasons.push(`PCR extreme (${currentPcr.toFixed(2)}) sustained for ${consecutive * 10}+ min — strong ${bias} bias`);
  } else if (consecutive >= 2) {
    score = 10;
    reasons.push(`PCR extreme (${currentPcr.toFixed(2)}) for ${consecutive * 10}+ min — ${bias} bias building`);
  } else if (consecutive >= 1) {
    score = 5;
    reasons.push(`PCR trending ${type === OptionType.CE ? 'low' : 'high'} (${currentPcr.toFixed(2)}) — early ${bias} signal`);
  }

  return { score: Math.min(PCR_EXTREME_MAX, score), reasons };
}

/**
 * Regime (0–10): the day favours selling this side, through pinning or a PCR
 * bias, whichever is stronger. Its pattern names the one that counted.
 * @param {PartScore} pinning
 * @param {PartScore} pcrExtreme
 * @returns {PartScore & { pattern: import('../analysisEnums.js').SetupPatternId }}
 */
function scoreRegime(pinning, pcrExtreme) {
  const pinningShare = pinning.score / PINNING_MAX;
  const pcrShare = pcrExtreme.score / PCR_EXTREME_MAX;
  const [share, part, pattern] = pinningShare >= pcrShare
    ? [pinningShare, pinning, SetupPattern.Pinning]
    : [pcrShare, pcrExtreme, SetupPattern.PcrExtreme];
  return { score: Math.round(SELL_SCORE_MAX.regime * share), reasons: part.reasons, pattern };
}

/**
 * Whether spot moved against this side over the last 30 minutes by more than
 * a quarter of the expected move: rising for a sold call, falling for a sold put.
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @param {OiSnapshot[]} snapshots
 * @param {number} spotPrice
 * @param {number} expectedMove
 * @returns {boolean}
 */
export function trendsAgainst(type, snapshots, spotPrice, expectedMove) {
  if (expectedMove <= 0) return false;
  const move = recentSpotMove(snapshots, spotPrice);
  const limit = TREND_AGAINST_SHARE * expectedMove;
  return type === OptionType.CE ? move > limit : move < -limit;
}

/**
 * Probability of profit (1–99) of selling one option and holding it to
 * expiry: the chance spot ends on the safe side of its breakeven (strike plus
 * the premium for a call, minus it for a put), with the move to expiry
 * normally distributed and its standard deviation taken from the ATM straddle.
 * @param {number} strike
 * @param {number} premium
 * @param {number} spotPrice
 * @param {number} expectedMove ATM straddle premium
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @returns {number}
 */
export function sellPop(strike, premium, spotPrice, expectedMove, type) {
  if (type === OptionType.CE) return rangePop(-Infinity, strike + premium, spotPrice, expectedMove);
  return rangePop(strike - premium, Infinity, spotPrice, expectedMove);
}

/**
 * Probability (0–30): POP above a coin flip, in proportion. 50% scores 0, 100% scores 30.
 * @param {number} pop
 * @returns {PartScore}
 */
function scoreProbability(pop) {
  const share = Math.min(1, Math.max(0, (pop - 50) / 50));
  const score = Math.round(SELL_SCORE_MAX.probability * share);
  return { score, reasons: score > 0 ? [`POP ${pop.toFixed(0)}% from the breakeven`] : [] };
}

/**
 * Premium value (0–15): what the strike pays against the ATM option's
 * premium (half the straddle), so a far strike paying almost nothing for its
 * high POP isn't favoured.
 * @param {number} premium
 * @param {number} expectedMove ATM straddle premium
 * @returns {PartScore}
 */
function scorePremiumValue(premium, expectedMove) {
  if (expectedMove <= 0 || premium <= 0) return { score: 0, reasons: [] };
  const share = premium / (expectedMove / 2);
  const percent = `${(share * 100).toFixed(0)}% of the ATM premium`;
  if (share >= 0.5) return { score: 15, reasons: [`Rich premium ₹${premium.toFixed(2)} (${percent})`] };
  if (share >= 0.3) return { score: 10, reasons: [`Good premium ₹${premium.toFixed(2)} (${percent})`] };
  if (share >= 0.15) return { score: 5, reasons: [`Thin premium ₹${premium.toFixed(2)} (${percent})`] };
  return { score: 0, reasons: [] };
}

/**
 * OI wall (0–25): the strongest wall between spot and the strike, the side
 * that protects a seller: resistance above spot and at or below a sold call's
 * strike, support below spot and at or above a sold put's. Points for its
 * strength, and more when fresh short buildup confirms sellers are adding.
 * @param {number} strike
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {OiSnapshot[]} snapshots
 * @param {Map<number, number>} livePrices
 * @param {number} spotPrice
 * @param {Map<number, number>} volumeData
 * @param {number} avgVolume
 * @returns {PartScore}
 */
function scoreOiWall(strike, type, chain, oiData, snapshots, livePrices, spotPrice, volumeData, avgVolume) {
  /** @type {string[]} */ const reasons = [];
  let score = 0;

  const wallType = type === OptionType.CE ? LevelSide.Resistance : LevelSide.Support;
  const protects = type === OptionType.CE
    ? (/** @type {number} */ wallStrike) => wallStrike > spotPrice && wallStrike <= strike
    : (/** @type {number} */ wallStrike) => wallStrike < spotPrice && wallStrike >= strike;
  const bestWall = findOiWalls(chain, oiData, 1.3)
    .filter((w) => w.type === wallType && protects(w.strike))
    .sort((a, b) => b.strength - a.strength)[0];

  if (!bestWall) return { score: 0, reasons };

  const where = bestWall.strike === strike ? 'at the strike' : `before the strike`;
  if (bestWall.strength >= 2.0) {
    score += 15;
    reasons.push(`Strong ${wallType} wall at ${bestWall.strike}, ${where} (${bestWall.strength.toFixed(1)}x avg OI)`);
  } else if (bestWall.strength >= 1.5) {
    score += 10;
    reasons.push(`${wallType} wall at ${bestWall.strike}, ${where} (${bestWall.strength.toFixed(1)}x avg OI)`);
  } else {
    score += 5;
    reasons.push(`Mild ${wallType} at ${bestWall.strike}, ${where} (${bestWall.strength.toFixed(1)}x avg OI)`);
  }

  const wallRow = chain.find((r) => r.strike === bestWall.strike);
  const wallToken = type === OptionType.CE ? wallRow?.ce?.instrumentToken : wallRow?.pe?.instrumentToken;

  const volMul = volumeMultiplier(wallToken, volumeData, avgVolume);
  if (volMul >= 1.3) {
    reasons.push('Wall built on high volume — strong institutional defense');
  } else if (volMul <= 0.6) {
    score = Math.round(score * 0.6);
    reasons.push('Wall on thin volume — may break easily');
  }

  if (wallToken && snapshots.length > 0) {
    const change = optionChange(wallToken, snapshots[0], oiData, livePrices);
    if (change && change.oiPct > 0 && classifyOiSignal(change.oiPct, change.pricePct).signal === OiSignal.ShortBuildup) {
      score += 10;
      reasons.push(`Short buildup confirmed at wall — new sellers entering (OI +${change.oiPct.toFixed(1)}%)`);
    }
  }

  return { score: Math.min(SELL_SCORE_MAX.oiWall, score), reasons };
}

/**
 * Velocity (0–20): sellers building at this strike through the day. OI rising
 * while the option's price rises is buyers (long buildup), not sellers, and scores nothing.
 * @param {number} token
 * @param {number} currentOi
 * @param {OiSnapshot[]} snapshots
 * @param {Map<number, number>} oiData
 * @param {Map<number, number>} livePrices
 * @param {Map<number, number>} volumeData
 * @param {number} avgVolume
 * @returns {PartScore}
 */
function scoreVelocity(token, currentOi, snapshots, oiData, livePrices, volumeData, avgVolume) {
  if (currentOi <= 0 || snapshots.length < 2) return { score: 0, reasons: [] };

  /** @type {string[]} */ const reasons = [];
  const pattern = analyzeVelocityPattern(token, currentOi, snapshots);
  if (!pattern) return { score: 0, reasons };

  const { trend } = pattern;
  if (UNWIND_TRENDS.includes(trend)) return { score: 0, reasons };

  if (trend !== VelocityTrend.Stable && trend !== VelocityTrend.Volatile) {
    const change = optionChange(token, snapshots[0], oiData, livePrices);
    if (change && classifyOiSignal(change.oiPct, change.pricePct).signal === OiSignal.LongBuildup) return { score: 0, reasons };
  }

  let score = 0;
  if (trend === VelocityTrend.AcceleratingBuildup) {
    score = 20;
    reasons.push('Accelerating OI buildup — sellers adding aggressively');
  } else if (trend === VelocityTrend.SteadyBuildup) {
    score = 15;
    reasons.push('Steady OI buildup — consistent seller positioning');
  } else if (trend === VelocityTrend.Buildup || trend === VelocityTrend.MildBuildup || trend === VelocityTrend.SlowingBuildup) {
    score = 10;
    reasons.push('OI buildup detected — sellers are positioning');
  } else if (trend === VelocityTrend.Stable) {
    score = 5;
    reasons.push('OI stable — no exit pressure from sellers');
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

  return { score: Math.min(SELL_SCORE_MAX.velocity, score), reasons };
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

/** @param {ScoreBreakdown} breakdown */
const totalOf = (breakdown) => breakdown.probability + breakdown.oiWall + breakdown.velocity + breakdown.premiumValue + breakdown.regime;

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
 * @param {number} [_daysToExpiry]  time to expiry is already in the ATM straddle the POP reads
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
  _daysToExpiry,
  atmStrike,
  volumeData = new Map(),
  avgVolume = 0,
) {
  if (chain.length === 0 || spotPrice === 0 || snapshots.length < 2) return [];

  const expectedMove = atmStraddle(chain, atmStrike, livePrices);

  const pinningResult = scorePinning(snapshots, chain, oiData, spotPrice);
  const regimeByType = {
    [OptionType.CE]: scoreRegime(pinningResult, scorePcrExtreme(snapshots, chain, oiData, OptionType.CE)),
    [OptionType.PE]: scoreRegime(pinningResult, scorePcrExtreme(snapshots, chain, oiData, OptionType.PE)),
  };
  const sellable = {
    [OptionType.CE]: !trendsAgainst(OptionType.CE, snapshots, spotPrice, expectedMove),
    [OptionType.PE]: !trendsAgainst(OptionType.PE, snapshots, spotPrice, expectedMove),
  };

  /**
   * @param {number} strike
   * @param {import('./chain.js').ChainOption} option
   * @param {import('../tradeEnums.js').OptionTypeId} type
   * @returns {StrikeScore | null}
   */
  function scoreStrike(strike, option, type) {
    const token = option.instrumentToken;
    const currentOi = oiData.get(token) || 0;
    const premium = livePrices.get(token) || 0;
    if (premium <= 0 || currentOi <= 0) return null;

    const pop = sellPop(strike, premium, spotPrice, expectedMove, type);
    const probability = scoreProbability(pop);
    const wall = scoreOiWall(strike, type, chain, oiData, snapshots, livePrices, spotPrice, volumeData, avgVolume);
    const velocity = scoreVelocity(token, currentOi, snapshots, oiData, livePrices, volumeData, avgVolume);
    const premiumValue = scorePremiumValue(premium, expectedMove);
    const regime = regimeByType[type];

    /** @type {ScoreBreakdown} */ const breakdown = {
      probability: probability.score,
      oiWall: wall.score,
      velocity: velocity.score,
      premiumValue: premiumValue.score,
      regime: regime.score,
    };
    return {
      strike,
      type,
      score: totalOf(breakdown),
      pattern: getDominantPattern(breakdown, regime.pattern),
      reasons: [...probability.reasons, ...wall.reasons, ...velocity.reasons, ...premiumValue.reasons, ...regime.reasons],
      breakdown,
      pop,
      premium,
    };
  }

  /** @type {StrikeScore[]} */ const strikeScores = [];
  for (const row of chain) {
    if (row.ce && row.strike > spotPrice && sellable[OptionType.CE]) {
      const scored = scoreStrike(row.strike, row.ce, OptionType.CE);
      if (scored) strikeScores.push(scored);
    }
    if (row.pe && row.strike < spotPrice && sellable[OptionType.PE]) {
      const scored = scoreStrike(row.strike, row.pe, OptionType.PE);
      if (scored) strikeScores.push(scored);
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
  const gap = strikeGap(chain);

  for (const ce of ceScores) {
    const pe = peScores.find((p) => p.strike === ce.strike);
    if (pe && Math.abs(ce.strike - spotPrice) <= gap) {
      const premium = ce.premium + pe.premium;
      const pop = rangePop(ce.strike - premium, ce.strike + premium, spotPrice, expectedMove);
      /** @type {ScoreBreakdown} */ const mergedBreakdown = {
        probability: scoreProbability(pop).score,
        oiWall: Math.min(ce.breakdown.oiWall, pe.breakdown.oiWall),
        velocity: Math.min(ce.breakdown.velocity, pe.breakdown.velocity),
        premiumValue: Math.min(ce.breakdown.premiumValue, pe.breakdown.premiumValue),
        regime: Math.min(ce.breakdown.regime, pe.breakdown.regime),
      };
      const straddleScore = totalOf(mergedBreakdown);
      if (straddleScore >= 40) {
        recommendations.push({
          type: OptionSetup.SellStraddle,
          strikes: [ce.strike],
          score: straddleScore,
          pattern: getDominantPattern(mergedBreakdown, regimeByType[OptionType.CE].pattern),
          reasons: [...new Set([...ce.reasons, ...pe.reasons])],
          breakdown: mergedBreakdown,
          pop,
          premium,
        });
      }
    }
  }

  const topCe = ceScores.filter((s) => s.score >= 40).sort((a, b) => b.score - a.score)[0];
  const topPe = peScores.filter((s) => s.score >= 40).sort((a, b) => b.score - a.score)[0];

  if (topCe && topPe && topCe.strike !== topPe.strike) {
    const premium = topCe.premium + topPe.premium;
    const pop = rangePop(topPe.strike - premium, topCe.strike + premium, spotPrice, expectedMove);
    /** @type {ScoreBreakdown} */ const mergedBreakdown = {
      probability: scoreProbability(pop).score,
      oiWall: Math.round((topCe.breakdown.oiWall + topPe.breakdown.oiWall) / 2),
      velocity: Math.round((topCe.breakdown.velocity + topPe.breakdown.velocity) / 2),
      premiumValue: Math.round((topCe.breakdown.premiumValue + topPe.breakdown.premiumValue) / 2),
      regime: Math.round((topCe.breakdown.regime + topPe.breakdown.regime) / 2),
    };
    const strangleScore = totalOf(mergedBreakdown);
    if (strangleScore >= 40) {
      recommendations.push({
        type: OptionSetup.SellStrangle,
        strikes: [topCe.strike, topPe.strike],
        score: strangleScore,
        pattern: getDominantPattern(mergedBreakdown, regimeByType[OptionType.CE].pattern),
        reasons: [...new Set([...topCe.reasons, ...topPe.reasons])],
        breakdown: mergedBreakdown,
        pop,
        premium,
      });
    }
  }

  return recommendations.sort((a, b) => b.score - a.score).slice(0, 5);
}

/**
 * The part that contributed the most, as a share of its own maximum.
 * @param {ScoreBreakdown} breakdown
 * @param {import('../analysisEnums.js').SetupPatternId} regimePattern  pinning or PCR extreme, whichever the regime came from
 * @returns {import('../analysisEnums.js').SetupPatternId}
 */
function getDominantPattern(breakdown, regimePattern) {
  /** @type {[import('../analysisEnums.js').SetupPatternId, number][]} */ const entries = [
    [SetupPattern.HighProbability, breakdown.probability / SELL_SCORE_MAX.probability],
    [SetupPattern.WallDefense, breakdown.oiWall / SELL_SCORE_MAX.oiWall],
    [SetupPattern.VelocityConfirmed, breakdown.velocity / SELL_SCORE_MAX.velocity],
    [SetupPattern.PremiumValue, breakdown.premiumValue / SELL_SCORE_MAX.premiumValue],
    [regimePattern, breakdown.regime / SELL_SCORE_MAX.regime],
  ];

  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][1] > 0 ? entries[0][0] : SetupPattern.Mixed;
}
