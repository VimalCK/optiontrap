/**
 * Scored option buy recommendations behind the Option Analyzer's Strategy card.
 * Shared, so the card (browser) and the setups strategy
 * (server/tradeEngine/strategies/optionAnalyzerSetups.js) score a chain the same way.
 *
 * A side is only bought with a sign of its move (spot already moving its way,
 * or buyers entering it) and spot not trending against it. Each strike is
 * then scored on its probability of profit, spot's move in its favour, the OI
 * flow behind its direction, whether a wall blocks its path to breakeven, and
 * what its premium costs against the ATM option.
 */

import { OptionType } from '../tradeEnums.js';
import { LevelSide, OiSignal, OptionSetup, SetupPattern } from '../analysisEnums.js';
import { calculatePCR, findOiWalls, classifyOiSignal } from './oiLevels.js';
import { TREND_AGAINST_SHARE, atmStraddle, optionChange, rangePop, recentSpotMove, strikeGap, volumeMultiplier } from './setupScoring.js';

/** Each part's maximum points; they add up to 100. */
export const BUY_SCORE_MAX = Object.freeze({
  probability: 25,
  trend: 20,
  flow: 25,
  breakout: 15,
  premiumCost: 15,
});

/** How many strike gaps either side of spot the OI flow reads. */
const FLOW_STRIKE_GAPS = 4;

/**
 * @typedef {import('./chain.js').ChainRow} ChainRow
 * @typedef {import('./velocityPattern.js').OiSnapshot} OiSnapshot
 */

/**
 * @typedef {typeof OptionSetup.BuyCe | typeof OptionSetup.BuyPe | typeof OptionSetup.BuyStraddle | typeof OptionSetup.BuyStrangle} BuyType
 */

/**
 * @typedef {object} BuyScoreBreakdown
 * @property {number} probability 0–25
 * @property {number} trend 0–20
 * @property {number} flow 0–25
 * @property {number} breakout 0–15
 * @property {number} premiumCost 0–15
 */

/**
 * @typedef {object} BuyRecommendation
 * @property {BuyType} type
 * @property {number[]} strikes
 * @property {number} score
 * @property {import('../analysisEnums.js').SetupPatternId} pattern
 * @property {string[]} reasons
 * @property {BuyScoreBreakdown} breakdown
 * @property {number} pop Probability of Profit (1–99)
 * @property {number} premium
 */

/** @typedef {{ score: number, reasons: string[] }} PartScore */

/** @param {import('../tradeEnums.js').OptionTypeId} type */
const opposite = (type) => (type === OptionType.CE ? OptionType.PE : OptionType.CE);

/**
 * @param {ChainRow} row
 * @param {import('../tradeEnums.js').OptionTypeId} type
 */
const tokenOf = (row, type) => (type === OptionType.CE ? row.ce?.instrumentToken : row.pe?.instrumentToken);

/**
 * Probability of profit (1–99) of buying one option and holding it to expiry:
 * the chance spot ends beyond its breakeven (strike plus the premium for a
 * call, minus it for a put).
 * @param {number} strike
 * @param {number} premium
 * @param {number} spotPrice
 * @param {number} expectedMove ATM straddle premium
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @returns {number}
 */
export function buyPop(strike, premium, spotPrice, expectedMove, type) {
  if (type === OptionType.CE) return rangePop(strike + premium, Infinity, spotPrice, expectedMove);
  return rangePop(-Infinity, strike - premium, spotPrice, expectedMove);
}

/**
 * Spot's move over the last 30 minutes in the bought side's favour, as a
 * share of the expected move: up for a call, down for a put. 0 without an expected move.
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @param {OiSnapshot[]} snapshots
 * @param {number} spotPrice
 * @param {number} expectedMove
 * @returns {number}
 */
export function moveInFavour(type, snapshots, spotPrice, expectedMove) {
  if (expectedMove <= 0) return 0;
  const share = recentSpotMove(snapshots, spotPrice) / expectedMove;
  return type === OptionType.CE ? share : -share;
}

