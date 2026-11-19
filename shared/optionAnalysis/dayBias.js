/**
 * Which way today's market leans, from today's snapshots: −1 (bearish) to +1
 * (bullish). The direction part of the Strategy card's score reads it, so a
 * setup on the side the day favours (a sold put or bought call on a rising
 * day) scores above one against it. Market data only.
 *
 * Four readings, each −1 to +1, weighted together:
 * - the day's move: spot now against the day's first snapshot, in day spreads;
 * - the last 30 minutes' move, in its own spread;
 * - OI flow near spot since the first snapshot: put OI added against call OI
 *   added (writers adding puts defend the downside, calls the upside);
 * - PCR now against the first snapshot's.
 */
import { calculatePCR } from './oiLevels.js';
import { recentSpotMove, strikeGap } from './setupScoring.js';
import { SESSION_MINUTES, daySpread } from './sessionOutcome.js';

/** A day's move of this many day spreads reads fully bullish or bearish. */
const DAY_MOVE_FULL = 0.5;
/** The recent move reads fully one way at one spread of its 30 minutes. */
const RECENT_MINUTES = 30;
/** A PCR change of this much since the first snapshot reads fully one way. */
const PCR_CHANGE_FULL = 0.3;
/** How many strike gaps either side of spot the OI flow reads. */
const FLOW_STRIKE_GAPS = 4;
/** Below this, either way, the day reads as neutral. */
const NEUTRAL_BIAS = 0.2;

const WEIGHTS = Object.freeze({ dayMove: 0.3, flow: 0.3, pcr: 0.2, recentMove: 0.2 });

/**
 * @typedef {import('./chain.js').ChainRow} ChainRow
 * @typedef {import('./velocityPattern.js').OiSnapshot} OiSnapshot
 * @typedef {{ bias: number, reasons: string[] }} DayBias
 */

/** @param {number} value */
const clampUnit = (value) => Math.min(1, Math.max(-1, value));

/** @param {number} value */
const lakhs = (value) => `${value >= 0 ? '+' : '−'}${(Math.abs(value) / 1e5).toFixed(1)}L`;

/** @param {number} value */
const signed = (value) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(0)}`;

/**
 * Total call and put OI of the chain in one OI record (token → OI).
 * @param {ChainRow[]} rows
 * @param {(token: number) => number} oiOf
 */
function sideTotals(rows, oiOf) {
  let ce = 0;
  let pe = 0;
  for (const row of rows) {
    if (row.ce) ce += oiOf(row.ce.instrumentToken);
    if (row.pe) pe += oiOf(row.pe.instrumentToken);
  }
  return { ce, pe };
}

/**
 * Today's lean, or 0 with no reasons before there are two snapshots and an expected move.
 * @param {ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {OiSnapshot[]} snapshots  today's, oldest first, with spot
 * @param {number} spotPrice
 * @param {number} expectedMove ATM straddle premium
 * @param {import('./sessionOutcome.js').SessionWindow} window
 * @returns {DayBias}
 */
export function dayBias(chain, oiData, snapshots, spotPrice, expectedMove, window) {
  const first = snapshots.find((snap) => (snap.spot ?? 0) > 0);
  const spread = daySpread(expectedMove, window);
  if (!first || snapshots.length < 2 || spread <= 0) return { bias: 0, reasons: [] };

  const dayMove = spotPrice - /** @type {number} */ (first.spot);
  const recentMove = recentSpotMove(snapshots, spotPrice);
  const recentSpread = spread * Math.sqrt(RECENT_MINUTES / SESSION_MINUTES);

  const reach = FLOW_STRIKE_GAPS * strikeGap(chain);
  const near = chain.filter((row) => Math.abs(row.strike - spotPrice) <= reach);
  const then = sideTotals(near, (token) => Number(first.data[String(token)] || 0));
  const now = sideTotals(near, (token) => oiData.get(token) || 0);
  const added = { ce: now.ce - then.ce, pe: now.pe - then.pe };
  const flowSize = Math.abs(added.ce) + Math.abs(added.pe);

  const firstTotals = sideTotals(chain, (token) => Number(first.data[String(token)] || 0));
  const firstPcr = firstTotals.ce > 0 ? firstTotals.pe / firstTotals.ce : 0;
  const pcr = calculatePCR(chain, oiData);

  const readings = {
    dayMove: clampUnit(dayMove / (DAY_MOVE_FULL * spread)),
    recentMove: clampUnit(recentMove / recentSpread),
    flow: flowSize > 0 ? (added.pe - added.ce) / flowSize : 0,
    pcr: firstPcr > 0 ? clampUnit((pcr - firstPcr) / PCR_CHANGE_FULL) : 0,
  };
  const bias = clampUnit(
    WEIGHTS.dayMove * readings.dayMove + WEIGHTS.recentMove * readings.recentMove
    + WEIGHTS.flow * readings.flow + WEIGHTS.pcr * readings.pcr,
  );

  const lean = Math.abs(bias) < NEUTRAL_BIAS ? 'neutral' : bias > 0 ? 'bullish' : 'bearish';
  return {
    bias,
    reasons: [
      `Day leans ${lean} (${bias >= 0 ? '+' : '−'}${Math.abs(bias).toFixed(2)}): spot ${signed(dayMove)} since ${first.timeLabel}, ${signed(recentMove)} in 30 min`,
      `Near spot: put OI ${lakhs(added.pe)}, call OI ${lakhs(added.ce)} · PCR ${firstPcr.toFixed(2)} → ${pcr.toFixed(2)}`,
    ],
  };
}

/**
 * The direction part of a setup's score (0–max): half for a neutral day, more
 * the more the day leans the trade's way, less against it.
 * @param {DayBias} day
 * @param {boolean} favoursRise  whether the trade gains as spot rises (a sold put, a bought call)
 * @param {number} max
 * @returns {{ score: number, reasons: string[] }}
 */
export function scoreDirection(day, favoursRise, max) {
  const aligned = favoursRise ? day.bias : -day.bias;
  return { score: Math.round(max * (0.5 + aligned / 2)), reasons: day.reasons };
}
