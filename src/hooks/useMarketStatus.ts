/**
 * The market's status (pre-open, live, closed …) on the IST clock, checked
 * again every half minute so screens start or stop live ticks when the
 * market opens or closes while they are showing.
 */
import { useEffect, useState } from 'react';
import { getMarketStatus } from '@/utils/marketStatus';
import type { MarketStatusId } from '../../shared/tradeEnums.js';

const MARKET_STATUS_CHECK_MS = 30_000;

/** The current market status, kept up to date while the screen shows. */
export function useMarketStatus(): MarketStatusId {
  const [marketStatus, setMarketStatus] = useState<MarketStatusId>(getMarketStatus);
  useEffect(() => {
    const timer = setInterval(() => setMarketStatus(getMarketStatus()), MARKET_STATUS_CHECK_MS);
    return () => clearInterval(timer);
  }, []);
  return marketStatus;
}
