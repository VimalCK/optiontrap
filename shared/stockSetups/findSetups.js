// @ts-check
import { Side } from '../tradeEnums.js';
import { StockSetupType, StockState } from '../analysisEnums.js';

/**
 * @typedef {import('../stockSetups.js').Candle} Candle
 * @typedef {import('../stockSetups.js').Indicators} Indicators
 * @typedef {import('../stockSetups.js').Setup} Setup
 * @typedef {import('../stockSetups.js').StockSetupTypeId} StockSetupTypeId
 * @typedef {import('../stockSetups.js').StockStateId} StockStateId
 * @typedef {import('../stockSetups.js').Zone} Zone
 */

const BREAKOUT_VOLUME_RATIO = 1.5;
const MIN_REWARD_RISK = 1;

const SETUP_LABELS = /** @type {Record<StockSetupTypeId, string>} */ ({
  [StockSetupType.Pullback]: 'Pullback to support',
  [StockSetupType.Reversal]: 'Reversal at support',
  [StockSetupType.Breakout]: 'Breakout',
  [StockSetupType.Rejection]: 'Rejected at resistance',
  [StockSetupType.Breakdown]: 'Breakdown',
});

export function setupLabel(/** @type {StockSetupTypeId} */ type) {
  return SETUP_LABELS[type];
}

/**
 * @param {StockSetupTypeId} type
 * @param {Candle} last
 * @param {number} entry
 * @param {number} stop
 * @param {number} target
 * @param {{ low: number, high: number, mid: number }} zone
 * @param {string} note
 * @returns {Setup | null}
 */
function makeSetup(type, last, entry, stop, target, zone, note) {
  const direction = type === StockSetupType.Rejection || type === StockSetupType.Breakdown ? Side.SELL : Side.BUY;
  const risk = direction === Side.BUY ? entry - stop : stop - entry;
  const reward = direction === Side.BUY ? target - entry : entry - target;
  if (!(risk > 0) || !(reward > 0)) return null;
  const rewardRisk = reward / risk;
  if (rewardRisk < MIN_REWARD_RISK) return null;
  return { type, direction, label: SETUP_LABELS[type], date: last.date, entry, stop, target, rewardRisk, zone, note };
}

/**
 * Setups on the latest session. Buy setups are entries; sell setups are exits or
 * reasons to avoid, since cash stocks can't be shorted overnight.
 * @param {Candle[]} candles
 * @param {Indicators} ind
 * @param {StockStateId} state
 * @param {Zone[]} supports  nearest first
 * @param {Zone[]} resistances  nearest first
 * @param {{ low: number, high: number, mid: number }[]} allZones  every zone, for breakouts and breakdowns
 * @returns {Setup[]}
 */
export function findSetups(candles, ind, state, supports, resistances, allZones) {
  const atr = ind.atr;
  if (!atr) return [];
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const heavyVolume = ind.avgVolume20 !== null && last.volume >= BREAKOUT_VOLUME_RATIO * ind.avgVolume20;
  const support = supports[0];
  const resistance = resistances[0];
  const upTarget = (/** @type {number} */ entry, /** @type {number} */ stop) => resistance?.low ?? entry + 2 * (entry - stop);
  const downTarget = (/** @type {number} */ entry, /** @type {number} */ stop) => supports.find((s) => s.high < entry)?.high ?? entry - 2 * (stop - entry);
  /** @type {(Setup | null)[]} */
  const found = [];

  const longTrendUp = ind.sma200 !== null ? last.close > ind.sma200 : ind.sma50 !== null && last.close > ind.sma50;
  if (support && longTrendUp && last.low <= support.high && last.close >= support.low && last.close >= (last.high + last.low) / 2) {
    const stop = support.low - 0.5 * atr;
    found.push(makeSetup(StockSetupType.Pullback, last, last.close, stop, upTarget(last.close, stop), support, 'Dipped into support in an uptrend and closed in the upper half of the day.'));
  }

  if (state === StockState.Turning && support) {
    const recentLow = Math.min(...candles.slice(-5).map((c) => c.low));
    if (recentLow <= support.high + 0.25 * atr) {
      const stop = Math.min(recentLow, support.low) - 0.25 * atr;
      found.push(makeSetup(StockSetupType.Reversal, last, last.close, stop, upTarget(last.close, stop), support, 'Held a support zone and closed above the previous high.'));
    }
  }

  for (const zone of allZones) {
    if (heavyVolume && prev.close <= zone.high && last.close > zone.high) {
      const stop = zone.low - 0.25 * atr;
      const above = resistances.find((r) => r.low > last.close);
      found.push(makeSetup(StockSetupType.Breakout, last, last.close, stop, above?.low ?? last.close + 2 * (last.close - stop), zone, 'Closed above a resistance zone on heavy volume.'));
      break;
    }
  }
  for (const zone of [...allZones].reverse()) {
    if (heavyVolume && prev.close >= zone.low && last.close < zone.low) {
      const stop = zone.high + 0.25 * atr;
      const below = supports.find((s) => s.high < last.close);
      found.push(makeSetup(StockSetupType.Breakdown, last, last.close, stop, below?.high ?? last.close - 2 * (stop - last.close), zone, 'Closed below a support zone on heavy volume.'));
      break;
    }
  }

  if (resistance && last.high >= resistance.low && last.close < resistance.low && last.close < last.open && (ind.sma50 === null || last.close < ind.sma50)) {
    const stop = resistance.high + 0.5 * atr;
    found.push(makeSetup(StockSetupType.Rejection, last, last.close, stop, downTarget(last.close, stop), resistance, 'Rallied into resistance in a downtrend and closed lower.'));
  }

  return /** @type {Setup[]} */ (found.filter(Boolean));
}
