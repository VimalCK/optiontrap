/** Rule: a trade may not be bigger than a set number of lots (quantity ÷ the instrument's lot size). */

/** @type {import('./index.js').AutomationRule} */
export default {
  id: 'max-lots',
  label: 'Max lots per trade',
  description: 'Trades for more than this many lots are rejected.',
  params: [{ key: 'max', label: 'Lots', type: 'count' }],
  check: (trade, _ctx, { max }) => {
    const lots = trade.quantity / trade.lotSize;
    return lots > max ? `${lots} lots is above the ${max} allowed per trade` : null;
  },
};
