/** Rule: don't enter an instrument again straight after an automated position in it was exited. */
import { marketTimeLabel } from '../marketTime.js';

const MS_PER_MINUTE = 60_000;

/** @type {import('./index.js').EntryRule} */
export default {
  id: 'wait-after-exit',
  label: 'Wait after exit',
  description: 'After an automated position is exited, that same instrument is not traded again until this many minutes have passed. Other instruments can still be traded.',
  params: [{ key: 'minutes', label: 'Minutes', type: 'count' }],
  check: (trade, ctx, { minutes }) => {
    const exit = ctx.todayAutoExits.find((e) => e.instrumentToken === trade.instrumentToken);
    if (!exit) return null;
    const until = new Date(exit.exitTime.getTime() + minutes * MS_PER_MINUTE);
    return ctx.now < until
      ? `${trade.tradingsymbol} was exited at ${marketTimeLabel(exit.exitTime)} IST; waiting until ${marketTimeLabel(until)} IST`
      : null;
  },
};
