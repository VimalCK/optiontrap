/** Rule: exit a position once its loss reaches a set percentage of its entry price. */

/** @type {import('./index.js').ExitRule} */
export default {
  id: 'stop-loss',
  label: 'Stop-loss',
  description: 'Exits a position once its loss is this percentage of its entry price.',
  params: [{ key: 'percent', label: 'Loss (%)', type: 'percent' }],
  check: (position, _ctx, { percent }) => (position.pnlPercent <= -percent
    ? `Stop-loss hit: P&L ${position.pnlPercent.toFixed(2)}% (₹${position.pnl.toFixed(2)}), stop-loss ${percent}%`
    : null),
};
