import React from 'react';
import type { ExpectedMove } from '@/services/stockSetups';
import { TRADING_DAYS } from '@/services/fairValue';
import { perDayMove, priceBand, rupees, sessionsTo, shortDate, type Volatility } from './setupDetails';

const shareOf = (move: number, price: number) => ((move / price) * 100).toFixed(1);

/** How much the stock usually moves (realised volatility) beside what the options price in by expiry. */
const MoveStats: React.FC<{ price: number; volatility: Volatility | null; expectedMove: ExpectedMove | null; expectedDaily: number | null }> = ({
  price, volatility, expectedMove, expectedDaily,
}) => {
  if (!volatility && !expectedMove) return null;
  return (
    <section className="wl-sz-vol">
      {volatility && (
        <>
          <div className="wl-sz-stat" title="How much the stock actually moved over the last 20 sessions, as a yearly rate">
            <span>Realised volatility · 20d</span>
            <strong>{(volatility.annual * 100).toFixed(1)}% <small>a year</small></strong>
            <em>≈ {((volatility.annual / Math.sqrt(TRADING_DAYS)) * 100).toFixed(1)}% a day</em>
          </div>
          <div className="wl-sz-stat" title="From the last 20 sessions: about 2 months in 3 stay within this">
            <span>Usual 20-day move</span>
            <strong>±{rupees(volatility.monthly)} <small>({shareOf(volatility.monthly, price)}%)</small></strong>
            <em>{priceBand(price, volatility.monthly)}</em>
            <em className="wl-sz-stat__daily">{perDayMove(price, volatility.daily)}</em>
          </div>
        </>
      )}
      {expectedMove && (
        <div className="wl-sz-stat" title={`${expectedMove.strike} CE + PE: the move the options price in by expiry`}>
          <span>Expected move · {shortDate(expectedMove.expiry)}</span>
          <strong>±{rupees(expectedMove.straddle)} <small>({shareOf(expectedMove.straddle, price)}%)</small></strong>
          <em>{priceBand(price, expectedMove.straddle)}</em>
          {expectedDaily !== null && (
            <em className="wl-sz-stat__daily" title="The straddle prices the average move, about 0.8× a standard move, so it is scaled up to compare with the usual move">
              {perDayMove(price, expectedDaily)} · {sessionsTo(expectedMove.expiry)}d
            </em>
          )}
        </div>
      )}
    </section>
  );
};

export default MoveStats;
