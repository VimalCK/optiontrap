import React from 'react';
import type { DayBias } from '@/services/sellStrategy';
import { dayLeanLabel } from '../../../shared/analysisEnums.js';
import { dayReadingItems } from './dayReadings';

interface StrategySummaryBarProps {
  maxPain: number;
  pcr: number;
  spot: number;
  expectedMove: number;
  /** Today's lean, once there are two snapshots; every setup's direction part reads it. */
  day?: DayBias | null;
}

/** Where the lean's marker sits on the gauge, −1 at the left edge to +1 at the right, as a percentage. */
export const gaugePosition = (bias: number): number => ((Math.max(-1, Math.min(1, bias)) + 1) / 2) * 100;

const Metric: React.FC<{ label: string; value: string; tone?: string }> = ({ label, value, tone = '' }) => (
  <div className="sell-strategy__metric">
    <span className="sell-strategy__metric-label">{label}</span>
    <span className={`sell-strategy__metric-value ${tone}`}>{value}</span>
  </div>
);

const DayGauge: React.FC<{ day: DayBias }> = ({ day }) => (
  <div className="sell-strategy__lean">
    <div className="sell-strategy__lean-row">
      <span className="sell-strategy__lean-end">Bearish</span>
      <div className="sell-strategy__gauge" role="img" aria-label={`Day ${dayLeanLabel(day.lean).toLowerCase()}, ${day.bias.toFixed(2)} on a scale from −1 to +1`}>
        <span className="sell-strategy__gauge-centre" />
        <span className={`sell-strategy__gauge-marker sell-strategy__gauge-marker--${day.lean.toLowerCase()}`} style={{ left: `${gaugePosition(day.bias)}%` }} />
      </div>
      <span className="sell-strategy__lean-end">Bullish</span>
      <span className={`sell-strategy__lean-value sell-strategy__lean-value--${day.lean.toLowerCase()}`}>
        {dayLeanLabel(day.lean)} {day.bias >= 0 ? '+' : '−'}{Math.abs(day.bias).toFixed(2)}
      </span>
    </div>
    {day.readings && (
      <div className="sell-strategy__readings">
        {dayReadingItems(day.readings).map(({ label, value, note, lean }) => (
          <div key={label} className="sell-strategy__reading">
            <span className="sell-strategy__metric-label">{label}</span>
            <span className={`sell-strategy__reading-value sell-strategy__reading-value--${lean.toLowerCase()}`}>
              {value}
              {note && <span className="sell-strategy__reading-note"> {note}</span>}
            </span>
          </div>
        ))}
      </div>
    )}
  </div>
);

/** Spot, PCR, max pain and the expected move, with the day's lean when there is one: shown above every strategy mode. */
const StrategySummaryBar: React.FC<StrategySummaryBarProps> = ({ maxPain, pcr, spot, expectedMove, day }) => (
  <div className="sell-strategy__context">
    <div className="sell-strategy__metrics">
      <Metric label="Spot" value={spot > 0 ? spot.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '-'} />
      <Metric label="PCR" value={pcr > 0 ? pcr.toFixed(2) : '-'} tone={pcr > 1 ? 'positive' : pcr < 1 ? 'negative' : ''} />
      <Metric label="Max Pain" value={maxPain > 0 ? String(maxPain) : '-'} />
      <Metric label="Expected Move" value={expectedMove > 0 ? `±${expectedMove.toFixed(0)}` : '-'} />
    </div>
    {day && <DayGauge day={day} />}
  </div>
);

export default StrategySummaryBar;
