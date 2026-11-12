/**
 * Test helper: start one plug-in on a real market clock (market.js), the way
 * a host would, so a scheduled job's test can run under vitest's fake timers
 * and see it fire at the IST times it asked for.
 */
import { createMarket } from './market.js';

/** Start `plugin` with its own market scope and start the clock; returns a stop function. */
export async function runPlugin(plugin, { onError = (_id, err) => { throw err; } } = {}) {
  const market = createMarket({ onError });
  const scope = market.forPlugin(plugin.id);
  await plugin.start({ market: scope, services: {}, log: () => {} });
  market.start();
  return () => {
    market.stop();
    scope.dispose();
  };
}
