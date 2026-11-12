/**
 * Rule: enter automated trades through a limit order at a better price than
 * the last traded price, by a set percentage: a buy below it, a sell above it.
 * It never refuses a trade; the trade engine prices the order with it
 * (entryLimitPrice in index.js). The order fills when the price reaches the
 * limit, or is cancelled at the market close and the trade is rejected.
 */

import { ParamType } from '../tradeEnums.js';

/** This entry rule's id: stored in users' settings and trade records, so it never changes. */
export const ENTRY_LIMIT_OFFSET_RULE_ID = 'entry-limit-offset';

/** @type {import('./index.js').EntryRule} */
export default {
  id: ENTRY_LIMIT_OFFSET_RULE_ID,
  label: 'Entry limit offset',
  description: 'Places each automated entry as a limit order this percentage better than the last price (a buy below it, a sell above it). It fills when the price gets there, or is cancelled at the market close.',
  params: [{ key: 'percent', label: 'Better by (%)', type: ParamType.Percent }],
  check: () => null,
};
