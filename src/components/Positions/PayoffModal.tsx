import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadGroupOi, type OiBar, type RiskGroup } from '@/services/positionRisk';
import PayoffChart from './PayoffChart';
import { breakevenLabel, expiryLabel, legCountLabel, maxLossLabel, maxProfitLabel } from './riskLabels';

/** Full-size payoff curve in a centered overlay. Closes on backdrop click, the × button, or Esc. */
const PayoffModal: React.FC<{ group: RiskGroup; spotPrice?: number | null; onClose: () => void }> = ({ group, spotPrice, onClose }) => {
  const [oiBars, setOiBars] = useState<OiBar[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    loadGroupOi(group).then((bars) => { if (!cancelled) setOiBars(bars); });
    return () => { cancelled = true; };
  }, [group]);

  return createPortal(
    <div className="payoff-modal__backdrop" onClick={onClose}>
      <div className="payoff-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="payoff-modal__header">
          <span className="payoff-modal__title">
            {group.underlying} <span className="risk-card__expiry">{expiryLabel(group.expiry)}</span>
            <span className="risk-card__legs">{legCountLabel(group)}</span>
            {' '}Payoff at Expiry
          </span>
          <button className="payoff-modal__close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="payoff-modal__summary">
          <span>Max Loss: <strong className="negative">{maxLossLabel(group)}</strong></span>
          <span>Max Profit: <strong className="positive">{maxProfitLabel(group)}</strong></span>
          <span>Breakeven: <strong>{breakevenLabel(group)}</strong></span>
        </div>

        <div className="payoff-modal__chart">
          <PayoffChart group={group} oiBars={oiBars} spotPrice={spotPrice} />
        </div>
        {oiBars.length > 0 && (
          <div className="payoff-modal__legend">
            <span className="payoff-modal__legend-item"><span className="swatch swatch--ce" /> Call OI</span>
            <span className="payoff-modal__legend-item"><span className="swatch swatch--pe" /> Put OI</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default PayoffModal;
