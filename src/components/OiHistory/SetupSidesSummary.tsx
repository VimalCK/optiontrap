import React from 'react';
import { OPTION_TYPES, type OptionTypeId } from '../../../shared/tradeEnums.js';
import { formatPct } from './helpers';

/** One option's line in a nearest-expiry summary: its premium change and whether that suits the setup. */
export interface SetupSideReading {
  changePct: number;
  favourable: boolean;
  statusText: string;
  oiChangePct: number | null;
  latestVolume: number;
  daysToExpiry: number | null;
}

interface SetupSidesSummaryProps {
  title: string;
  expiryText: string;
  tag: string;
  className?: string;
  sides: Record<OptionTypeId, SetupSideReading | null>;
}

/** The nearest expiry's CE and PE side by side: premium change, OI change, volume and days to expiry. */
export const SetupSidesSummary: React.FC<SetupSidesSummaryProps> = ({ title, expiryText, tag, className, sides }) => (
  <div className={className ? `oi-history__buying-summary ${className}` : 'oi-history__buying-summary'}>
    <div className="oi-history__buying-summary-head">
      <div>
        <span>{title}</span>
        <strong>{expiryText}</strong>
      </div>
      <em>{tag}</em>
    </div>
    <div className="oi-history__buying-summary-grid">
      {OPTION_TYPES.map((optionType) => {
        const side = sides[optionType];
        return (
          <div key={optionType} className="oi-history__buying-summary-side">
            <div className="oi-history__buying-summary-side-head">
              <strong>{optionType}</strong>
              <span>{side ? side.statusText : 'No history'}</span>
            </div>
            <div className={`oi-history__buying-summary-value ${side && side.favourable ? 'is-positive' : 'is-negative'}`}>
              <strong>{side ? formatPct(side.changePct) : '-'}</strong>
              <small>premium change</small>
            </div>
            <div className="oi-history__buying-summary-metrics">
              <span>OI <b>{side ? formatPct(side.oiChangePct) : '-'}</b></span>
              <span>Vol <b>{side && side.latestVolume > 0 ? side.latestVolume.toLocaleString('en-IN') : '-'}</b></span>
              <span>DTE <b>{side?.daysToExpiry ?? '-'}</b></span>
            </div>
          </div>
        );
      })}
    </div>
  </div>
);
