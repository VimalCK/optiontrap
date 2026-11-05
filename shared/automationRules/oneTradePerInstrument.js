/** Rule: no second automated trade in an instrument while a position in it is open. */

/** @type {import('./index.js').AutomationRule} */
export default {
  id: 'one-trade-per-instrument',
  label: 'One position per instrument',
  description: 'A trade in an instrument that already has an open automated position is rejected.',
  params: [],
  check: (trade, ctx) => (ctx.openAutoPositions.some((p) => p.instrumentToken === trade.instrumentToken)
    ? `An automated position in ${trade.tradingsymbol} is already open`
    : null),
};
