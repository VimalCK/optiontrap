/** Test helper: starts one plug-in on a real market clock (market.js), so tests can run under fake timers. */
import { createMarket } from './market.js';

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
