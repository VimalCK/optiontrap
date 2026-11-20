import React from 'react';
import type { DayBias } from '@/services/sellStrategy';
import { DayLean, dayLeanLabel } from '../../../shared/analysisEnums.js';

/** Today's lean, once for the whole card: the direction part of every setup's score reads it. */
const DayLeanStrip: React.FC<{ day: DayBias }> = ({ day }) => (
  <div className={`sell-strategy__day sell-strategy__day--${day.lean.toLowerCase()}`}>
    <span className="sell-strategy__day-lean">
      {day.lean === DayLean.Neutral ? 'Day neutral' : `Day leans ${dayLeanLabel(day.lean).toLowerCase()}`}
      <span className="sell-strategy__day-bias">{day.bias >= 0 ? '+' : '−'}{Math.abs(day.bias).toFixed(2)}</span>
    </span>
    <span className="sell-strategy__day-detail">{day.reasons.join(' · ')}</span>
  </div>
);

export default DayLeanStrip;
