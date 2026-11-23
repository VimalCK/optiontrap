import { ParamType } from '../tradeEnums.js';
import { trailingStopHit } from '../trailingStop.js';

/** This exit rule's id: stored in users' settings and trade records, so it never changes. */
export const TARGET_RULE_ID = 'target';

const percentText = (/** @type {number} */ percent) => `${Number(percent.toFixed(2))}%`;

/** @type {import('./index.js').ExitRule} */
export default {
  id: TARGET_RULE_ID,
  label: 'Target',
  description: 'Exits a position once its profit is this percentage of its entry price. With Trail by set, a trailing '
    + 'stop-loss starts there instead, and exits once the profit falls back that much (% of the entry price) from its best.',
  params: [
    { key: 'percent', label: 'Profit (%)', type: ParamType.Percent },
    { key: 'trailPercent', label: 'Trail by (%)', type: ParamType.Percent, optional: true },
  ],
  check: (position, _ctx, { percent, trailPercent }) => {
    if (trailPercent === null || trailPercent === undefined) return position.pnlPercent >= percent ? `Target hit (${percent}%)` : null;
    const hit = trailingStopHit({ best: position.peakPnlPercent, current: position.pnlPercent, start: percent, trail: trailPercent });
    return hit ? `Trailing stop-loss hit (best ${percentText(position.peakPnlPercent)}, trail ${trailPercent}%, target ${percent}%)` : null;
  },
};