/**
 * Probability (0–25): a bought option rarely wins more often than not, so
 * POP scores in proportion up to 50%, which gets the full 25.
 * @param {number} pop
 * @returns {PartScore}
 */
function scoreProbability(pop) {
  const score = Math.round(BUY_SCORE_MAX.probability * Math.min(1, pop / 50));
  return { score, reasons: [`POP ${pop.toFixed(0)}% from the breakeven`] };
}

/**
 * Trend (0–20): spot already moving the bought side's way over the last 30 minutes.
 * @param {number} share  move in favour, as a share of the expected move
 * @returns {PartScore}
 */
function scoreTrend(share) {
  const percent = `${(share * 100).toFixed(0)}% of the expected move in 30 min`;
  if (share >= 0.25) return { score: 20, reasons: [`Strong move in favour (${percent})`] };
  if (share >= 0.15) return { score: 14, reasons: [`Spot moving in favour (${percent})`] };
  if (share >= 0.05) return { score: 7, reasons: [`Early move in favour (${percent})`] };
  return { score: 0, reasons: [] };
}

/**
 * OI flow (0–25) behind the bought side's direction, the same for every strike on it:
 * - buyers entering this side near spot (long buildup), 0–10;
 * - the opposite side retreating: its writers adding as its price falls (short
 *   buildup) or its buyers leaving (long unwinding), 0–8;
 * - PCR moving this side's way (rising for calls, falling for puts), 0–7.
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {Map<number, number>} livePrices
 * @param {OiSnapshot[]} snapshots
 * @param {number} spotPrice
 * @returns {PartScore & { buyersEntering: boolean }}
 */
function scoreFlow(type, chain, oiData, livePrices, snapshots, spotPrice) {
  if (snapshots.length < 2) return { score: 0, reasons: [], buyersEntering: false };
  const reach = FLOW_STRIKE_GAPS * strikeGap(chain);
  const nearRows = chain.filter((r) => Math.abs(r.strike - spotPrice) <= reach);
  const buyers = longBuildupShare(type, nearRows, snapshots[0], oiData, livePrices);
  const parts = [buyers, oppositeRetreat(type, nearRows, snapshots[0], oiData, livePrices), pcrShift(type, chain, oiData, snapshots)];
  return {
    score: Math.min(BUY_SCORE_MAX.flow, parts.reduce((sum, part) => sum + part.score, 0)),
    reasons: parts.flatMap((part) => part.reasons),
    buyersEntering: buyers.score > 0,
  };
}

/**
 * The OI signals of one side's options near spot since the first snapshot.
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @param {ChainRow[]} rows
 * @param {OiSnapshot} since
 * @param {Map<number, number>} oiData
 * @param {Map<number, number>} livePrices
 * @returns {import('../analysisEnums.js').OiSignalId[]}
 */
function signalsOf(type, rows, since, oiData, livePrices) {
  /** @type {import('../analysisEnums.js').OiSignalId[]} */ const signals = [];
  for (const row of rows) {
    const token = tokenOf(row, type);
    const change = token ? optionChange(token, since, oiData, livePrices) : null;
    if (change) signals.push(classifyOiSignal(change.oiPct, change.pricePct).signal);
  }
  return signals;
}

/**
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @param {ChainRow[]} rows
 * @param {OiSnapshot} since
 * @param {Map<number, number>} oiData
 * @param {Map<number, number>} livePrices
 * @returns {PartScore}
 */
function longBuildupShare(type, rows, since, oiData, livePrices) {
  const signals = signalsOf(type, rows, since, oiData, livePrices);
  if (signals.length === 0) return { score: 0, reasons: [] };
  const count = signals.filter((signal) => signal === OiSignal.LongBuildup).length;
  const ratio = count / signals.length;
  if (ratio >= 0.6) return { score: 10, reasons: [`Strong ${type} long buildup across ${count}/${signals.length} strikes — buyers entering aggressively`] };
  if (ratio >= 0.4) return { score: 7, reasons: [`${type} long buildup on ${count}/${signals.length} strikes — buyer conviction building`] };
  if (ratio >= 0.2) return { score: 4, reasons: [`Early ${type} long buildup on ${count} strikes`] };
  return { score: 0, reasons: [] };
}

