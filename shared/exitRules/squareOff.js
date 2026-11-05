/** Rule: exit every automated position at a time of day (IST). */
import { marketTimeLabel } from '../marketTime.js';

/** @type {import('./index.js').ExitRule} */
export default {
  id: 'square-off',
  label: 'Square off at',
  description: 'Exits every open automated position at this time (IST).',
  // 15:00 is the time the user asked for; they can change it.
  params: [{ key: 'time', label: 'Time (IST)', type: 'time', default: '15:00' }],
  check: (_position, ctx, { time }) => (marketTimeLabel(ctx.now) >= time ? `Squared off at ${time} IST` : null),
};
