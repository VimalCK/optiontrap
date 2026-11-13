/** Market status on the IST clock, re-checked every half minute so live ticks start or stop on time. */
import { useEffect, useState } from 'react';
import { getMarketStatus } from '@/utils/marketStatus';
import type { MarketStatusId } from '../../shared/tradeEnums.js';

const MARKET_STATUS_CHECK_MS = 30_000;

export function useMarketStatus(): MarketStatusId {
  const [marketStatus, setMarketStatus] = useState<MarketStatusId>(getMarketStatus);
  useEffect(() => {
    const timer = setInterval(() => setMarketStatus(getMarketStatus()), MARKET_STATUS_CHECK_MS);
    return () => clearInterval(timer);
  }, []);
  return marketStatus;
}