/**
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @param {ChainRow[]} rows
 * @param {OiSnapshot} since
 * @param {Map<number, number>} oiData
 * @param {Map<number, number>} livePrices
 * @returns {PartScore}
 */
function oppositeRetreat(type, rows, since, oiData, livePrices) {
  const other = opposite(type);
  const signals = signalsOf(other, rows, since, oiData, livePrices);
  if (signals.length === 0) return { score: 0, reasons: [] };
  const count = signals.filter((signal) => signal === OiSignal.ShortBuildup || signal === OiSignal.LongUnwinding).length;
  if (count / signals.length < 0.3) return { score: 0, reasons: [] };
  return { score: 8, reasons: [`${other} writers adding or buyers leaving on ${count} strikes — opposite side retreating`] };
}

/**
 * @param {import('../tradeEnums.js').OptionTypeId} type
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {OiSnapshot[]} snapshots
 * @returns {PartScore}
 */
function pcrShift(type, chain, oiData, snapshots) {
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

  let intervals = 0;
  for (let i = 1; i < pcrHistory.length; i++) {
    const delta = pcrHistory[i] - pcrHistory[i - 1];
    if (type === OptionType.CE ? delta > 0.02 : delta < -0.02) intervals++;
  }

  const direction = type === OptionType.CE ? 'rising' : 'falling';
  if (intervals >= 3) return { score: 7, reasons: [`PCR ${direction} for ${intervals} intervals (${currentPcr.toFixed(2)})`] };
  if (intervals >= 2) return { score: 5, reasons: [`PCR ${direction} (${currentPcr.toFixed(2)})`] };
  if (intervals >= 1) return { score: 2, reasons: [`PCR starting to ${type === OptionType.CE ? 'rise' : 'fall'} (${currentPcr.toFixed(2)})`] };
  return { score: 0, reasons: [] };
}

/**
 * Breakout (0–15): whether a wall stands between spot and the strike's
 * breakeven, the path the option needs. A clear path scores 10; a wall there
 * that is cracking (its writers covering: OI falling while its price rises)
 * scores 15; a wall still holding scores nothing.
 * @param {number} breakeven
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
function scoreBreakout(breakeven, type, chain, oiData, snapshots, livePrices, spotPrice, volumeData, avgVolume) {
  const wallType = type === OptionType.CE ? LevelSide.Resistance : LevelSide.Support;
  const inPath = type === OptionType.CE
    ? (/** @type {number} */ strike) => strike > spotPrice && strike < breakeven
    : (/** @type {number} */ strike) => strike < spotPrice && strike > breakeven;
  const wall = findOiWalls(chain, oiData, 1.3)
    .filter((w) => w.type === wallType && inPath(w.strike))
    .sort((a, b) => b.strength - a.strength)[0];

  if (!wall) return { score: 10, reasons: [`No ${wallType} wall before the breakeven ${breakeven.toFixed(0)}`] };

  const row = chain.find((r) => r.strike === wall.strike);
  const token = row ? tokenOf(row, type) : undefined;
  const change = token && snapshots.length > 0 ? optionChange(token, snapshots[0], oiData, livePrices) : null;
  if (!token || !change || change.oiPct >= -5 || classifyOiSignal(change.oiPct, change.pricePct).signal !== OiSignal.ShortCovering) {
    return { score: 0, reasons: [] };
  }

  const reasons = [`${wallType} wall at ${wall.strike} cracking — writers covering (OI ${change.oiPct.toFixed(1)}%)`];
  const volMul = volumeMultiplier(token, volumeData, avgVolume);
  if (volMul <= 0.6) return { score: Math.round(BUY_SCORE_MAX.breakout * 0.7), reasons: [...reasons, 'Low volume breakout — could be a false break'] };
  if (volMul >= 1.3) reasons.push('Breakout on surge volume — high conviction');
  return { score: BUY_SCORE_MAX.breakout, reasons };
}

