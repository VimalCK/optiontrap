import { asyncRouter } from '../asyncRoutes.js';
import { subscriber } from '../authMiddleware.js';
import { getAutoTradeResults, getAutoTrades } from '../db.js';
import { parseRange } from '../positionsQuery.js';
import { tradeEngine } from '../tradeEngine/index.js';
import { getAutomationConfig, saveAutomationConfig, setAutomationEnabled, setStrategyActive } from '../tradeEngine/automationConfigs.js';
import { strategyInfos } from '../tradeEngine/strategies/index.js';
import { parseAutomationConfig, parseSwitch } from '../../shared/automation.js';
import { sendError, sendOk } from '../replies.js';

export const automationRoutes = asyncRouter();

automationRoutes.get('/api/automation/config', subscriber, async (req, res) => {
  sendOk(res, await getAutomationConfig(req.session.kiteSession.userId));
});

automationRoutes.put('/api/automation/config', subscriber, async (req, res) => {
  const userId = req.session.kiteSession.userId;
  const { config, error } = parseAutomationConfig(req.body, strategyInfos());
  if (error) return sendError(res, 400, error);
  const saved = await saveAutomationConfig(userId, config);
  await tradeEngine.services.tradeMonitor.refreshUser(userId); // new exit rules apply from the next tick
  sendOk(res, saved);
});

// The Algo Trading switch alone (Settings), over every strategy: { enabled }.
automationRoutes.patch('/api/automation/config', subscriber, async (req, res) => {
  const { on, error } = parseSwitch(req.body, 'enabled');
  if (error) return sendError(res, 400, error);
  sendOk(res, await setAutomationEnabled(req.session.kiteSession.userId, on));
});

// One of the user's strategies switched on or off alone (Settings): { active }. Answers with the whole configuration.
automationRoutes.patch('/api/automation/strategies/:id', subscriber, async (req, res) => {
  const strategy = strategyInfos().find((s) => s.id === req.params.id);
  if (!strategy) return sendError(res, 404, 'Strategy not found');
  const { on, error } = parseSwitch(req.body, 'active');
  if (error) return sendError(res, 400, error);
  const switched = await setStrategyActive(req.session.kiteSession.userId, strategy, on);
  if (switched.error !== undefined) return sendError(res, 400, switched.error);
  sendOk(res, switched.config);
});

automationRoutes.get('/api/strategies', subscriber, (_req, res) => {
  sendOk(res, strategyInfos());
});

// The automated trades created in ?from=…&to=… (market days, both required), each with its lifecycle.
automationRoutes.get('/api/automation/trades', subscriber, async (req, res) => {
  const range = parseRange(req.query.from, req.query.to, { required: true });
  if (range.error) return sendError(res, 400, range.error);
  sendOk(res, await getAutoTrades(req.session.kiteSession.userId, range));
});

// Win/Loss Patterns: closed automated trades entered in ?from=…&to=… (market days, both required), measured and grouped.
automationRoutes.get('/api/automation/results', subscriber, async (req, res) => {
  const range = parseRange(req.query.from, req.query.to, { required: true });
  if (range.error) return sendError(res, 400, range.error);
  sendOk(res, await getAutoTradeResults(req.session.kiteSession.userId, range));
});
