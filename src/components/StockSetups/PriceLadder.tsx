import React from 'react';
import type { StockAnalysis } from '../../../shared/stockSetups.js';
import { ladderLayout, rupees } from './setupDetails';

const PriceLadder: React.FC<{ analysis: StockAnalysis }> = ({ analysis }) => {
  const layout = ladderLayout(analysis);
  if (!layout) return null;
  const { zones, at } = layout;
  return (
    <div className="wl-sz-ladder" aria-hidden="true">
      <div className="wl-sz-ladder__track">
        {zones.map((z) => (
          <span
            key={`${z.side}-${z.low}`}
            className={`wl-sz-ladder__zone wl-sz-ladder__zone--${z.side.toLowerCase()} wl-sz-ladder__zone--s${z.strength}`}
            style={{ left: at(z.low), width: `max(4px, calc(${at(z.high)} - ${at(z.low)}))` }}
            title={`${z.side} ${rupees(z.low)}–${rupees(z.high)}`}
          />
        ))}
        <span className="wl-sz-ladder__price" style={{ left: at(analysis.price) }}>
          <span className="wl-sz-ladder__price-label">{rupees(analysis.price)}</span>
        </span>
      </div>
      <div className="wl-sz-ladder__legend">
        <span><i className="wl-sz-ladder__key wl-sz-ladder__key--support" />Support · buy zones</span>
        <span><i className="wl-sz-ladder__key wl-sz-ladder__key--resistance" />Resistance · exit zones</span>
      </div>
    </div>
  );
};

export default PriceLadder;
