import React from 'react';
import { STRATEGY_MODES, type StrategyModeId } from '../../../shared/appEnums.js';

const StrategyModeToggle: React.FC<{ mode: StrategyModeId; onChange: (mode: StrategyModeId) => void }> = ({ mode, onChange }) => (
  <div className="sell-strategy__toggle">
    {STRATEGY_MODES.map(({ id, label }) => (
      <button
        key={id}
        type="button"
        className={`sell-strategy__toggle-btn ${mode === id ? `sell-strategy__toggle-btn--active-${id.toLowerCase()}` : ''}`}
        onClick={() => onChange(id)}
      >
        {label}
      </button>
    ))}
  </div>
);

export default StrategyModeToggle;
