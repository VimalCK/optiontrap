/**
 * Labels come from shared/tradeEnums.js, so every screen names a horizon the same way.
 */
import React from 'react';
import { horizonLabel, type HorizonId } from '../../../shared/tradeEnums.js';
import './TradeSource.css';

const TradeHorizon: React.FC<{ horizon: HorizonId }> = ({ horizon }) => (
  <span className="trade-source trade-source--horizon" title="Trade type">{horizonLabel(horizon)}</span>
);

export default TradeHorizon;
