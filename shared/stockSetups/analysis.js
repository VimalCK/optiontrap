// @ts-check
import { LevelKind, LevelSide, StockState } from '../analysisEnums.js';
import { indicatorsOf } from './indicators.js';
import { mergeLevels, roundLevels, strengthOf, swingLevels, volumeLevels, zoneHistory } from './zones.js';
import { marketCheck, stockState } from './stockState.js';
import { findSetups } from './findSetups.js';

/**
 * @typedef {import('../stockSetups.js').Candle} Candle
 * @typedef {import('../stockSetups.js').Level} Level
 * @typedef {import('../stockSetups.js').LevelSideId} LevelSideId
 * @typedef {import('../stockSetups.js').StockAnalysis} StockAnalysis
 * @typedef {import('../stockSetups.js').StockStateId} StockStateId
 * @typedef {import('../stockSetups.js').Zone} Zone
 */

/** Candles needed before any analysis: a 50-day average plus room to find swings. */
export const MIN_CANDLES = 60;
const MAX_ZONES_PER_SIDE = 3;

/**
 * Full analysis for one stock. `price` is the live price; without it the last close is used.
 * Zones and setups always come from completed sessions.
 * @param {Candle[]} candles  oldest first
 * @param {{ price?: number, market?: Candle[] }} [options]
 * @returns {StockAnalysis | null}
 */
export function analyzeStock(candles, options = {}) {
  if (candles.length < MIN_CANDLES) return null;
  const last = candles[candles.length - 1];
  const price = options.price && options.price > 0 ? options.price : last.close;
  const ind = indicatorsOf(candles);
  const atr = ind.atr ?? last.close * 0.02;
  const tolerance = Math.max(0.5 * atr, 0.006 * price);

  /** @type {Level[]} */
  const levels = [...swingLevels(candles), ...volumeLevels(candles, Math.max(0.5 * atr, 0.005 * price)), ...roundLevels(price)];
  if (ind.sma50 !== null) levels.push({ price: ind.sma50, kind: LevelKind.Sma50, weight: 0.75 });
  if (ind.sma200 !== null) levels.push({ price: ind.sma200, kind: LevelKind.Sma200, weight: 1 });

  const merged = mergeLevels(levels, tolerance, atr);
  const history = candles.slice(0, -1);
  const movePct = Math.max(0.03, (2 * atr) / price);
  const failPct = Math.max(0.02, atr / price);
  /** @param {ReturnType<typeof mergeLevels>[number]} z @param {LevelSideId} side @returns {Zone} */
  const toZone = (z, side) => ({
    ...z,
    strength: strengthOf(z.score),
    side,
    distancePct: (z.mid / price - 1) * 100,
    history: zoneHistory(history, z, side, movePct, failPct),
  });

  // A zone containing the price counts as support: it is where a buyer would act now.
  const supports = merged.filter((z) => z.low <= price).sort((a, b) => b.mid - a.mid).slice(0, MAX_ZONES_PER_SIDE).map((z) => toZone(z, LevelSide.Support));
  const resistances = merged.filter((z) => z.low > price).sort((a, b) => a.mid - b.mid).slice(0, MAX_ZONES_PER_SIDE).map((z) => toZone(z, LevelSide.Resistance));

  const { state, note } = stockState(candles, ind);
  // Setups use the last close's view of support and resistance, not the live price.
  const closeSupports = price === last.close ? supports : merged.filter((z) => z.low <= last.close).sort((a, b) => b.mid - a.mid).slice(0, MAX_ZONES_PER_SIDE).map((z) => toZone(z, LevelSide.Support));
  const closeResistances = price === last.close ? resistances : merged.filter((z) => z.low > last.close).sort((a, b) => a.mid - b.mid).slice(0, MAX_ZONES_PER_SIDE).map((z) => toZone(z, LevelSide.Resistance));
  const setups = findSetups(candles, ind, state, closeSupports, closeResistances, merged.filter((z) => z.score >= 1.75));
  const market = options.market ? marketCheck(candles, options.market) : null;

  return {
    price,
    date: last.date,
    state,
    stateNote: note,
    indicators: ind,
    supports,
    resistances,
    market,
    setups,
    plan: planText(state, price, supports, resistances, atr, last),
  };
}

const rs = (/** @type {number} */ v) => `₹${v.toFixed(2)}`;

/**
 * A one-paragraph plan for when there's no setup today.
 * @param {StockStateId} state
 * @param {number} price
 * @param {Zone[]} supports
 * @param {Zone[]} resistances
 * @param {number} atr
 * @param {Candle} last
 */
function planText(state, price, supports, resistances, atr, last) {
  const zone = supports.find((z) => z.strength >= 2) ?? supports[0];
  const target = resistances[0];
  if (!zone) return 'No support zone below the price in the stored history: no level-based entry.';
  const stop = zone.low - 0.5 * atr;
  const where = zone.low <= price && price <= zone.high ? `Price is inside the ${rs(zone.low)}–${rs(zone.high)} zone` : `Next buy zone ${rs(zone.low)}–${rs(zone.high)} (${zone.distancePct.toFixed(1)}%)`;
  const held = zone.history.tests ? `, held ${zone.history.held} of ${zone.history.tests} past tests` : '';
  const exit = target ? ` First resistance ${rs(target.low)}.` : '';
  if (state === StockState.Falling || state === StockState.Stretched) {
    return `${where}${held}. Wait: buy only after a daily close above the previous session's high near the zone; stop below ${rs(stop)}.${exit}`;
  }
  if (state === StockState.Turning) {
    return `${where}${held}. The fall is pausing: a buy above ${rs(last.high)} with a stop below ${rs(stop)} has a defined risk.${exit}`;
  }
  return `${where}${held}. Buy dips into the zone that close strong; stop below ${rs(stop)}.${exit}`;
}

/**
 * @param {StockAnalysis} analysis
 */
export function scanSummary(analysis) {
  const support = analysis.supports[0];
  const resistance = analysis.resistances[0];
  return {
    date: analysis.date,
    close: analysis.price,
    state: analysis.state,
    setups: analysis.setups.map((s) => ({ type: s.type, direction: s.direction, label: s.label, entry: s.entry, stop: s.stop, target: s.target, rewardRisk: s.rewardRisk })),
    support: support ? { low: support.low, high: support.high, strength: support.strength } : null,
    resistance: resistance ? { low: resistance.low, high: resistance.high, strength: resistance.strength } : null,
    market: analysis.market?.relation ?? null,
  };
}
