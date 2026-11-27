import { ParamType } from '../tradeEnums.js';

/** This exit rule's id: stored in users' settings and trade records, so it never changes. */
export const STOP_LOSS_RULE_ID = 'stop-loss';

/** @type {import('./index.js').ExitRule} */
export default {
  id: STOP_LOSS_RULE_ID,
  label: 'Stop-loss',
  description: 'Exits a position once its price has moved this many rupees against it from its entry price (e.g. bought at ₹100 with ₹10: exits at ₹90).',
  params: [{ key: 'points', label: 'Loss (₹)', type: ParamType.Amount }],
  check: (position, _ctx, { points }) => (position.gain <= -points
    ? `Stop-loss hit (₹${points})`
    : null),
};