/**
 * Premium cost (0–15): the premium against the ATM option's (half the
 * straddle). Cheaper gives more leverage on the move; probability already
 * counts how much less likely a cheaper, further strike is to pay off.
 * @param {number} premium
 * @param {number} expectedMove ATM straddle premium
 * @returns {PartScore}
 */
function scorePremiumCost(premium, expectedMove) {
  if (expectedMove <= 0 || premium <= 0) return { score: 0, reasons: [] };
  const share = premium / (expectedMove / 2);
  const percent = `${(share * 100).toFixed(0)}% of the ATM premium`;
  if (share <= 0.6) return { score: 15, reasons: [`Low cost ₹${premium.toFixed(2)} (${percent})`] };
  if (share <= 0.85) return { score: 10, reasons: [`Moderate cost ₹${premium.toFixed(2)} (${percent})`] };
  if (share <= 1.1) return { score: 5, reasons: [`ATM cost ₹${premium.toFixed(2)} (${percent})`] };
  return { score: 0, reasons: [] };
}

/** @param {BuyScoreBreakdown} breakdown */
const totalOf = (breakdown) => breakdown.probability + breakdown.trend + breakdown.flow + breakdown.breakout + breakdown.premiumCost;

/**
 * The part that contributed the most, as a share of its own maximum.
 * @param {BuyScoreBreakdown} breakdown
 * @returns {import('../analysisEnums.js').SetupPatternId}
 */
