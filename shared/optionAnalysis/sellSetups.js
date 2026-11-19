/**
 * Scored option sell recommendations behind the Option Analyzer's Strategy card.
 * Shared, so the card (browser) and the setups strategy
 * (server/tradeEngine/strategies/optionAnalyzerSetups.js) score a chain the same way.
 *
 * A side is only sold when spot isn't trending against it, and a strike only
 * when it pays at least MIN_PREMIUM_SHARE of the ATM option's premium. Each
 * strike is then scored on the day's direction (dayBias.js), its chance of
 * being in profit at today's close (sessionOutcome.js), a wall protecting it,
 * sellers building at it, and whether the day is pinning or has a PCR bias.
 */

import { analyzeVelocityPattern } from './velocityPattern.js';
import { OptionType, Side } from '../tradeEnums.js';
import { LevelSide, OiSignal, OptionSetup, SetupPattern, VelocityTrend } from '../analysisEnums.js';
import { calculateMaxPain, calculatePCR, findOiWalls, classifyOiSignal } from './oiLevels.js';
import { MIN_PREMIUM_SHARE, TREND_AGAINST_SHARE, atmStraddle, optionChange, recentSpotMove, strikeGap, volumeMultiplier } from './setupScoring.js';
import { dayBias, scoreDirection } from './dayBias.js';
import { sessionOutcome, sessionWindow, winChanceShare } from './sessionOutcome.js';

/** Each part's maximum points; they add up to 100. */
export const SELL_SCORE_MAX = Object.freeze({
  direction: 40,
  today: 25,
  oiWall: 15,
  velocity: 10,
  regime: 10,
});

/** A sold option's chance of profit by the close earns no points at a coin flip, all of them at this. */
const FULL_WIN_CHANCE = 75;

const PINNING_MAX = 25;
const PCR_EXTREME_MAX = 15;
const VELOCITY_POINTS_MAX = 20;
/** A wall this many times the average OI earns its full strength points. */
const WALL_FULL_STRENGTH = 5;
/** Short buildup at the wall this large (OI % since the first snapshot) earns its full points. */
const WALL_FULL_BUILDUP_PCT = 100;
/** The wall part's split: its strength, then sellers adding at it. */
const WALL_STRENGTH_SHARE = 0.6;
/** What a wall built on thin volume keeps of its points. */
const THIN_VOLUME_KEEPS = 0.6;
/** findOiWalls' threshold: OI this many times the average marks a wall. */
const WALL_THRESHOLD = 1.3;

/** OI unwinding through the day: no reason to sell. */
const UNWIND_TRENDS = /** @type {import('../analysisEnums.js').VelocityTrendId[]} */ ([
  VelocityTrend.AcceleratingUnwind, VelocityTrend.SteadyUnwind, VelocityTrend.SlowingUnwind, VelocityTrend.Unwinding, VelocityTrend.MildUnwind,
]);

/**
 * @typedef {import('./chain.js').ChainRow} ChainRow
 * @typedef {import('./velocityPattern.js').OiSnapshot} OiSnapshot
 * @typedef {{ now: Date, expiry: string }} SetupTiming  when the setups are scored, and the chain's expiry
 */

/**
 * @typedef {typeof OptionSetup.SellCe | typeof OptionSetup.SellPe | typeof OptionSetup.SellStraddle | typeof OptionSetup.SellStrangle} SellType
 */

/**
 * @typedef {object} ScoreBreakdown
 * @property {number} direction 0–40
 * @property {number} today 0–25
 * @property {number} oiWall 0–15
 * @property {number} velocity 0–10
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
 * @property {number} winChance chance (1–99) of being in profit at today's close, after charges
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
 * Today (0–25): the sold option's chance of being in profit at today's close,
 * after charges; a coin flip scores 0, FULL_WIN_CHANCE or more scores 25.
 * @param {import('./sessionOutcome.js').SessionOutcome | null} outcome
 * @returns {PartScore}
 */
function scoreToday(outcome) {
  if (!outcome) return { score: 0, reasons: [] };
  const sign = outcome.expectedPnl >= 0 ? '+' : '−';
  return {
    score: Math.round(SELL_SCORE_MAX.today * winChanceShare(outcome.winChance, 50, FULL_WIN_CHANCE)),
    reasons: [`${outcome.winChance.toFixed(0)}% chance of profit by today's close · expected ${sign}₹${Math.abs(outcome.expectedPnl).toFixed(2)} per unit after charges`],
  };
}

