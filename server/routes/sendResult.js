import { RULE_CODES } from '../../shared/paperTradeRules.js';
import { NO_PRICE } from '../tradeEngine/services/orders.js';
import { NOT_FOUND } from '../tradeEngine/positions.js';
import { sendCreated, sendError, sendOk } from '../replies.js';

export const PLAN_NOT_FOUND = 'PLAN_NOT_FOUND';

// NO_PRICE: Kite gave no last price to price an order with.
const RESULT_HTTP_STATUS = {
  [RULE_CODES.INVALID_TRADE]: 400,
  [RULE_CODES.MARKET_CLOSED]: 409,
  [NOT_FOUND]: 404,
  [NO_PRICE]: 502,
  [PLAN_NOT_FOUND]: 400,
};

/**
 * Replies to a service result: `{ ok: true }` with `data` (201 when `created`), or `{ ok: false, code, message }`
 * with the code's HTTP status (400 for a code not listed) and the code in the body, for callers that branch on it.
 */
export function sendResult(res, { ok, code, message }, { data, created = false } = {}) {
  if (!ok) return sendError(res, RESULT_HTTP_STATUS[code] ?? 400, message, { code });
  return created ? sendCreated(res, data) : sendOk(res, data);
}
