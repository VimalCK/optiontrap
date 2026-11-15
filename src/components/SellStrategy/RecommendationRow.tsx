import React from 'react';
import type { BuyRecommendation, SellRecommendation } from '@/services/sellStrategy';
import { TradingMode, type TradingModeId } from '../../../shared/tradeEnums.js';
import { optionSetupLabel, setupPatternLabel } from '../../../shared/analysisEnums.js';
import { StrategyMode, strategyModeLabel, type StrategyModeId } from '../../../shared/appEnums.js';
import { actionBtnClass, scoreColorClass, strikeLabel } from './strategySetups';

interface RecommendationRowProps {
  rec: SellRecommendation | BuyRecommendation;
  mode: StrategyModeId;
  orderMode: TradingModeId;
  expiry: string;
  breakdownLabels: { label: string; key: string; max: number }[];
  expanded: boolean;
  onToggle: () => void;
  onTrade: (rec: SellRecommendation | BuyRecommendation) => void;
}

/** One scored setup: its score, POP (sell), premium and pattern, a trade button, and the score breakdown when expanded. */
const RecommendationRow: React.FC<RecommendationRowProps> = ({ rec, mode, orderMode, expiry, breakdownLabels, expanded, onToggle, onTrade }) => {
  const colorClass = scoreColorClass(rec.score);

  return (
    <div className="sell-strategy__row">
      <div
        className="sell-strategy__row-main"
        onClick={onToggle}
      >
        <span className={`sell-strategy__badge sell-strategy__badge--${rec.type.toLowerCase()}`}>
          {optionSetupLabel(rec.type)}
        </span>
        <span className="sell-strategy__strike">{strikeLabel(rec.strikes)}</span>

        <div className="sell-strategy__score-area">
          <div className="sell-strategy__score-track">
            <div
              className={`sell-strategy__score-fill sell-strategy__score-fill--${colorClass}`}
              style={{ width: `${rec.score}%` }}
            />
          </div>
          <span className={`sell-strategy__score-value sell-strategy__score-value--${colorClass}`}>
            {rec.score}
          </span>
        </div>

        {mode === StrategyMode.Sell && (
          <span className="sell-strategy__pop">
            <span className="sell-strategy__pop-label">POP</span>
            <span className={`sell-strategy__pop-value ${(rec as SellRecommendation).pop >= 70 ? 'positive' : (rec as SellRecommendation).pop >= 50 ? '' : 'negative'}`}>
              {(rec as SellRecommendation).pop.toFixed(0)}%
            </span>
          </span>
        )}
        <span className="sell-strategy__premium">₹{rec.premium.toFixed(1)}</span>
        <span className="sell-strategy__pattern">{setupPatternLabel(rec.pattern)}</span>

        {orderMode === TradingMode.Paper && (
          <button
            className={`sell-strategy__sell-btn sell-strategy__sell-btn--${actionBtnClass(rec.type)}`}
            onClick={(e) => { e.stopPropagation(); onTrade(rec); }}
            disabled={!expiry}
          >
            {strategyModeLabel(mode)}
          </button>
        )}

        <span className={`sell-strategy__expand ${expanded ? 'sell-strategy__expand--open' : ''}`}>
          ▼
        </span>
      </div>

      {expanded && (
        <div className="sell-strategy__details">
          <div className="sell-strategy__breakdown">
            {breakdownLabels.map(({ label, key, max }) => {
              const value = (rec.breakdown as unknown as Record<string, number>)[key] ?? 0;
              return (
                <div key={label} className="sell-strategy__breakdown-item">
                  <span className="sell-strategy__breakdown-label">{label}</span>
                  <span className={`sell-strategy__breakdown-value ${value > 0 ? 'sell-strategy__breakdown-value--active' : 'sell-strategy__breakdown-value--zero'}`}>
                    {value}/{max}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="sell-strategy__reasons">
            {rec.reasons.map((r, i) => (
              <span key={i} className="sell-strategy__reason">• {r}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default RecommendationRow;
