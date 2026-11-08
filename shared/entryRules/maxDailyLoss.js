/** Rule: stop taking automated trades once today's automated loss reaches a set amount. */

/** @type {import('./index.js').EntryRule} */
export default {
  id: 'max-daily-loss',
  label: 'Max loss per day',
  description: "Don't take any new trade once today's loss is already this much or more: booked P&L plus open positions at their live price.",
  params: [{ key: 'amount', label: 'Loss (₹)', type: 'amount' }],
  check: (_trade, ctx, { amount }) => (ctx.todayAutoPnl <= -amount
    ? `Today's automated loss ₹${(-ctx.todayAutoPnl).toFixed(2)} has reached the ₹${amount} limit`
    : null),
};
