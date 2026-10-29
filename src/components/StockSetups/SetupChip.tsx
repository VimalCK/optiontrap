import React from 'react';
import type { ScanSummary } from '@/services/stockSetups';

const STATE_TEXT: Record<ScanSummary['state'], string> = {
  falling: 'Falling',
  stretched: 'Stretched',
  turning: 'Turning',
  uptrend: 'Uptrend',
  sideways: 'Sideways',
};

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
    ? `${setup.label} on ${scan.date}: entry ₹${setup.entry.toFixed(2)}, stop ₹${setup.stop.toFixed(2)}, target ₹${setup.target.toFixed(2)}`
    : `No setup on ${scan.date}. ${STATE_TEXT[scan.state]}${scan.support ? `; support ₹${scan.support.low.toFixed(2)}–₹${scan.support.high.toFixed(2)}` : ''}`;
  return (
    <button
      type="button"
      className={`wl-setup-chip ${setup ? `wl-setup-chip--${setup.direction}` : `wl-setup-chip--state wl-setup-chip--${scan.state}`}`}
      onClick={onOpen}
      title={title}
    >
      {setup ? `${setup.direction === 'buy' ? 'Buy' : 'Sell'}: ${setup.label}${extra}` : STATE_TEXT[scan.state]}
    </button>
  );
};

export default SetupChip;
