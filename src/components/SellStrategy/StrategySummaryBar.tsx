import React from 'react';

/** Max pain, PCR, spot and expected move: shown above every strategy mode. */
const StrategySummaryBar: React.FC<{ maxPain: number; pcr: number; spot: number; expectedMove: number }> = ({ maxPain, pcr, spot, expectedMove }) => (
  <div className="trap-summary">
    <div className="trap-summary__item">
      <span className="trap-summary__label">Max Pain</span>
      <span className="trap-summary__value">{maxPain > 0 ? maxPain : '-'}</span>
    </div>
    <div className="trap-summary__item">
      <span className="trap-summary__label">PCR</span>
      <span className={`trap-summary__value ${pcr > 1 ? 'positive' : pcr < 1 ? 'negative' : ''}`}>
        {pcr > 0 ? pcr.toFixed(2) : '-'}
      </span>
    </div>
    <div className="trap-summary__item">
      <span className="trap-summary__label">Spot</span>
      <span className="trap-summary__value">{spot > 0 ? spot.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '-'}</span>
    </div>
    <div className="trap-summary__item">
      <span className="trap-summary__label">Expected Move</span>
      <span className="trap-summary__value">{expectedMove > 0 ? `±${expectedMove.toFixed(0)}` : '-'}</span>
    </div>
  </div>
);

export default StrategySummaryBar;
