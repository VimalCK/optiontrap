import React from 'react';
import { formatNumericDate } from '@/utils/marketStatus';
import type { ScanSummary } from '@/services/stockSetups';
import { sideLabel } from '../../../shared/tradeEnums.js';

/** The watchlist's Setups cell: the latest scan's setup, else the stock's state. */
const SetupChip: React.FC<{ scan: ScanSummary | undefined; onOpen: () => void }> = ({ scan, onOpen }) => {
  if (!scan) {
    return (
      <button type="button" className="wl-setup-chip wl-setup-chip--empty" onClick={onOpen} title="Not scanned yet: open to analyse now">
        Analyse
      </button>
    );
  }
  const setup = scan.setups[0];
  const extra = scan.setups.length > 1 ? ` +${scan.setups.length - 1}` : '';
  const title = setup
    ? `${setup.label} on ${formatNumericDate(scan.date)}: entry ₹${setup.entry.toFixed(2)}, stop ₹${setup.stop.toFixed(2)}, target ₹${setup.target.toFixed(2)}`
    : `No setup on ${formatNumericDate(scan.date)}. ${scan.state}${scan.support ? `; support ₹${scan.support.low.toFixed(2)}–₹${scan.support.high.toFixed(2)}` : ''}`;
  return (
    <button
      type="button"
      className={`wl-setup-chip ${setup ? `wl-setup-chip--${setup.direction.toLowerCase()}` : `wl-setup-chip--state wl-setup-chip--${scan.state.toLowerCase()}`}`}
      onClick={onOpen}
      title={title}
    >
      {setup ? `${sideLabel(setup.direction)}: ${setup.label}${extra}` : scan.state}
    </button>
  );
};

export default SetupChip;
