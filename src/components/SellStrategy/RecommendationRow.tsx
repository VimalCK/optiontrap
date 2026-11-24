import React from 'react';
import { setupSide } from '@/services/sellStrategy';
import IconButton from '@/components/IconButton/IconButton';
import { ChevronDownIcon } from '@/components/icons/Icons';
import { Side, TradingMode, sideLabel, type TradingModeId } from '../../../shared/tradeEnums.js';
import { optionSetupLabel, setupPatternLabel } from '../../../shared/analysisEnums.js';
import { actionBtnClass, breakevenLabel, scoreColorClass, scorePartsOf, strikeLabel, type ScorePartPoints, type StrategySetup } from './strategySetups';
import ScoreSegments, { ScoreLegend } from './ScoreSegments';

interface RecommendationRowProps {
  rec: StrategySetup;
  spot: number;
  orderMode: TradingModeId;
  expiry: string;
  /** Shown large at the top of the list, with every part visible. */
  featured?: boolean;
  /** Whether this is the setup the Option Analyzer setups automation would take. */
  autoPick?: boolean;
  expanded: boolean;
  onToggle: () => void;
  onTrade: (rec: StrategySetup) => void;
}

export const AUTO_PICK_HINT = 'The setup the Option Analyzer setups automation takes for this underlying, if it reaches your Min score and Min premium';

/** A sold option's profit-chance tone; a bought option's is below 50% by nature (it pays time decay), so it isn't coloured. */
const sellWinTone = (winChance: number): string => (winChance >= 70 ? 'positive' : winChance >= 50 ? '' : 'negative');

const TodayChance: React.FC<{ rec: StrategySetup }> = ({ rec }) => (
  <span className="sell-strategy__pop">
    <span className="sell-strategy__pop-label" title="Chance of being in profit at today's close, after charges">Today</span>
    <span className={`sell-strategy__pop-value ${setupSide(rec.type) === Side.SELL ? sellWinTone(rec.winChance) : ''}`}>
      {rec.winChance.toFixed(0)}%
    </span>
  </span>
);

const ScoreDetails: React.FC<{ rec: StrategySetup; parts: ScorePartPoints[] }> = ({ rec, parts }) => (
  <div className="sell-strategy__details">
    <div className="sell-strategy__details-pattern">Strongest part · {setupPatternLabel(rec.pattern)}</div>
    <div className="sell-strategy__parts">
      {parts.map(({ label, key, max, points, reasons }) => (
        <div key={key} className="sell-strategy__part">
          <span className="sell-strategy__breakdown-label">
            <span className={`sell-strategy__legend-dot sell-strategy__segment--${key.toLowerCase()}`} />
            {label}
          </span>
          <span className={`sell-strategy__breakdown-value ${points > 0 ? 'sell-strategy__breakdown-value--active' : 'sell-strategy__breakdown-value--zero'}`}>
            {points}/{max}
          </span>
          <span className="sell-strategy__part-reasons">{reasons.length > 0 ? reasons.join(' · ') : '—'}</span>
        </div>
      ))}
    </div>
  </div>
);

/**
 * One scored setup: its score split into parts, chance of profit by today's close, premium and breakeven,
 * a trade button, and each part's reasons when expanded. The featured one, at the top, shows every part.
 */
const RecommendationRow: React.FC<RecommendationRowProps> = ({ rec, spot, orderMode, expiry, featured = false, autoPick = false, expanded, onToggle, onTrade }) => {
  const colorClass = scoreColorClass(rec.score);
  const parts = scorePartsOf(rec);

  const tradeButton = orderMode === TradingMode.Paper && (
    <button
      type="button"
      className={`sell-strategy__sell-btn sell-strategy__sell-btn--${actionBtnClass(rec.type)}`}
      onClick={(e) => { e.stopPropagation(); onTrade(rec); }}
      disabled={!expiry}
    >
      {sideLabel(setupSide(rec.type))}
    </button>
  );
  const expandButton = (
    <span className="sell-strategy__expand" onClick={(e) => e.stopPropagation()}>
      <IconButton
        icon={<ChevronDownIcon className={expanded ? 'sell-strategy__chevron sell-strategy__chevron--open' : 'sell-strategy__chevron'} />}
        label={expanded ? 'Hide the score details' : 'Show the score details'}
        expanded={expanded}
        onClick={onToggle}
      />
    </span>
  );
  const setupName = (
    <>
      <span className={`sell-strategy__badge sell-strategy__badge--${rec.type.toLowerCase()}`}>{optionSetupLabel(rec.type)}</span>
      <span className="sell-strategy__strike">{strikeLabel(rec.strikes)}</span>
    </>
  );
  const score = <span className={`sell-strategy__score-value sell-strategy__score-value--${colorClass}`}>{rec.score}</span>;
  const breakeven = <span className="sell-strategy__breakeven" title="Breakeven at expiry, and its distance from spot">{breakevenLabel(rec, spot)}</span>;

  if (featured) {
    return (
      <div className={`sell-strategy__row sell-strategy__row--featured${autoPick ? ' sell-strategy__row--auto' : ''}`}>
        <div className="sell-strategy__featured" onClick={onToggle}>
          <span className="sell-strategy__featured-label" title={autoPick ? AUTO_PICK_HINT : undefined}>{autoPick ? 'Auto pick' : 'Top setup'}</span>
          <div className="sell-strategy__featured-head">
            {setupName}
            <span className="sell-strategy__featured-score">{score}<span className="sell-strategy__featured-of">/100</span></span>
            {tradeButton}
            {expandButton}
          </div>
          <ScoreSegments parts={parts} />
          <ScoreLegend parts={parts} />
          <div className="sell-strategy__facts">
            <TodayChance rec={rec} />
            <span className="sell-strategy__premium">₹{rec.premium.toFixed(2)}</span>
            {breakeven}
          </div>
        </div>
        {expanded && <ScoreDetails rec={rec} parts={parts} />}
      </div>
    );
  }

  return (
    <div className="sell-strategy__row">
      <div className="sell-strategy__row-main" onClick={onToggle}>
        <span className="sell-strategy__name">{setupName}</span>
        {score}
        <span className="sell-strategy__bar"><ScoreSegments parts={parts} /></span>
        <TodayChance rec={rec} />
        <span className="sell-strategy__premium">₹{rec.premium.toFixed(2)}</span>
        <span className="sell-strategy__action">{tradeButton}</span>
        {expandButton}
        <span className="sell-strategy__subline">{breakeven}</span>
      </div>
      {expanded && <ScoreDetails rec={rec} parts={parts} />}
    </div>
  );
};

export default RecommendationRow;