/**
 * OI wall (0–15): the strongest wall between spot and the strike, the side
 * that protects a seller: resistance above spot and at or below a sold call's
 * strike, support below spot and at or above a sold put's. Points grow with
 * its strength, and with fresh short buildup there (sellers adding).
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
  const wallType = type === OptionType.CE ? LevelSide.Resistance : LevelSide.Support;
  const protects = type === OptionType.CE
    ? (/** @type {number} */ wallStrike) => wallStrike > spotPrice && wallStrike <= strike
    : (/** @type {number} */ wallStrike) => wallStrike < spotPrice && wallStrike >= strike;
  const bestWall = findOiWalls(chain, oiData, WALL_THRESHOLD)
    .filter((w) => w.type === wallType && protects(w.strike))
    .sort((a, b) => b.strength - a.strength)[0];

  if (!bestWall) return { score: 0, reasons: [] };

  const where = bestWall.strike === strike ? 'at the strike' : 'before the strike';
  const reasons = [`${wallType} wall at ${bestWall.strike}, ${where} (${bestWall.strength.toFixed(1)}x avg OI)`];
  const strengthShare = Math.min(1, (bestWall.strength - WALL_THRESHOLD) / (WALL_FULL_STRENGTH - WALL_THRESHOLD));

  const wallRow = chain.find((r) => r.strike === bestWall.strike);
  const wallToken = type === OptionType.CE ? wallRow?.ce?.instrumentToken : wallRow?.pe?.instrumentToken;

  let buildupShare = 0;
  if (wallToken && snapshots.length > 0) {
    const change = optionChange(wallToken, snapshots[0], oiData, livePrices);
    if (change && change.oiPct > 0 && classifyOiSignal(change.oiPct, change.pricePct).signal === OiSignal.ShortBuildup) {
      buildupShare = Math.min(1, change.oiPct / WALL_FULL_BUILDUP_PCT);
      reasons.push(`Short buildup at the wall — sellers adding (OI +${change.oiPct.toFixed(1)}%)`);
    }
  }

  let points = SELL_SCORE_MAX.oiWall * (WALL_STRENGTH_SHARE * strengthShare + (1 - WALL_STRENGTH_SHARE) * buildupShare);
  const volMul = volumeMultiplier(wallToken, volumeData, avgVolume);
  if (volMul >= 1.3) {
    reasons.push('Wall built on high volume — strong institutional defense');
  } else if (volMul <= 0.6) {
    points *= THIN_VOLUME_KEEPS;
    reasons.push('Wall on thin volume — may break easily');
  }

  return { score: Math.round(points), reasons };
}

/**
 * Velocity (0–10): sellers building at this strike through the day. OI rising
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

  let points = 0;
  if (trend === VelocityTrend.AcceleratingBuildup) {
    points = 20;
    reasons.push('Accelerating OI buildup — sellers adding aggressively');
  } else if (trend === VelocityTrend.SteadyBuildup) {
    points = 15;
    reasons.push('Steady OI buildup — consistent seller positioning');
  } else if (trend === VelocityTrend.Buildup || trend === VelocityTrend.MildBuildup || trend === VelocityTrend.SlowingBuildup) {
    points = 10;
    reasons.push('OI buildup detected — sellers are positioning');
  } else if (trend === VelocityTrend.Stable) {
    points = 5;
    reasons.push('OI stable — no exit pressure from sellers');
  } else if (trend === VelocityTrend.Volatile) {
    points = 2;
  }

  if (points > 0) {
    const volMul = volumeMultiplier(token, volumeData, avgVolume);
    points *= volMul;
    if (volMul >= 1.3) {
      reasons.push('Volume-confirmed buildup — high conviction');
    } else if (volMul <= 0.6) {
      reasons.push('Low volume — buildup may not hold');
    }
  }

  return { score: Math.round(SELL_SCORE_MAX.velocity * Math.min(1, points / VELOCITY_POINTS_MAX)), reasons };
}

/**
 * @typedef {object} StrikeScore
 * @property {number} strike
 * @property {import('../tradeEnums.js').OptionTypeId} type
 * @property {number} score
 * @property {import('../analysisEnums.js').SetupPatternId} pattern
 * @property {string[]} reasons
 * @property {ScoreBreakdown} breakdown
 * @property {number} winChance
 * @property {number} premium
 */

