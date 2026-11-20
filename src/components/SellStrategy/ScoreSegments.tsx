import React from 'react';
import type { ScorePartPoints } from './strategySetups';

/** A setup's score as one bar split into its parts, each in its own colour, so the bar shows why it scored. */
const ScoreSegments: React.FC<{ parts: ScorePartPoints[] }> = ({ parts }) => (
  <div className="sell-strategy__segments">
    {parts.map(({ key, label, points, max }) => (
      <span
        key={key}
        className={`sell-strategy__segment sell-strategy__segment--${key.toLowerCase()}`}
        style={{ width: `${points}%` }}
        title={`${label} ${points}/${max}`}
      />
    ))}
  </div>
);

/** Each part's colour and points, as a legend for the bar. */
export const ScoreLegend: React.FC<{ parts: ScorePartPoints[] }> = ({ parts }) => (
  <div className="sell-strategy__legend">
    {parts.map(({ key, label, points, max }) => (
      <span key={key} className="sell-strategy__legend-item" title={`${label} ${points} of ${max}`}>
        <span className={`sell-strategy__legend-dot sell-strategy__segment--${key.toLowerCase()}`} />
        {label} {points}
      </span>
    ))}
  </div>
);

export default ScoreSegments;
