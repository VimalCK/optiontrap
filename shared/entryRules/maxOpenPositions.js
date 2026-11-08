/**
 * Rule: at most a set number of automated positions open at once. A trade in
 * an instrument already held merges into that position (auto with auto), so
 * it doesn't open a new one and isn't counted.
 */

/** @type {import('./index.js').EntryRule} */
export default {
  id: 'max-open-positions',
  label: 'Maximum open positions',
  description: 'No new trade is placed while this many automated positions are already open.',
  params: [{ key: 'max', label: 'Positions', type: 'count', hideLabel: true }],
  check: (trade, ctx, { max }) => {
    const mergesIntoOpen = ctx.openAutoPositions.some((p) => p.instrumentToken === trade.instrumentToken);
    if (mergesIntoOpen || ctx.openAutoPositions.length < max) return null;
    return `${ctx.openAutoPositions.length} automated positions already open, the most allowed is ${max}`;
  },
};
