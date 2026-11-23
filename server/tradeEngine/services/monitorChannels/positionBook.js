/**
 * The open positions one trade monitor channel watches, by id. Reloading a user replaces exactly theirs.
 * @typedef {import('../tradeMonitor.js').WatchedPosition} WatchedPosition
 */
export function createPositionBook() {
  /** @type {Map<string, WatchedPosition>} */
  const positions = new Map();

  return {
    /** @param {WatchedPosition[]} held */
    replaceAll(held) {
      positions.clear();
      for (const position of held) positions.set(position.id, position);
    },
    /** @param {string[]} userIds @param {WatchedPosition[]} held  what those users hold now */
    replaceUsers(userIds, held) {
      for (const [id, position] of positions) if (userIds.includes(position.userId)) positions.delete(id);
      for (const position of held) positions.set(position.id, position);
    },
    delete: (/** @type {string} */ id) => positions.delete(id),
    clear: () => positions.clear(),
    values: () => [...positions.values()],
  };
}
