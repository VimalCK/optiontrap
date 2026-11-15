// @ts-check
import { Exchange, InstrumentType } from '../tradeEnums.js';

/**
 * @typedef {import('../stockSetups.js').Candle} Candle
 */

/**
 * Kite historical rows ([timestamp, open, high, low, close, volume, ...]) to candles,
 * oldest first, dropping malformed rows.
 * @param {unknown[][]} raw
 * @returns {Candle[]}
 */
export function parseKiteCandles(raw) {
  /** @type {Candle[]} */
  const candles = [];
  for (const row of raw || []) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [ts, open, high, low, close, volume] = row;
    if (typeof ts !== 'string' || ![open, high, low, close, volume].every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    candles.push({ date: ts.slice(0, 10), open: /** @type {number} */ (open), high: /** @type {number} */ (high), low: /** @type {number} */ (low), close: /** @type {number} */ (close), volume: /** @type {number} */ (volume) });
  }
  return candles.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * A watchlist instrument this feature covers: an NSE or BSE cash stock. Indices are
 * stored as NSE EQ too, but their names contain a space ("NIFTY 50") and stock symbols never do.
 * @param {{ exchange: string, tradingsymbol: string, instrumentType?: string }} instrument
 */
export function isCashStock(instrument) {
  return (instrument.exchange === Exchange.NSE || instrument.exchange === Exchange.BSE)
    && (instrument.instrumentType === undefined || instrument.instrumentType === InstrumentType.EQ)
    && !/\s/.test(instrument.tradingsymbol);
}
