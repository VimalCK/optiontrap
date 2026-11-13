import crypto from 'crypto';
import { PriceAlertStatus } from '../../shared/appEnums.js';
import { sqlEnum } from '../sql.js';
import { firstRow, query, rows } from './pool.js';

const PRICE_ALERT_COLUMNS = `id, instrument_token, tradingsymbol, exchange, condition, value, note,
  browser_notification, status, triggered_at, triggered_price, created_at`;

function toPriceAlert(row) {
  return {
    id: row.id,
    instrumentToken: Number(row.instrument_token),
    tradingsymbol: row.tradingsymbol,
    exchange: row.exchange,
    condition: row.condition,
    value: Number(row.value),
    note: row.note ?? undefined,
    browserNotification: row.browser_notification,
    status: row.status,
    triggeredAt: row.triggered_at ? row.triggered_at.toISOString() : undefined,
    triggeredPrice: row.triggered_price === null ? undefined : Number(row.triggered_price),
    createdAt: row.created_at.toISOString(),
  };
}

export async function getPriceAlerts(userId) {
  const result = await rows(
    `SELECT ${PRICE_ALERT_COLUMNS} FROM price_alerts WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return result.map(toPriceAlert);
}

export async function createPriceAlert(userId, { instrumentToken, tradingsymbol, exchange, condition, value, note, browserNotification }) {
  const row = await firstRow(
    `INSERT INTO price_alerts (id, user_id, instrument_token, tradingsymbol, exchange, condition, value, note, browser_notification)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${PRICE_ALERT_COLUMNS}`,
    [crypto.randomUUID(), userId, instrumentToken, tradingsymbol, exchange, condition, value, note, browserNotification],
  );
  return toPriceAlert(row);
}

/** Mark an active alert triggered; null if it isn't the user's or already triggered. */
export async function triggerPriceAlert(id, userId, price) {
  const row = await firstRow(
    `UPDATE price_alerts SET status = ${sqlEnum(PriceAlertStatus.Triggered)}, triggered_at = now(), triggered_price = $3
     WHERE id = $1 AND user_id = $2 AND status = ${sqlEnum(PriceAlertStatus.Active)}
     RETURNING ${PRICE_ALERT_COLUMNS}`,
    [id, userId, price],
  );
  return row ? toPriceAlert(row) : null;
}

/** Make a triggered alert active again; null if it isn't the user's. */
export async function resetPriceAlert(id, userId) {
  const row = await firstRow(
    `UPDATE price_alerts SET status = ${sqlEnum(PriceAlertStatus.Active)}, triggered_at = NULL, triggered_price = NULL
     WHERE id = $1 AND user_id = $2
     RETURNING ${PRICE_ALERT_COLUMNS}`,
    [id, userId],
  );
  return row ? toPriceAlert(row) : null;
}

export async function deletePriceAlert(id, userId) {
  const res = await query('DELETE FROM price_alerts WHERE id = $1 AND user_id = $2', [id, userId]);
  return res.rowCount > 0;
}
