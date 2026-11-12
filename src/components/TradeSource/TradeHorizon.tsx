/**
 * TradeHorizon — how long a paper trade or order is meant to be held, as a
 * small pill beside TradeSource: Intraday (squared off the same day) or
 * Positional (held over days). Labels come from shared/tradeEnums.js, so every
 * screen names a horizon the same way: the positions and orders tables
 * (through PositionInstrument) and the Trade Journal.
 */
import React from 'react';
import { horizonLabel, type HorizonId } from '../../../shared/tradeEnums.js';
import './TradeSource.css';

const TradeHorizon: React.FC<{ horizon: HorizonId }> = ({ horizon }) => (
  <span className="trade-source trade-source--horizon" title="Trade type">{horizonLabel(horizon)}</span>
);

export default TradeHorizon;
