/** Rule: exit a position once its loss reaches a set amount (₹ per position). */

/** @type {import('./index.js').ExitRule} */
export default {
  id: 'stop-loss',
  label: 'Stop-loss',
  description: 'Exits a position once its P&L is down this much.',
  params: [{ key: 'amount', label: 'Loss (₹)', type: 'amount' }],
  check: (position, _ctx, { amount }) => (position.pnl <= -amount
    ? `Stop-loss hit: P&L ₹${position.pnl.toFixed(2)}, stop-loss ₹${amount}`
    : null),
};
