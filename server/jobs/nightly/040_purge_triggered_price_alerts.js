import { sqlEnum } from '../../sql.js';
import { PriceAlertStatus } from '../../../shared/appEnums.js';

export default async function run({ runSql }) {
  const rowCount = await runSql(`DELETE FROM price_alerts WHERE status = ${sqlEnum(PriceAlertStatus.Triggered)}`);
  return { rowCount };
}
