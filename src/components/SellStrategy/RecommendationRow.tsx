import React from 'react';
import { setupSide } from '@/services/sellStrategy';
import IconButton from '@/components/IconButton/IconButton';
import { ChevronDownIcon } from '@/components/icons/Icons';
import { Side, TradingMode, sideLabel, type TradingModeId } from '../../../shared/tradeEnums.js';
import { optionSetupLabel, setupPatternLabel } from '../../../shared/analysisEnums.js';
import { actionBtnClass, breakevenLabel, scoreColorClass, scorePartsOf, strikeLabel, type StrategySetup } from './strategySetups';

interface RecommendationRowProps {
  rec: StrategySetup;
  spot: number;
  orderMode: TradingModeId;
  expiry: string;
  /** Whether this is the setup the Option Analyzer setups automation would take. */
  autoPick: boolean;
  expanded: boolean;
  onToggle: () => void;
  onTrade: (rec: StrategySetup) => void;
}

export const AUTO_PICK_HINT = "The setup the Option Analyzer setups automation takes for this underlying, if your General settings allow it and it reaches your Min score and Min premium";

/** A sold option's profit-chance tone; a bought option's is below 50% by nature (it pays time decay), so it isn't coloured. */
const sellWinTone = (winChance: number): string => (winChance >= 70 ? 'positive' : winChance >= 50 ? '' : 'negative');

/** One scored setup: its score, chance of profit by today's close, premium and breakeven, a trade button, and the score's parts when expanded. */
const RecommendationRow: React.FC<RecommendationRowProps> = ({ rec, spot, orderMode, expiry, autoPick, expanded, onToggle, onTrade }) => {
  const colorClass = scoreColorClass(rec.score);
  const side = setupSide(rec.type);

  return (
    <div className={`sell-strategy__row${autoPick ? ' sell-strategy__row--auto' : ''}`}>
      <div className="sell-strategy__row-main" onClick={onToggle}>
        <span className={`sell-strategy__badge sell-strategy__badge--${rec.type.toLowerCase()}`}>
          {optionSetupLabel(rec.type)}
        </span>
        <span className="sell-strategy__strike">{strikeLabel(rec.strikes)}</span>
        {autoPick && <span className="sell-strategy__auto" title={AUTO_PICK_HINT}>Auto pick</span>}

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

        <span className="sell-strategy__pop">
          <span className="sell-strategy__pop-label" title="Chance of being in profit at today's close, after charges">Today</span>
          <span className={`sell-strategy__pop-value ${side === Side.SELL ? sellWinTone(rec.winChance) : ''}`}>
            {rec.winChance.toFixed(0)}%
          </span>
        </span>
        <span className="sell-strategy__premium">₹{rec.premium.toFixed(1)}</span>
        <span className="sell-strategy__breakeven" title="Breakeven at expiry, and its distance from spot">{breakevenLabel(rec, spot)}</span>

        {orderMode === TradingMode.Paper && (
          <button
            type="button"
            className={`sell-strategy__sell-btn sell-strategy__sell-btn--${actionBtnClass(rec.type)}`}
            onClick={(e) => { e.stopPropagation(); onTrade(rec); }}
            disabled={!expiry}
          >
            {sideLabel(side)}
          </button>
        )}

        <span className="sell-strategy__expand" onClick={(e) => e.stopPropagation()}>
          <IconButton
            icon={<ChevronDownIcon className={expanded ? 'sell-strategy__chevron sell-strategy__chevron--open' : 'sell-strategy__chevron'} />}
            label={expanded ? 'Hide the score details' : 'Show the score details'}
            expanded={expanded}
            onClick={onToggle}
          />
        </span>
      </div>

      {expanded && (
        <div className="sell-strategy__details">
          <div className="sell-strategy__details-pattern">Strongest part · {setupPatternLabel(rec.pattern)}</div>
          <div className="sell-strategy__parts">
            {scorePartsOf(rec).map(({ label, key, max, points, reasons }) => (
              <div key={key} className="sell-strategy__part">
                <span className="sell-strategy__breakdown-label">{label}</span>
                <span className={`sell-strategy__breakdown-value ${points > 0 ? 'sell-strategy__breakdown-value--active' : 'sell-strategy__breakdown-value--zero'}`}>
                  {points}/{max}
                </span>
                <span className="sell-strategy__part-reasons">
                  {reasons.length > 0 ? reasons.join(' · ') : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default RecommendationRow;
