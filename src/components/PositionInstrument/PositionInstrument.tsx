/**
 * PositionInstrument — a paper trade's instrument as the positions tables show
 * it: name, strike (options), type, expiry (options and futures), who placed
 * it (Auto or Manual, TradeSource), then any extras (e.g. the TradingView
 * link). Used by the paper positions and the paper orders, so both name an
 * instrument the same way.
 */
import React from 'react';
import { instrumentName, type Position } from '@/services/positions';
import { formatCalendarDate } from '@/utils/marketStatus';
import TradeSource from '@/components/TradeSource/TradeSource';
import '@/styles/positions.css';

export interface PositionInstrumentProps {
  instrument: Pick<Position, 'tradingsymbol' | 'instrumentType' | 'strike' | 'expiry' | 'source'>;
  children?: React.ReactNode;
}

const PositionInstrument: React.FC<PositionInstrumentProps> = ({ instrument, children }) => (
  <span className="positions-table__instrument">
    <span className="positions-table__name">{instrumentName(instrument)}</span>
    {instrument.strike != null && <span className="positions-table__strike">{instrument.strike}</span>}
    <span className={`positions-table__type positions-table__type--${instrument.instrumentType.toLowerCase()}`}>{instrument.instrumentType}</span>
    {instrument.expiry && <span className="positions-table__expiry">{formatCalendarDate(instrument.expiry, { day: '2-digit', month: 'short' })}</span>}
    <TradeSource source={instrument.source} />
    {children}
  </span>
);

export default PositionInstrument;
