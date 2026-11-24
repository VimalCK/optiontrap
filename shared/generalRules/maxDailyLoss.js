/**
 * One limit for all of the user's strategies: once reached, no strategy enters (new entry orders are refused, waiting
 * ones cancelled) and every open automated position is closed, winners too: closing at the price doesn't change the
 * day's P&L, only books it.
 */

import { ParamType } from '../tradeEnums.js';

/** This rule's id: stored in users' settings and trade records, so it never changes. */
export const MAX_DAILY_LOSS_RULE_ID = 'max-daily-loss';

/** @type {import('../exitRules/index.js').ExitRule} */
export default {
  id: MAX_DAILY_LOSS_RULE_ID,
  label: 'Max loss per day',
  description: "Once today's automated loss across all strategies is this much or more (booked P&L plus open positions at their live price), no new trade is placed and every open automated position is exited.",
  params: [{ key: 'amount', label: 'Loss (₹)', type: ParamType.Amount }],
  blocksEntryOrders: true,
  check: (_position, ctx, { amount }) => (ctx.todayAutoPnl <= -amount
    ? `Max loss per day hit: today's automated P&L ₹${ctx.todayAutoPnl.toFixed(2)}, limit ₹${amount}`
    : null),
};
