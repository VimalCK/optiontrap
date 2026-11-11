import { useEffect, useState } from 'react';
import { loadStrategies, loadedStrategies, type StrategyInfo } from '@/services/strategies';

/**
 * The trade engine's strategies (shared, fetched once): null until they load,
 * with the reason when they couldn't be.
 */
export function useStrategies(): { strategies: StrategyInfo[] | null; error: string | null } {
  const [strategies, setStrategies] = useState<StrategyInfo[] | null>(loadedStrategies);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (loadedStrategies()) return undefined;
    let live = true;
    loadStrategies()
      .then((loaded) => { if (live) setStrategies(loaded); })
      .catch((err: unknown) => { if (live) setError(err instanceof Error ? err.message : 'Could not load the strategies'); });
    return () => { live = false; };
  }, []);
  return { strategies, error };
}
