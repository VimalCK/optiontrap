/**
 * Used by the paper positions and the paper orders, so both name an instrument the same way.
 */
import React from 'react';
import { instrumentName, type Position } from '@/services/positions';
import { formatCalendarDate } from '@/utils/marketStatus';
import TradeSource from '@/components/TradeSource/TradeSource';
import TradeHorizon from '@/components/TradeSource/TradeHorizon';
import '@/styles/positions.css';

export interface PositionInstrumentProps {
  instrument: Pick<Position, 'tradingsymbol' | 'instrumentType' | 'strike' | 'expiry' | 'source' | 'horizon'>;
  /** Shown first on the second line, before the source and horizon labels (a position's entry time). */
  detail?: React.ReactNode;
  children?: React.ReactNode;
}

const PositionInstrument: React.FC<PositionInstrumentProps> = ({ instrument, detail, children }) => (
  <>
    <span className="positions-table__instrument">
      <span className="positions-table__name">{instrumentName(instrument)}</span>
      {instrument.strike != null && <span className="positions-table__strike">{instrument.strike}</span>}
      <span className={`positions-table__type positions-table__type--${instrument.instrumentType.toLowerCase()}`}>{instrument.instrumentType}</span>
      {instrument.expiry && <span className="positions-table__expiry">{formatCalendarDate(instrument.expiry, { day: '2-digit', month: 'short' })}</span>}
      {children}
    </span>
    <span className="positions-table__labels">
      {detail != null && <span className="positions-table__detail">{detail}</span>}
      <TradeSource source={instrument.source} />
      <TradeHorizon horizon={instrument.horizon} />
    </span>
  </>
);

export default PositionInstrument;
