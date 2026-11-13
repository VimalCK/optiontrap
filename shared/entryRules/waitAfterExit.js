import { marketTimeLabel } from '../marketTime.js';
import { ParamType } from '../tradeEnums.js';

const MS_PER_MINUTE = 60_000;

/** This entry rule's id: stored in users' settings and trade records, so it never changes. */
export const WAIT_AFTER_EXIT_RULE_ID = 'wait-after-exit';

/** @type {import('./index.js').EntryRule} */
export default {
  id: WAIT_AFTER_EXIT_RULE_ID,
  label: 'Wait after exit',
  description: 'After an automated position is exited, that same instrument is not traded again until this many minutes have passed. Other instruments can still be traded.',
  params: [{ key: 'minutes', label: 'Minutes', type: ParamType.Count }],
  check: (trade, ctx, { minutes }) => {
    const exit = ctx.todayAutoExits.find((e) => e.instrumentToken === trade.instrumentToken);
    if (!exit) return null;
    const until = new Date(exit.exitTime.getTime() + minutes * MS_PER_MINUTE);
    return ctx.now < until
      ? `${trade.tradingsymbol} was exited at ${marketTimeLabel(exit.exitTime)} IST; waiting until ${marketTimeLabel(until)} IST`
      : null;
  },
};
