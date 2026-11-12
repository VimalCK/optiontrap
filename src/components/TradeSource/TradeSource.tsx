/**
 * TradeSource — who placed a paper trade or order, as a small pill: Auto (the
 * trade automation) or Manual (placed by hand on a screen). It shows the
 * server-set `source` column, so every screen names a trade's origin the same
 * way: the positions and orders tables (through PositionInstrument) and the
 * Trade Journal.
 */
import React from 'react';
import type { Position } from '@/services/positions';
import { TradeSource as Source } from '../../../shared/tradeEnums.js';
import './TradeSource.css';

const SOURCES: Record<Position['source'], { label: string; title: string }> = {
  [Source.Auto]: { label: 'Auto', title: 'Placed by the trade automation' },
  [Source.Manual]: { label: 'Manual', title: 'Placed by hand' },
};

const TradeSource: React.FC<{ source: Position['source'] }> = ({ source }) => {
  const { label, title } = SOURCES[source];
  return <span className={`trade-source trade-source--${source.toLowerCase()}`} title={title}>{label}</span>;
};

export default TradeSource;