/** @param {ScoreBreakdown} breakdown */
const totalOf = (breakdown) => breakdown.direction + breakdown.today + breakdown.oiWall + breakdown.velocity + breakdown.regime;

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
 * @param {SetupTiming} timing
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
  timing,
  atmStrike,
  volumeData = new Map(),
  avgVolume = 0,
) {
  if (chain.length === 0 || spotPrice === 0 || snapshots.length < 2) return [];

  const expectedMove = atmStraddle(chain, atmStrike, livePrices);
  const minPremium = MIN_PREMIUM_SHARE * (expectedMove / 2);
  const window = sessionWindow(timing.now, timing.expiry);
  const day = dayBias(chain, oiData, snapshots, spotPrice, expectedMove, window);

  const pinningResult = scorePinning(snapshots, chain, oiData, spotPrice);
  const regimeByType = {
    [OptionType.CE]: scoreRegime(pinningResult, scorePcrExtreme(snapshots, chain, oiData, OptionType.CE)),
    [OptionType.PE]: scoreRegime(pinningResult, scorePcrExtreme(snapshots, chain, oiData, OptionType.PE)),
  };
  const directionByType = {
    [OptionType.CE]: scoreDirection(day, false, SELL_SCORE_MAX.direction),
    [OptionType.PE]: scoreDirection(day, true, SELL_SCORE_MAX.direction),
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
    if (premium <= 0 || currentOi <= 0 || premium < minPremium) return null;

    const outcome = sessionOutcome({ side: Side.SELL, optionType: type, strike, premium, lotSize: option.lotSize }, { spotPrice, expectedMove, window });
    const direction = directionByType[type];
    const today = scoreToday(outcome);
    const wall = scoreOiWall(strike, type, chain, oiData, snapshots, livePrices, spotPrice, volumeData, avgVolume);
    const velocity = scoreVelocity(token, currentOi, snapshots, oiData, livePrices, volumeData, avgVolume);
    const regime = regimeByType[type];

    /** @type {ScoreBreakdown} */ const breakdown = {
      direction: direction.score,
      today: today.score,
      oiWall: wall.score,
      velocity: velocity.score,
      regime: regime.score,
    };
    return {
      strike,
      type,
      score: totalOf(breakdown),
      pattern: getDominantPattern(breakdown, regime.pattern),
      reasons: [...direction.reasons, ...today.reasons, ...wall.reasons, ...velocity.reasons, ...regime.reasons],
      breakdown,
      winChance: outcome?.winChance ?? 50,
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
        winChance: ss.winChance,
        premium: ss.premium,
      });
    }
  }

  const ceScores = strikeScores.filter((s) => s.type === OptionType.CE);
  const peScores = strikeScores.filter((s) => s.type === OptionType.PE);
  const gap = strikeGap(chain);

  // Two sold legs: the day's lean helps one and hurts the other, so the direction part is the weaker leg's.
  for (const ce of ceScores) {
    const pe = peScores.find((p) => p.strike === ce.strike);
    if (pe && Math.abs(ce.strike - spotPrice) <= gap) {
      /** @type {ScoreBreakdown} */ const mergedBreakdown = {
        direction: Math.min(ce.breakdown.direction, pe.breakdown.direction),
        today: Math.min(ce.breakdown.today, pe.breakdown.today),
        oiWall: Math.min(ce.breakdown.oiWall, pe.breakdown.oiWall),
        velocity: Math.min(ce.breakdown.velocity, pe.breakdown.velocity),
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
          winChance: Math.min(ce.winChance, pe.winChance),
          premium: ce.premium + pe.premium,
        });
      }
    }
  }

  const topCe = ceScores.filter((s) => s.score >= 40).sort((a, b) => b.score - a.score)[0];
  const topPe = peScores.filter((s) => s.score >= 40).sort((a, b) => b.score - a.score)[0];

  if (topCe && topPe && topCe.strike !== topPe.strike) {
    /** @type {ScoreBreakdown} */ const mergedBreakdown = {
      direction: Math.min(topCe.breakdown.direction, topPe.breakdown.direction),
      today: Math.round((topCe.breakdown.today + topPe.breakdown.today) / 2),
      oiWall: Math.round((topCe.breakdown.oiWall + topPe.breakdown.oiWall) / 2),
      velocity: Math.round((topCe.breakdown.velocity + topPe.breakdown.velocity) / 2),
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
        winChance: Math.min(topCe.winChance, topPe.winChance),
        premium: topCe.premium + topPe.premium,
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
    [SetupPattern.DirectionalOi, breakdown.direction / SELL_SCORE_MAX.direction],
    [SetupPattern.HighProbability, breakdown.today / SELL_SCORE_MAX.today],
    [SetupPattern.WallDefense, breakdown.oiWall / SELL_SCORE_MAX.oiWall],
    [SetupPattern.VelocityConfirmed, breakdown.velocity / SELL_SCORE_MAX.velocity],
    [regimePattern, breakdown.regime / SELL_SCORE_MAX.regime],
  ];

  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][1] > 0 ? entries[0][0] : SetupPattern.Mixed;
}
