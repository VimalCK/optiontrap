/** Rule: exit a position once its profit reaches a set amount (₹ per position). */

/** @type {import('./index.js').ExitRule} */
export default {
  id: 'target',
  label: 'Target',
  description: 'Exits a position once its P&L is up this much.',
  params: [{ key: 'amount', label: 'Profit (₹)', type: 'amount' }],
  check: (position, _ctx, { amount }) => (position.pnl >= amount
    ? `Target hit: P&L ₹${position.pnl.toFixed(2)}, target ₹${amount}`
    : null),
};
