import { ParamType } from '../tradeEnums.js';

/** This exit rule's id: stored in users' settings and trade records, so it never changes. */
export const TARGET_RULE_ID = 'target';

/** @type {import('./index.js').ExitRule} */
export default {
  id: TARGET_RULE_ID,
  label: 'Target',
  description: 'Exits a position once its profit is this percentage of its entry price.',
  params: [{ key: 'percent', label: 'Profit (%)', type: ParamType.Percent }],
  check: (position, _ctx, { percent }) => (position.pnlPercent >= percent
    ? `Target hit (${percent}%)`
    : null),
};
