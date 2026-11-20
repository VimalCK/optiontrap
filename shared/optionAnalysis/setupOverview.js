/**
 * What the Strategy card shows around its setups, shared with the trade
 * engine's Option Analyzer setups strategy so both rank setups the same way:
 * buys and sells ranked together, the one the strategy would take, the day's
 * lean, and why a side has no setups.
 */
import { OptionType, Side } from '../tradeEnums.js';
import { OptionSetup } from '../analysisEnums.js';
import { dayContext } from './dayBias.js';
import { sellSideGap } from './sellSetups.js';
import { buySideGap } from './buySetups.js';

/**
 * @typedef {import('./sellSetups.js').SellRecommendation | import('./buySetups.js').BuyRecommendation} Setup
 * @typedef {{ side: import('../tradeEnums.js').SideId, text: string }} SideGap
 */

/**
 * The single-option setups, by side and option type; straddles and strangles have none.
 * @type {Partial<Record<import('../analysisEnums.js').OptionSetupId, { side: import('../tradeEnums.js').SideId, optionType: import('../tradeEnums.js').OptionTypeId }>>}
 */
export const SINGLE_OPTION_SETUPS = {
  [OptionSetup.SellCe]: { side: Side.SELL, optionType: OptionType.CE },
  [OptionSetup.SellPe]: { side: Side.SELL, optionType: OptionType.PE },
  [OptionSetup.BuyCe]: { side: Side.BUY, optionType: OptionType.CE },
  [OptionSetup.BuyPe]: { side: Side.BUY, optionType: OptionType.PE },
};

/** @type {import('../analysisEnums.js').OptionSetupId[]} */
const SELL_SETUPS = [OptionSetup.SellCe, OptionSetup.SellPe, OptionSetup.SellStraddle, OptionSetup.SellStrangle];

/** @param {import('../analysisEnums.js').OptionSetupId} type */
export const setupSide = (type) => (SELL_SETUPS.includes(type) ? Side.SELL : Side.BUY);

/**
 * Sell and buy setups ranked together, best first.
 * @template {Setup} S
 * @param {S[]} sell
 * @param {S[]} buy
 * @returns {S[]}
 */
export const rankSetups = (sell, buy) => [...sell, ...buy].sort((a, b) => b.score - a.score);

/**
 * The setup the Option Analyzer setups strategy takes from a ranked list
 * before each user's settings: the best single option. Null when there is none.
 * @template {Setup} S
 * @param {S[]} ranked
 * @returns {S | null}
 */
export const autoPickOf = (ranked) => ranked.find((setup) => SINGLE_OPTION_SETUPS[setup.type]) ?? null;

/**
 * The day's lean and why a side has no setups, for a chain the card scores;
 * nothing before there are two snapshots.
 * @param {import('./chain.js').ChainRow[]} chain
 * @param {Map<number, number>} oiData
 * @param {Map<number, number>} livePrices
 * @param {import('./velocityPattern.js').OiSnapshot[]} snapshots
 * @param {number} spotPrice
 * @param {import('./sellSetups.js').SetupTiming} timing
 * @param {number} [atmStrike]
 * @returns {{ day: import('./dayBias.js').DayBias | null, gaps: SideGap[] }}
 */
export function setupOverview(chain, oiData, livePrices, snapshots, spotPrice, timing, atmStrike) {
  if (chain.length === 0 || spotPrice === 0 || snapshots.length < 2) return { day: null, gaps: [] };
  const { expectedMove, day } = dayContext(chain, oiData, livePrices, snapshots, spotPrice, timing, atmStrike);
  /** @type {SideGap[]} */ const gaps = [];
  for (const type of [OptionType.CE, OptionType.PE]) {
    const sellGap = sellSideGap(type, snapshots, spotPrice, expectedMove);
    if (sellGap) gaps.push({ side: Side.SELL, text: sellGap });
    const buyGap = buySideGap(type, chain, oiData, livePrices, snapshots, spotPrice, expectedMove);
    if (buyGap) gaps.push({ side: Side.BUY, text: buyGap });
  }
  return { day: day.reasons.length > 0 ? day : null, gaps };
}
