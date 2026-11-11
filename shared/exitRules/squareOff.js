/**
 * Rule: exit every intraday automated position at a time of day (IST).
 * Positional positions are held over days, so this rule leaves them alone.
 */
import { marketTimeLabel } from '../marketTime.js';
import { Horizon } from '../horizons.js';

/** @type {import('./index.js').ExitRule} */
export default {
  id: 'square-off',
  label: 'Square off at',
  description: 'Exits every open intraday automated position at this time (IST).',
  // 15:00 is the time the user asked for; they can change it.
  params: [{ key: 'time', label: 'Time (IST)', type: 'time', default: '15:00' }],
  check: (position, ctx, { time }) => (position.horizon === Horizon.Intraday && marketTimeLabel(ctx.now) >= time ? `Squared off at ${time} IST` : null),
};
