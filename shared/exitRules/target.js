import { ParamType } from '../tradeEnums.js';
import { trailingStopHit } from '../trailingStop.js';

/** This exit rule's id: stored in users' settings and trade records, so it never changes. */
export const TARGET_RULE_ID = 'target';

/** The best gain is a price difference, so it carries floating-point error (24.749999…): shown to the paisa. */
const gainText = (/** @type {number} */ gain) => String(Number(gain.toFixed(2)));

/** @type {import('./index.js').ExitRule} */
export default {
  id: TARGET_RULE_ID,
  label: 'Target',
  description: 'Exits a position once its price has moved this many rupees in its favour from its entry price (e.g. bought at ₹100 '
    + 'with ₹15: exits at ₹115). With Trail by set, a trailing stop-loss starts there instead and becomes the stop: it follows '
    + 'that many rupees behind the best price (₹2: ₹113 at ₹115, ₹114 at ₹116) and exits when the price falls back to it.',
  params: [
    { key: 'points', label: 'Profit (₹)', type: ParamType.Amount },
    { key: 'trailPoints', label: 'Trail by (₹)', type: ParamType.Amount, optional: true },
  ],
  check: (position, _ctx, { points, trailPoints }) => {
    if (trailPoints === null || trailPoints === undefined) return position.gain >= points ? `Target hit (₹${points})` : null;
    const hit = trailingStopHit({ best: position.bestGain, current: position.gain, start: points, trail: trailPoints });
    return hit ? `Trailing stop-loss hit (best +₹${gainText(position.bestGain)}, trail ₹${trailPoints}, target ₹${points})` : null;
  },
};
