import { useEffect, useState } from 'react';
import { loadUnderlyings, loadedUnderlyings, type Underlying } from '@/services/underlyings';

/** The F&O underlyings (shared, fetched once); empty until they load. */
export function useUnderlyings(): Underlying[] {
  const [list, setList] = useState<Underlying[]>(() => loadedUnderlyings() ?? []);
  useEffect(() => {
    if (loadedUnderlyings()) return;
    let live = true;
    loadUnderlyings().then((loaded) => { if (live) setList(loaded); }).catch(() => { /* links fall back to the plain symbol */ });
    return () => { live = false; };
  }, []);
  return list;
}
