/**
 * Rule: a trade may not be bigger than a set number of lots (quantity ÷ the
 * instrument's lot size). The trade engine also sizes automated trades with
 * it (tradeLots in index.js): this many lots while it is active, 1 while it is off.
 */

/** @type {import('./index.js').EntryRule} */
export default {
  id: 'max-lots',
  label: 'Max lots per trade',
  description: 'Each automated trade is this many lots (1 lot while this rule is off).',
  params: [{ key: 'max', label: 'Lots', type: 'count', hideLabel: true }],
  check: (trade, _ctx, { max }) => {
    const lots = trade.quantity / trade.lotSize;
    return lots > max ? `${lots} lots is above the ${max} allowed per trade` : null;
  },
};
