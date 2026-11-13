/**
 * The one trade engine, built with the real plug-ins. Adding a strategy or service means adding it to its list; the
 * host (host.js) knows none of them by name.
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
