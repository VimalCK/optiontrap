import React from 'react';
import type { StockAnalysis } from '../../../shared/stockSetups.js';
import { Side } from '../../../shared/tradeEnums.js';
import { formatNumericDate } from '@/utils/marketStatus';
import { rupees, signedPct } from './setupDetails';

/** The day's setups with their entry, stop and target, or the plan when there is none. */
const SetupCards: React.FC<{ analysis: StockAnalysis }> = ({ analysis }) => {
  if (analysis.setups.length === 0) {
    return (
      <section className="wl-sz-plan">
        <span className="wl-sz-plan__label">No setup today · Plan</span>
        <p>{analysis.plan}</p>
      </section>
    );
  }

  return (
    <section className="wl-sz-section">
      <h4>Setups on {formatNumericDate(analysis.date)}</h4>
      <div className="wl-sz-setups">
        {analysis.setups.map((setup) => (
          <div key={setup.type} className={`wl-sz-setup wl-sz-setup--${setup.direction.toLowerCase()}`}>
            <div className="wl-sz-setup__head">
              <span className="wl-sz-setup__dir">{setup.direction === Side.BUY ? 'Buy' : 'Sell / exit'}</span>
              <strong>{setup.label}</strong>
              <span className="wl-sz-setup__rr" title="Reward ÷ risk">R:R {setup.rewardRisk.toFixed(1)}</span>
            </div>
            <div className="wl-sz-setup__levels">
              <div className="wl-sz-level">
                <span>Entry</span>
                <b>{rupees(setup.entry)}</b>
              </div>
              <div className="wl-sz-level wl-sz-level--stop">
                <span>Stop</span>
                <b>{rupees(setup.stop)}</b>
                <small>{signedPct((setup.stop / setup.entry - 1) * 100)}</small>
              </div>
              <div className="wl-sz-level wl-sz-level--target">
                <span>Target</span>
                <b>{rupees(setup.target)}</b>
                <small>{signedPct((setup.target / setup.entry - 1) * 100)}</small>
              </div>
            </div>
            <p>{setup.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
};

export default SetupCards;