function getBuyDominantPattern(breakdown) {
  /** @type {[import('../analysisEnums.js').SetupPatternId, number][]} */ const entries = [
    [SetupPattern.HighProbability, breakdown.probability / BUY_SCORE_MAX.probability],
    [SetupPattern.Momentum, breakdown.trend / BUY_SCORE_MAX.trend],
    [SetupPattern.DirectionalOi, breakdown.flow / BUY_SCORE_MAX.flow],
    [SetupPattern.Breakout, breakdown.breakout / BUY_SCORE_MAX.breakout],
    [SetupPattern.RiskReward, breakdown.premiumCost / BUY_SCORE_MAX.premiumCost],
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
 * @property {number} pop
 * @property {number} premium
 */

/**
 * Compute buy recommendations for the visible option chain: ATM (up to one
 * strike in the money) and OTM strikes within 1.5 expected moves.
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
 * @param {number} [_daysToExpiry]  time to expiry is already in the ATM straddle the POP reads
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

  const expectedMove = atmStraddle(chain, atmStrike, livePrices);
  const gap = strikeGap(chain);

  const sideOf = (/** @type {import('../tradeEnums.js').OptionTypeId} */ type) => {
    const share = moveInFavour(type, snapshots, spotPrice, expectedMove);
    const trend = scoreTrend(share);
    const flow = scoreFlow(type, chain, oiData, livePrices, snapshots, spotPrice);
    const directionSeen = trend.score > 0 || flow.buyersEntering;
    return { buyable: directionSeen && share >= -TREND_AGAINST_SHARE, trend, flow };
  };
  const sides = { [OptionType.CE]: sideOf(OptionType.CE), [OptionType.PE]: sideOf(OptionType.PE) };

  /**
   * @param {number} strike
   * @param {number} token
   * @param {import('../tradeEnums.js').OptionTypeId} type
   * @returns {BuyStrikeScore | null}
   */
  function scoreStrike(strike, token, type) {
    const premium = livePrices.get(token) || 0;
    if (premium <= 0) return null;

    const pop = buyPop(strike, premium, spotPrice, expectedMove, type);
    const breakeven = type === OptionType.CE ? strike + premium : strike - premium;
    const probability = scoreProbability(pop);
    const { trend, flow } = sides[type];
    const breakout = scoreBreakout(breakeven, type, chain, oiData, snapshots, livePrices, spotPrice, volumeData, avgVolume);
    const premiumCost = scorePremiumCost(premium, expectedMove);

    /** @type {BuyScoreBreakdown} */ const breakdown = {
      probability: probability.score,
      trend: trend.score,
      flow: flow.score,
      breakout: breakout.score,
      premiumCost: premiumCost.score,
    };
    return {
      strike,
      type,
      score: totalOf(breakdown),
      pattern: getBuyDominantPattern(breakdown),
      reasons: [...probability.reasons, ...trend.reasons, ...flow.reasons, ...breakout.reasons, ...premiumCost.reasons],
      breakdown,
      pop,
      premium,
    };
  }

  const inRange = (/** @type {number} */ distance) => distance >= -gap && (expectedMove <= 0 || distance <= expectedMove * 1.5);

  /** @type {BuyStrikeScore[]} */ const strikeScores = [];
  for (const row of chain) {
    if (row.ce && sides[OptionType.CE].buyable && inRange(row.strike - spotPrice)) {
      const scored = scoreStrike(row.strike, row.ce.instrumentToken, OptionType.CE);
      if (scored) strikeScores.push(scored);
    }
    if (row.pe && sides[OptionType.PE].buyable && inRange(spotPrice - row.strike)) {
      const scored = scoreStrike(row.strike, row.pe.instrumentToken, OptionType.PE);
      if (scored) strikeScores.push(scored);
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
        pop: ss.pop,
        premium: ss.premium,
      });
    }
  }

  const ceScores = strikeScores.filter((s) => s.type === OptionType.CE);
  const peScores = strikeScores.filter((s) => s.type === OptionType.PE);

  /**
   * A two-leg buy pays off when spot ends outside both breakevens.
   * @param {BuyStrikeScore} ce
   * @param {BuyStrikeScore} pe
   * @param {typeof OptionSetup.BuyStraddle | typeof OptionSetup.BuyStrangle} type
   * @returns {BuyRecommendation}
   */
  function twoLegs(ce, pe, type) {
    const premium = ce.premium + pe.premium;
    const pop = Math.min(99, Math.max(1, 100 - rangePop(pe.strike - premium, ce.strike + premium, spotPrice, expectedMove)));
    /** @type {BuyScoreBreakdown} */ const breakdown = {
      probability: scoreProbability(pop).score,
      trend: Math.max(ce.breakdown.trend, pe.breakdown.trend),
      flow: Math.max(ce.breakdown.flow, pe.breakdown.flow),
      breakout: Math.round((ce.breakdown.breakout + pe.breakdown.breakout) / 2),
      premiumCost: Math.round((ce.breakdown.premiumCost + pe.breakdown.premiumCost) / 2),
    };
    return {
      type,
      strikes: type === OptionSetup.BuyStraddle ? [ce.strike] : [ce.strike, pe.strike],
      score: totalOf(breakdown),
      pattern: getBuyDominantPattern(breakdown),
      reasons: [...new Set([...ce.reasons, ...pe.reasons])],
      breakdown,
      pop,
      premium,
    };
  }

  for (const ce of ceScores) {
    const pe = peScores.find((p) => p.strike === ce.strike);
    if (pe && Math.abs(ce.strike - spotPrice) <= gap) {
      const straddle = twoLegs(ce, pe, OptionSetup.BuyStraddle);
      if (straddle.score >= 35) recommendations.push(straddle);
    }
  }

  const topCe = ceScores.filter((s) => s.score >= 35).sort((a, b) => b.score - a.score)[0];
  const topPe = peScores.filter((s) => s.score >= 35).sort((a, b) => b.score - a.score)[0];

  if (topCe && topPe && topCe.strike !== topPe.strike) {
    const strangle = twoLegs(topCe, topPe, OptionSetup.BuyStrangle);
    if (strangle.score >= 35) recommendations.push(strangle);
  }

  return recommendations.sort((a, b) => b.score - a.score).slice(0, 5);
}
