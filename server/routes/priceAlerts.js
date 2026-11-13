import { asyncRouter } from '../asyncRoutes.js';
import { subscriber } from '../authMiddleware.js';
import { createPriceAlert, deletePriceAlert, getPriceAlerts, resetPriceAlert, triggerPriceAlert } from '../db.js';
import { parsePriceAlertInput } from '../priceAlerts.js';
import { PriceAlertStatus } from '../../shared/appEnums.js';
import { sendCreated, sendError, sendOk } from '../replies.js';

export const priceAlertRoutes = asyncRouter();

priceAlertRoutes.get('/api/price-alerts', subscriber, async (req, res) => {
  sendOk(res, await getPriceAlerts(req.session.kiteSession.userId));
});

priceAlertRoutes.post('/api/price-alerts', subscriber, async (req, res) => {
  const { alert, error } = parsePriceAlertInput(req.body);
  if (error) return sendError(res, 400, error);
  sendCreated(res, await createPriceAlert(req.session.kiteSession.userId, alert));
});

// Change an alert's status:
//   { status: 'Triggered', price }  the browser saw a tick cross the alert's price
//   { status: 'Active' }            re-arm a triggered alert
priceAlertRoutes.patch('/api/price-alerts/:id', subscriber, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { status } = req.body || {};

  if (status === PriceAlertStatus.Triggered) {
    const price = Number(req.body.price);
    if (!Number.isFinite(price) || price <= 0) {
      return sendError(res, 400, 'price must be above 0');
    }
    const alert = await triggerPriceAlert(req.params.id, userId, price);
    if (!alert) return sendError(res, 404, 'Active alert not found');
    return sendOk(res, alert);
  }

  if (status === PriceAlertStatus.Active) {
    const alert = await resetPriceAlert(req.params.id, userId);
    if (!alert) return sendError(res, 404, 'Alert not found');
    return sendOk(res, alert);
  }

  sendError(res, 400, `status must be '${PriceAlertStatus.Triggered}' or '${PriceAlertStatus.Active}'`);
});

priceAlertRoutes.delete('/api/price-alerts/:id', subscriber, async (req, res) => {
  const deleted = await deletePriceAlert(req.params.id, req.session.kiteSession.userId);
  if (!deleted) return sendError(res, 404, 'Alert not found');
  sendOk(res);
});
