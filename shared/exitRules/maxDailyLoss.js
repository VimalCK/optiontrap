/**
 * The Max loss per day entry rule only stops new trades; this one also closes
 * the open ones. It fires for every position at once, winners too: closing at
 * the price doesn't change the day's P&L, only books it.
 */

import { ParamType } from '../tradeEnums.js';

/** This exit rule's id: stored in users' settings and trade records, so it never changes. */
export const MAX_DAILY_LOSS_EXIT_RULE_ID = 'max-daily-loss';

/** @type {import('./index.js').ExitRule} */
export default {
  id: MAX_DAILY_LOSS_EXIT_RULE_ID,
  label: 'Max loss per day',
  description: "Exits every open automated position once today's loss is this much or more: booked P&L plus open positions at their live price.",
  params: [{ key: 'amount', label: 'Loss (₹)', type: ParamType.Amount }],
  check: (_position, ctx, { amount }) => (ctx.todayAutoPnl <= -amount
    ? `Max loss per day hit: today's automated P&L ₹${ctx.todayAutoPnl.toFixed(2)}, limit ₹${amount}`
    : null),
};
