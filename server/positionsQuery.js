/**
 * SQL for listing a user's positions, kept free of the database driver so it
 * can be unit-tested.
 *
 * `status` picks which positions come back:
 *   - 'closed' → every exited position, from any day (the trade journal).
 *   - omitted  → open positions plus those exited today (the Positions page
 *                and Dashboard), so old exits don't pile up there.
 */

export const POSITION_STATUSES = ['closed'];

/** True when `status` is a value the positions list accepts (or is omitted). */
export function isValidPositionStatus(status) {
  return status === undefined || POSITION_STATUSES.includes(status);
}

/**
 * Build the positions query.
 * @param {string} userId
 * @param {{ mode?: string | null, status?: 'closed', todayStart: string }} options
 *   todayStart: ISO timestamp of today's market-zone midnight. exit_time is
 *   stored as an ISO-8601 UTC string, which sorts chronologically, so a plain
 *   string comparison against it works.
 * @returns {{ sql: string, params: unknown[] }}
 */
export function buildPositionsQuery(userId, { mode = null, status, todayStart }) {
  const params = [userId];
  const conditions = ['user_id = $1'];
  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (mode) conditions.push(`mode = ${addParam(mode)}`);

  if (status === 'closed') {
    conditions.push('exited = 1');
  } else {
    conditions.push(`(exited = 0 OR exit_time >= ${addParam(todayStart)})`);
  }

  const order = status === 'closed' ? 'exit_time DESC' : 'entry_time DESC';
  const sql = `SELECT * FROM positions WHERE ${conditions.join(' AND ')} ORDER BY ${order}`;
  return { sql, params };
}
