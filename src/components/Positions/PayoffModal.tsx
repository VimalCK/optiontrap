import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from '@/components/Modal/Modal';
import { ModalSize } from '@/utils/uiEnums';
import { loadGroupOi, type OiBar, type RiskGroup } from '@/services/positionRisk';
import PayoffChart from './PayoffChart';
import { breakevenLabel, expiryLabel, legCountLabel, maxLossLabel, maxProfitLabel } from './riskLabels';

/** Full-size payoff curve in a popup, drawn over the page from document.body so no positioned table clips it. */
const PayoffModal: React.FC<{ group: RiskGroup; spotPrice?: number | null; onClose: () => void }> = ({ group, spotPrice, onClose }) => {
  const [oiBars, setOiBars] = useState<OiBar[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadGroupOi(group).then((bars) => { if (!cancelled) setOiBars(bars); });
    return () => { cancelled = true; };
  }, [group]);

  return createPortal(
    <Modal
      title={`${group.underlying} Payoff at Expiry`}
      titleExtras={<><span className="risk-card__expiry">{expiryLabel(group.expiry)}</span><span className="risk-card__legs">{legCountLabel(group)}</span></>}
      size={ModalSize.Large}
      onClose={onClose}
    >
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
    </Modal>,
    document.body,
  );
};

export default PayoffModal;
