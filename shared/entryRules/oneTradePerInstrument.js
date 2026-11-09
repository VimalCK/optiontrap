/**
 * Rule: no second automated trade in an instrument while a position in it is
 * open, or an automated limit order in it is still waiting to fill.
 */

/** @type {import('./index.js').EntryRule} */
export default {
  id: 'one-trade-per-instrument',
  label: 'One position per instrument',
  description: 'A trade in an instrument that already has an open automated position, or a waiting automated limit order, is rejected.',
  params: [],
  check: (trade, ctx) => {
    if (ctx.openAutoPositions.some((p) => p.instrumentToken === trade.instrumentToken)) return `An automated position in ${trade.tradingsymbol} is already open`;
    if (ctx.waitingAutoOrders.some((o) => o.instrumentToken === trade.instrumentToken)) return `An automated limit order in ${trade.tradingsymbol} is already waiting`;
    return null;
  },
};
