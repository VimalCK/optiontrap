import React, { useEffect, useState } from 'react';
import PaperPositions from '@/components/Positions/PaperPositions';
import LivePositions from '@/components/Positions/LivePositions';
import { TRADING_MODES, TradingMode, type TradingModeId } from '../../shared/tradeEnums.js';
import { saveTradingMode, storedTradingMode } from '@/utils/tradingModeStorage';
import '@/styles/analytics.css'; // reuse the shared tab-bar CSS
import '@/styles/positions.css';

const TradingModeTabs: React.FC<{ mode: TradingModeId; onChange: (mode: TradingModeId) => void; style?: React.CSSProperties }> = ({ mode, onChange, style }) => (
  <div className="positions-mode-tabs" style={style}>
    {TRADING_MODES.map((m) => (
      <button key={m} className={`positions-mode-tab ${mode === m ? 'positions-mode-tab--active' : ''}`} onClick={() => onChange(m)}>
        <span className={`positions-mode-dot positions-mode-dot--${m.toLowerCase()}`} />
        {m.charAt(0).toUpperCase() + m.slice(1)}
      </button>
    ))}
  </div>
);

const Positions: React.FC<{ hideHeader?: boolean; initialMode?: TradingModeId }> = ({ hideHeader = false, initialMode }) => {
  const [mode, setMode] = useState<TradingModeId>(() => initialMode || storedTradingMode());

  useEffect(() => {
    if (!initialMode) return;
    setMode(initialMode);
    saveTradingMode(initialMode);
  }, [initialMode]);

  const handleModeChange = (nextMode: TradingModeId) => {
    setMode(nextMode);
    saveTradingMode(nextMode);
  };

  return (
    <div>
      {hideHeader ? (
        <TradingModeTabs mode={mode} onChange={handleModeChange} style={{ marginBottom: 20 }} />
      ) : (
        <div className="page-header">
          <div className="positions-header-row">
            <div>
              <h1 className="page-header__title">Positions</h1>
              <p className="page-header__subtitle">
                {mode === TradingMode.Paper ? 'Simulated paper trading positions' : 'Live market positions from Kite'}
              </p>
            </div>
            <TradingModeTabs mode={mode} onChange={handleModeChange} />
          </div>
        </div>
      )}

      {mode === TradingMode.Paper ? <PaperPositions /> : <LivePositions />}
    </div>
  );
};

export default Positions;
