import React, { useState } from 'react';
import type { RiskGroup } from '@/services/positionRisk';
import { formatSignedAmount } from '@/utils/formatAmount';
import PayoffModal from './PayoffModal';
import { breakevenLabel, expiryLabel, legCountLabel, maxLossLabel, maxProfitLabel, pnlTone } from './riskLabels';

/**
 * The Position Risk tab — one row per strategy (underlying and expiry): live P&L, max loss and profit at expiry,
 * breakeven(s), and whether a leg has hit its journal stop-loss (invalidation) level. Clicking a row opens its
 * payoff curve in the popup.
 */
const RiskTable: React.FC<{ groups: RiskGroup[]; spotPrices: Map<string, number> }> = ({ groups, spotPrices }) => {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = groups.find((g) => g.key === selectedKey) || null;

  if (groups.length === 0) {
    return <p className="card__description">No open option positions to assess.</p>;
  }

  return (
    <>
      <div className="positions-table-scroll">
        <table className="positions-table">
          <thead>
            <tr>
              <th>Strategy</th>
              <th>Live P&L</th>
              <th>Max Loss</th>
              <th>Max Profit</th>
              <th>Breakeven</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr
                key={g.key}
                className={`risk-table__row${g.invalidationHit ? ' risk-table__row--invalidated' : ''}`}
                onClick={() => setSelectedKey(g.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedKey(g.key); }
                }}
                role="button"
                tabIndex={0}
                title="Click to view payoff curve"
              >
                <td>
                  {g.underlying} <span className="risk-card__expiry">{expiryLabel(g.expiry)}</span>
                  {' '}<span className="risk-card__legs">{legCountLabel(g)}</span>
                  {g.invalidationHit && (
                    <div className="risk-table__breached" title="A leg's stop-loss (invalidation) level has been hit">
                      ⚠ Invalidation hit:{' '}
                      {g.legs.filter((l) => l.invalidationHit).map((l) => `${l.position.strike}${l.position.optionType}`).join(', ')}
                    </div>
                  )}
                </td>
                <td className={pnlTone(g.livePnL)}>{g.livePnL == null ? '—' : formatSignedAmount(g.livePnL)}</td>
                <td className="negative">{maxLossLabel(g)}</td>
                <td className="positive">{maxProfitLabel(g)}</td>
                <td>{breakevenLabel(g)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <PayoffModal group={selected} spotPrice={spotPrices.get(selected.underlying)} onClose={() => setSelectedKey(null)} />
      )}
    </>
  );
};

export default RiskTable;
