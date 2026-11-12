/**
 * Settled orders (filled or cancelled) placed before today (market time) have
 * done their job: drop them. A fill lives on in its position (entry and exit
 * prices, charges) and an automated trade's in algo_trades; only the order
 * record goes, so GET /api/orders?from=…&to=… lists today's settled orders.
 * Open orders stay, whenever placed: a positional one may still be waiting.
 * Runs at 08:30 IST, before the open, so no fill is in flight. Nothing
 * references orders. date_trunc() works in the session time zone, which
 * runSql sets to the market's.
 *
 * No index: the purge deletes nearly every row it reads (each night the table
 * holds the previous day's settled orders and the few open ones), so one
 * sequential read is the cheapest plan, and the one Postgres picks even with
 * an index on (created_at) WHERE status <> Open. The nightly purge keeps the
 * table at about a day of orders.
 */
import { sqlEnum } from '../../sql.js';
import { OrderStatus } from '../../../shared/tradeEnums.js';

/** Delete the settled orders placed before today. */
export default async function run({ runSql }) {
  const rowCount = await runSql(`DELETE FROM orders WHERE status <> ${sqlEnum(OrderStatus.Open)} AND created_at < date_trunc('day', now())`);
  return { rowCount };
}
