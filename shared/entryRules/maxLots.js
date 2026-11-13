/**
 * Lots are quantity ÷ the instrument's lot size. The trade engine also sizes
 * automated trades with this value (tradeLots in index.js).
 */

import { ParamType } from '../tradeEnums.js';

/** This entry rule's id: stored in users' settings and trade records, so it never changes. */
export const MAX_LOTS_RULE_ID = 'max-lots';

/** @type {import('./index.js').EntryRule} */
export default {
  id: MAX_LOTS_RULE_ID,
  label: 'Max lots per trade',
  description: 'Each automated trade is this many lots (1 lot while this rule is off).',
  params: [{ key: 'max', label: 'Lots', type: ParamType.Count, hideLabel: true }],
  check: (trade, _ctx, { max }) => {
    const lots = trade.quantity / trade.lotSize;
    return lots > max ? `${lots} lots is above the ${max} allowed per trade` : null;
  },
};
