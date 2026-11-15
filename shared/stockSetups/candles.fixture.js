// @ts-check
// Candle builders for the stock setup tests.
import { LevelSide } from '../analysisEnums.js';

/** @typedef {import('../stockSetups.js').Candle} Candle */

/** Day `i` as an ISO date, counted from 2024-01-01. */
export const day = (/** @type {number} */ i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);

/**
 * Candles from a list of closes: each opens at the previous close, with a 1% range around the body.
 * @param {number[]} closes
 * @returns {Candle[]}
 */
export function fromCloses(closes, volume = 1000) {
  return closes.map((close, i) => {
    const open = i ? closes[i - 1] : close;
    return { date: day(i), open, high: Math.max(open, close) * 1.005, low: Math.min(open, close) * 0.995, close, volume };
  });
}

/**
 * Price swinging between `low` and `high` with the given period (a range-bound stock).
 * @param {number} count
 * @param {number} low
 * @param {number} high
 */
export function oscillate(count, low, high, period = 20) {
  return Array.from({ length: count }, (_, i) => low + ((high - low) * (1 - Math.cos((2 * Math.PI * i) / period))) / 2);
}

export const ind = (overrides = {}) => ({ sma20: null, sma50: null, sma200: null, atr: 2, rsi: 50, avgVolume20: 1000, ...overrides });
export const zone = (/** @type {number} */ low, /** @type {number} */ high, extra = {}) => ({ low, high, mid: (low + high) / 2, score: 2, strength: 2, reasons: [], side: LevelSide.Support, distancePct: 0, history: { tests: 0, held: 0, failed: 0, avgMovePct: null }, ...extra });
