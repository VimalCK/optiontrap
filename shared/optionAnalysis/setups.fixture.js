// Option chain markets for the Strategy card's setup tests.
import { OptionType } from '../tradeEnums.js';

/**
 * @typedef {import('./velocityPattern.js').OiSnapshot} OiSnapshot
 * @typedef {{ oiData: Map<number, number>, livePrices: Map<number, number> }} Market
 */

/** A chain around a 25000 ATM, 50 points apart, for the setup tests. */
export const STRIKES = [24800, 24850, 24900, 24950, 25000, 25050, 25100, 25150, 25200];
export const ceToken = (/** @type {number} */ strike) => 1000 + STRIKES.indexOf(strike);
export const peToken = (/** @type {number} */ strike) => 2000 + STRIKES.indexOf(strike);
export const chain = STRIKES.map((strike) => ({
  strike,
  ce: { instrumentToken: ceToken(strike), strike, expiry: null, instrumentType: OptionType.CE },
  pe: { instrumentToken: peToken(strike), strike, expiry: null, instrumentType: OptionType.PE },
}));

/** Premiums falling away from the 25000 ATM (100 each, so the expected move is 200). */
const premiumOf = (/** @type {number} */ strike) => Math.max(5, 100 - Math.abs(strike - 25000) * 0.8);

/**
 * A market with every option at 1000 OI and its premium, except the overrides.
 * @param {{ oi?: Record<number, number>, prices?: Record<number, number> }} [overrides]
 * @returns {Market}
 */
export function market({ oi = {}, prices = {} } = {}) {
  const oiData = /** @type {Map<number, number>} */ (new Map());
  const livePrices = /** @type {Map<number, number>} */ (new Map());
  for (const strike of STRIKES) {
    for (const token of [ceToken(strike), peToken(strike)]) {
      oiData.set(token, oi[token] ?? 1000);
      livePrices.set(token, prices[token] ?? premiumOf(strike));
    }
  }
  return { oiData, livePrices };
}

/**
 * Snapshots with the given spots, each holding the market `then`.
 * @param {number[]} spots
 * @param {Market} [then]
 * @returns {OiSnapshot[]}
 */
export function snapshotsOf(spots, then = market()) {
  return spots.map((spot, i) => ({
    timestamp: i,
    timeLabel: `10:${i}0`,
    spot,
    data: Object.fromEntries([...then.oiData].map(([k, v]) => [String(k), v])),
    prices: Object.fromEntries([...then.livePrices].map(([k, v]) => [String(k), v])),
  }));
}

/**
 * The single-option recommendation of a setup type at a strike.
 * @template {{ type: string, strikes: number[] }} Rec
 * @param {Rec[]} recs
 * @param {string} type
 * @param {number} strike
 */
export const single = (recs, type, strike) => recs.find((r) => r.type === type && r.strikes[0] === strike);
