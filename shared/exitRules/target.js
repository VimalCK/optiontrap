/** Rule: exit a position once its profit reaches a set percentage of its entry price. */

/** @type {import('./index.js').ExitRule} */
export default {
  id: 'target',
  label: 'Target',
  description: 'Exits a position once its profit is this percentage of its entry price.',
  params: [{ key: 'percent', label: 'Profit (%)', type: 'percent' }],
  check: (position, _ctx, { percent }) => (position.pnlPercent >= percent
    ? `Target hit: P&L ${position.pnlPercent.toFixed(2)}% (₹${position.pnl.toFixed(2)}), target ${percent}%`
    : null),
};
