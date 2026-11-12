/** Triggered price alerts have done their job: drop them. Active ones stay. */
import { sqlEnum } from '../../sql.js';
import { PriceAlertStatus } from '../../../shared/appEnums.js';

/** Delete every triggered price alert. */
export default async function run({ runSql }) {
  const rowCount = await runSql(`DELETE FROM price_alerts WHERE status = ${sqlEnum(PriceAlertStatus.Triggered)}`);
  return { rowCount };
}
