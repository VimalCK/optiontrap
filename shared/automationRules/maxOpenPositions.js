/**
 * Rule: at most a set number of automated positions open at once. A trade in
 * an instrument already held merges into that position (auto with auto), so
 * it doesn't open a new one and isn't counted.
 */

/** @type {import('./index.js').AutomationRule} */
export default {
  id: 'max-open-positions',
  label: 'Max open automated positions',
  description: 'A trade that would open one more position than this is rejected.',
  params: [{ key: 'max', label: 'Positions', type: 'count' }],
  check: (trade, ctx, { max }) => {
    const mergesIntoOpen = ctx.openAutoPositions.some((p) => p.instrumentToken === trade.instrumentToken);
    if (mergesIntoOpen || ctx.openAutoPositions.length < max) return null;
    return `${ctx.openAutoPositions.length} automated positions already open, the most allowed is ${max}`;
  },
};
