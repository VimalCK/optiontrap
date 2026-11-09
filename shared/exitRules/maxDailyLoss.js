/**
 * Rule: square off every open automated position once today's automated loss
 * reaches a set amount. The Max loss per day entry rule only stops new trades;
 * this one closes the open ones too, so the day's loss stops near the amount.
 * Fired for every position at once (winners too), since closing a position at
 * its price doesn't change the day's P&L, only books it.
 */

/** @type {import('./index.js').ExitRule} */
export default {
  id: 'max-daily-loss',
  label: 'Max loss per day',
  description: "Exits every open automated position once today's loss is this much or more: booked P&L plus open positions at their live price.",
  params: [{ key: 'amount', label: 'Loss (₹)', type: 'amount' }],
  check: (_position, ctx, { amount }) => (ctx.todayAutoPnl <= -amount
    ? `Max loss per day hit: today's automated P&L ₹${ctx.todayAutoPnl.toFixed(2)}, limit ₹${amount}`
    : null),
};
