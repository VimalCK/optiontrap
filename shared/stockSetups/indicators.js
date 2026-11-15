// @ts-check
/**
 * @typedef {import('../stockSetups.js').Candle} Candle
 * @typedef {import('../stockSetups.js').Indicators} Indicators
 */

/** Mean of the last `n` values ending before index `end`, or null without enough data. */
function sma(/** @type {number[]} */ values, /** @type {number} */ n, end = values.length) {
  if (end < n) return null;
  let sum = 0;
  for (let i = end - n; i < end; i++) sum += values[i];
  return sum / n;
}

/**
 * Wilder's average true range over `n` sessions, ending at the last candle.
 * @param {Candle[]} candles
 */
export function averageTrueRange(candles, n = 14) {
  if (candles.length < n + 1) return null;
  /** @type {number[]} */
  const ranges = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    ranges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  let atr = ranges.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < ranges.length; i++) atr = (atr * (n - 1) + ranges[i]) / n;
  return atr;
}

/** Wilder's RSI over `n` sessions. 100 when there were no down closes. */
export function relativeStrengthIndex(/** @type {number[]} */ closes, n = 14) {
  if (closes.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gain += change;
    else loss -= change;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(change, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-change, 0)) / n;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

/** @param {Candle[]} candles @returns {Indicators} */
export function indicatorsOf(candles) {
  const closes = candles.map((c) => c.close);
  return {
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    atr: averageTrueRange(candles),
    rsi: relativeStrengthIndex(closes.slice(-150)),
    avgVolume20: sma(candles.map((c) => c.volume), 20),
  };
}
