/**
 * Never refuses a trade: the trade engine prices its limit order with
 * entryLimitPrice (index.js). The order is cancelled at the market close,
 * and the trade is then rejected.
 */

import { ParamType } from '../tradeEnums.js';

/** This entry rule's id: stored in users' settings and trade records, so it never changes. */
export const ENTRY_LIMIT_OFFSET_RULE_ID = 'entry-limit-offset';

/** @type {import('./index.js').EntryRule} */
export default {
  id: ENTRY_LIMIT_OFFSET_RULE_ID,
  label: 'Entry limit offset',
  description: 'Places each automated entry as a limit order this many rupees better than the last price (a buy below it, a sell above it: ₹3 on a buy at ₹100 is a limit at ₹97). It fills when the price gets there, or is cancelled at the market close.',
  params: [{ key: 'points', label: 'Better by (₹)', type: ParamType.Amount }],
  check: () => null,
};
