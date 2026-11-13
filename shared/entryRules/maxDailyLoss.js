import { ParamType } from '../tradeEnums.js';

/** This entry rule's id: stored in users' settings and trade records, so it never changes. */
export const MAX_DAILY_LOSS_ENTRY_RULE_ID = 'max-daily-loss';

/** @type {import('./index.js').EntryRule} */
export default {
  id: MAX_DAILY_LOSS_ENTRY_RULE_ID,
  label: 'Max loss per day',
  description: "Don't take any new trade once today's loss is already this much or more: booked P&L plus open positions at their live price.",
  params: [{ key: 'amount', label: 'Loss (₹)', type: ParamType.Amount }],
  check: (_trade, ctx, { amount }) => (ctx.todayAutoPnl <= -amount
    ? `Today's automated loss ₹${(-ctx.todayAutoPnl).toFixed(2)} has reached the ₹${amount} limit`
    : null),
};
