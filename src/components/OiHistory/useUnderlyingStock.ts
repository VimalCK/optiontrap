import { useCallback, useEffect, useState } from 'react';
import { findNseStock } from '@/services/stockSetups';

/** The scrip's NSE stock (null for indices), for its entry & exit zones, and whether the zones panel is open. */
export function useUnderlyingStock(scrip: string) {
  const [underlyingStock, setUnderlyingStock] = useState<{ instrumentToken: number; tradingsymbol: string } | null>(null);
  const [showZones, setShowZones] = useState(false);
  const openZones = useCallback(() => setShowZones(true), []);
  const closeZones = useCallback(() => setShowZones(false), []);

  useEffect(() => {
    let stale = false;
    setUnderlyingStock(null);
    setShowZones(false);
    if (!scrip) return;
    findNseStock(scrip)
      .then((stock) => { if (!stale) setUnderlyingStock(stock); })
      .catch(() => { /* no zones button */ });
    return () => { stale = true; };
  }, [scrip]);

  return { underlyingStock, showZones, openZones, closeZones };
}
