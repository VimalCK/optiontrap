import { useEffect, useState } from 'react';
import { loadUnderlyings, loadedUnderlyings, onUnderlyingsChange, type Underlying } from '@/services/underlyings';

/** F&O underlyings: shared and fetched once, updated when a setting changes; empty until loaded. */
export function useUnderlyings(): Underlying[] {
  const [list, setList] = useState<Underlying[]>(() => loadedUnderlyings() ?? []);
  useEffect(() => {
    let live = true;
    const unsubscribe = onUnderlyingsChange((changed) => { if (live) setList(changed); });
    if (!loadedUnderlyings()) {
      loadUnderlyings().then((loaded) => { if (live) setList(loaded); }).catch(() => { /* links fall back to the plain symbol */ });
    }
    return () => { live = false; unsubscribe(); };
  }, []);
  return list;
}
