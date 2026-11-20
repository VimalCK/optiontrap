import React from 'react';
import { MAX_TRAP_SCORE, TRAP_CAUTION_SCORE, TRAP_LIKELY_SCORE, type TrapAnalysis } from '@/services/trapAnalysis';
import { describeFlow, flowColor, type FlowReading } from '@/services/oiFlow';
import type { OptionTypeId } from '../../../shared/tradeEnums.js';
import { OiFlow, oiFlowLabel } from '../../../shared/analysisEnums.js';

interface TrapVerdictCardProps {
  analysis: TrapAnalysis;
  strike: number;
  optionType: OptionTypeId;
  /** IV-based flow of this option, shown next to its OI signal; not scored. */
  flow?: FlowReading;
}

const scoreShare = (score: number) => `${(Math.min(score, MAX_TRAP_SCORE) / MAX_TRAP_SCORE) * 100}%`;

const Detail: React.FC<{ label: string; children: React.ReactNode; title?: string }> = ({ label, children, title }) => (
  <div className="trap-detail" title={title}>
    <span className="trap-detail__label">{label}</span>
    <span className="trap-detail__value">{children}</span>
  </div>
);

/** One option's trap verdict at the chosen strike: its score on the 0–9 scale, the levels around it and the reasons. */
const TrapVerdictCard: React.FC<TrapVerdictCardProps> = ({ analysis, strike, optionType, flow }) => (
  <div className={`trap-verdict trap-verdict--${analysis.verdict.toLowerCase()}`}>
    <div className="trap-verdict__header">
      <span className="trap-verdict__title">{strike.toLocaleString('en-IN')} {optionType}</span>
      <span className="trap-verdict__pill">{analysis.verdictLabel}</span>
    </div>

    <div className="trap-verdict__meter" title={`Trap score ${analysis.trapScore} of ${MAX_TRAP_SCORE}: Caution from ${TRAP_CAUTION_SCORE}, Likely trapped from ${TRAP_LIKELY_SCORE}`}>
      <div className="trap-verdict__meter-track">
        <span className="trap-verdict__meter-fill" style={{ width: scoreShare(analysis.trapScore) }} />
        <span className="trap-verdict__meter-tick" style={{ left: scoreShare(TRAP_CAUTION_SCORE) }} />
        <span className="trap-verdict__meter-tick" style={{ left: scoreShare(TRAP_LIKELY_SCORE) }} />
      </div>
      <span className="trap-verdict__meter-value">{analysis.trapScore}<span className="trap-verdict__meter-of"> / {MAX_TRAP_SCORE}</span></span>
    </div>

    <div className="trap-verdict__details">
      <Detail label="OI signal">
        <span className={`trap-detail__signal--${analysis.oiSignal.sentiment.toLowerCase()}`}>{analysis.oiSignal.label}</span>
      </Detail>
      <Detail label="IV flow" title={flow && flow.flow !== OiFlow.None ? describeFlow(flow).join('\n') : undefined}>
        {flow && flow.flow !== OiFlow.None ? (
          <span style={{ color: flowColor(flow.flow) }}>
            {oiFlowLabel(flow.flow)}
            {flow.relIvChange !== null && ` (${flow.relIvChange >= 0 ? '+' : ''}${(flow.relIvChange * 100).toFixed(1)} IV vs ATM)`}
          </span>
        ) : '—'}
      </Detail>
      <Detail label="Max pain">
        {analysis.maxPain} <span className="trap-detail__note">{analysis.distanceToMaxPain > 0 ? `${analysis.distanceToMaxPain} pts away` : 'at strike'}</span>
      </Detail>
      <Detail label="Resistance">
        {analysis.nearestResistance
          ? <>{analysis.nearestResistance.strike} <span className="trap-detail__note">{analysis.nearestResistance.strength.toFixed(1)}x OI</span></>
          : '—'}
      </Detail>
      <Detail label="Support">
        {analysis.nearestSupport
          ? <>{analysis.nearestSupport.strike} <span className="trap-detail__note">{analysis.nearestSupport.strength.toFixed(1)}x OI</span></>
          : '—'}
      </Detail>
    </div>

    <ul className="trap-reasons">
      {analysis.reasons.map((reason) => <li key={reason} className="trap-reason">{reason}</li>)}
    </ul>
  </div>
);

export default TrapVerdictCard;
