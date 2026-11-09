/**
 * Rule: at most a set number of automated positions open at once. A trade in
 * an instrument already held merges into that position (auto with auto), so
 * it doesn't open a new one and isn't counted. An automated limit order still
 * waiting counts as the position it will open.
 */

/** @type {import('./index.js').EntryRule} */
export default {
  id: 'max-open-positions',
  label: 'Maximum open positions',
  description: 'No new trade is placed while this many automated positions are already open (waiting limit orders count too).',
  params: [{ key: 'max', label: 'Positions', type: 'count', hideLabel: true }],
  check: (trade, ctx, { max }) => {
    const held = new Set([...ctx.openAutoPositions, ...ctx.waitingAutoOrders].map((p) => p.instrumentToken));
    if (held.has(trade.instrumentToken) || held.size < max) return null;
    return `${held.size} automated positions already open or waiting to fill, the most allowed is ${max}`;
  },
};
