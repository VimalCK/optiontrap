/** Rule: exit a position once its loss reaches a set percentage of its entry price. */

import { ParamType } from '../tradeEnums.js';

/** This exit rule's id: stored in users' settings and trade records, so it never changes. */
export const STOP_LOSS_RULE_ID = 'stop-loss';

/** @type {import('./index.js').ExitRule} */
export default {
  id: STOP_LOSS_RULE_ID,
  label: 'Stop-loss',
  description: 'Exits a position once its loss is this percentage of its entry price.',
  params: [{ key: 'percent', label: 'Loss (%)', type: ParamType.Percent }],
  check: (position, _ctx, { percent }) => (position.pnlPercent <= -percent
    ? `Stop-loss hit: P&L ${position.pnlPercent.toFixed(2)}% (₹${position.pnl.toFixed(2)}), stop-loss ${percent}%`
    : null),
};
