/**
 * A fill lives on in its position and an automated trade's in algo_trades; only the order record goes. Open orders
 * stay, whenever placed: a positional one may still be waiting. Runs at 08:30 IST, before the open, so no fill is in
 * flight. date_trunc() works in the session time zone, which runSql sets to the market's.
 *
 * No index: the purge deletes nearly every row it reads, so one sequential read is the cheapest plan, even with an
 * index on (created_at) WHERE status <> Open.
 */
import { sqlEnum } from '../../sql.js';
import { OrderStatus } from '../../../shared/tradeEnums.js';

export default async function run({ runSql }) {
  const rowCount = await runSql(`DELETE FROM orders WHERE status <> ${sqlEnum(OrderStatus.Open)} AND created_at < date_trunc('day', now())`);
  return { rowCount };
}
