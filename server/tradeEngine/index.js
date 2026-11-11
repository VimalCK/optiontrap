/**
 * The server's one trade engine, built with the real plug-ins: the order,
 * signals, trade monitor and session square-off services and every registered strategy
 * (strategies/index.js). server/index.js starts it at startup and reaches the
 * services through `tradeEngine.services` (orders for every order, manual or
 * automated; tradeMonitor to pick up a user's changed exit rules).
 *
 * Adding a strategy or service means adding it to its list; the host
 * (host.js) knows none of them by name.
 */
import { createTradeEngine } from './host.js';
import { createOrderService } from './services/orders.js';
import { createSignalsService } from './services/signals.js';
import { createTradeMonitor } from './services/tradeMonitor.js';
import { createSessionSquareOff } from './services/sessionSquareOff.js';
import { STRATEGIES } from './strategies/index.js';

export const tradeEngine = createTradeEngine({
  services: [createOrderService(), createSignalsService(), createTradeMonitor(), createSessionSquareOff()],
  strategies: STRATEGIES,
});
