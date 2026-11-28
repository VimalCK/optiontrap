import { kiteClient } from './kiteClient.js';

/**
 * Kite's daily candles for an instrument from `from` to `to` ('YYYY-MM-DD', inclusive), with its OI when `oi`.
 * @param {{ apiKey: string, accessToken: string }} kite
 * @param {number} instrumentToken
 * @param {string} from
 * @param {string} to
 * @param {{ oi?: boolean, signal?: AbortSignal }} [options]
 * @returns {Promise<unknown[][] | undefined>} Kite's candle rows: [time, open, high, low, close, volume, oi?]
 */
export async function fetchDayCandles(kite, instrumentToken, from, to, { oi = false, signal } = {}) {
  const data = await kiteClient(kite).get(`/instruments/historical/${instrumentToken}/day?from=${from}&to=${to}${oi ? '&oi=1' : ''}`, { signal });
  return data?.candles;
}

/**
 * Kite's 1-minute candles for an instrument through one session ('YYYY-MM-DD'), with its OI when `oi`.
 * @param {{ apiKey: string, accessToken: string }} kite
 * @param {number} instrumentToken
 * @param {string} date
 * @param {{ oi?: boolean, signal?: AbortSignal }} [options]
 * @returns {Promise<unknown[][] | undefined>} Kite's candle rows: [time, open, high, low, close, volume, oi?]
 */
export async function fetchMinuteCandles(kite, instrumentToken, date, { oi = false, signal } = {}) {
  const data = await kiteClient(kite).get(`/instruments/historical/${instrumentToken}/minute?from=${date}+09:15:00&to=${date}+15:30:00${oi ? '&oi=1' : ''}`, { signal });
  return data?.candles;
}
