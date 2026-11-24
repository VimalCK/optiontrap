/**
 * Counted across all of the user's strategies, by instrument: a strategy's trade in an instrument already held (by
 * any strategy) adds to that combined position, as the broker shows it, so it isn't counted. A waiting automated
 * limit order counts as the position it will open.
 */

import { ParamType } from '../tradeEnums.js';

/** This rule's id: stored in users' settings and trade records, so it never changes. */
export const MAX_OPEN_POSITIONS_RULE_ID = 'max-open-positions';

/** @type {import('../entryRules/index.js').EntryRule} */
export default {
  id: MAX_OPEN_POSITIONS_RULE_ID,
  label: 'Maximum open positions',
  description: 'No strategy places a new trade while this many automated positions are already open across all strategies (waiting limit orders count too).',
  params: [{ key: 'max', label: 'Positions', type: ParamType.Count, hideLabel: true }],
  check: (trade, ctx, { max }) => {
    const held = new Set([...ctx.openAutoPositions, ...ctx.waitingAutoOrders].map((p) => p.instrumentToken));
    if (held.has(trade.instrumentToken) || held.size < max) return null;
    return `${held.size} automated positions already open or waiting to fill, the most allowed is ${max}`;
  },
};
