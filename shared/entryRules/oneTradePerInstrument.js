/** This entry rule's id: stored in users' settings and trade records, so it never changes. */
export const ONE_TRADE_PER_INSTRUMENT_RULE_ID = 'one-trade-per-instrument';

/** @type {import('./index.js').EntryRule} */
export default {
  id: ONE_TRADE_PER_INSTRUMENT_RULE_ID,
  label: 'One position per instrument',
  description: 'A trade in an instrument this strategy already holds, or has a waiting limit order in, is rejected. Other strategies may hold it too.',
  params: [],
  check: (trade, ctx) => {
    if (ctx.openAutoPositions.some((p) => p.instrumentToken === trade.instrumentToken)) return `An automated position in ${trade.tradingsymbol} is already open`;
    if (ctx.waitingAutoOrders.some((o) => o.instrumentToken === trade.instrumentToken)) return `An automated limit order in ${trade.tradingsymbol} is already waiting`;
    return null;
  },
};
