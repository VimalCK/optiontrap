import React from 'react';
import type { OptionChainRow, OptionInstrument } from '@/services/optionChain';
import { analyzeVelocityPattern, type OiSnapshot, type OiVelocity } from '@/services/oiSnapshots';
import { describeFlow, flowColor, type FlowReading } from '@/services/oiFlow';
import { OptionType, Side, type OptionTypeId } from '../../../shared/tradeEnums.js';
import { Confidence, MoveDirection, OiFlow, oiFlowLabel, velocityTrendLabel, type ConfidenceId } from '../../../shared/analysisEnums.js';
import type { QuickTrade } from './ChainTable';
import type { StrikeSignals } from './OiChart';
import type { OiBar } from './chainMetrics';

const VOLUME_CONFIDENCE_LABELS: Record<ConfidenceId, string> = {
  [Confidence.High]: 'Confirmed',
  [Confidence.Medium]: 'Normal',
  [Confidence.Low]: 'Low Vol',
};

const SPARKLINE = { width: 60, height: 20 };

const sparklinePoints = (series: number[]) =>
  series.map((v, i) => `${(i / (series.length - 1)) * SPARKLINE.width},${(1 - v) * SPARKLINE.height}`).join(' ');

const sparklineColor = (direction: string) => (direction === MoveDirection.Up ? '#4ade80' : direction === MoveDirection.Down ? '#f87171' : '#94a3b8');

/** One side of the tooltip: OI and its change, IV flow, OI velocity and today's OI pattern as a sparkline. */
const TooltipSide: React.FC<{
  optionType: OptionTypeId;
  option: OptionInstrument | null;
  bar: OiBar;
  velocity: OiVelocity | undefined;
  snapshots: OiSnapshot[];
  flowByToken: Map<number, FlowReading>;
}> = ({ optionType, option, bar, velocity, snapshots, flowByToken }) => {
  const flow = option ? flowByToken.get(option.instrumentToken) : undefined;
  const pattern = option && velocity ? analyzeVelocityPattern(option.instrumentToken, velocity.currentOi, snapshots) : null;
  const changePct = bar.prevOi > 0 ? ((bar.oi - bar.prevOi) / bar.prevOi) * 100 : null;
  return (
    <div className={`oc-tip__side oc-tip__side--${optionType.toLowerCase()}`}>
      <div className="oc-tip__side-title">{optionType === OptionType.CE ? 'Calls' : 'Puts'}</div>
      <div className="oc-tip__row">
        <span>OI</span>
        <span>{bar.oi.toLocaleString('en-IN')}</span>
      </div>
      {changePct !== null && (
        <div className="oc-tip__row">
          <span>Chg</span>
          <span className={changePct >= 0 ? 'positive' : 'negative'}>{changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%</span>
        </div>
      )}
      {flow && flow.flow !== OiFlow.None && (
        <div className="oc-tip__row oc-tip__row--flow" title={describeFlow(flow).join('\n')}>
          <span>IV flow</span>
          <span className="oc-tip__flow">
            <span style={{ color: flowColor(flow.flow) }}>{oiFlowLabel(flow.flow)}</span>
            {flow.relIvChange !== null && (
              <span className="oc-tip__sub">{flow.relIvChange >= 0 ? '+' : ''}{(flow.relIvChange * 100).toFixed(1)} IV vs ATM</span>
            )}
          </span>
        </div>
      )}
      {velocity && (
        <div className="oc-tip__row">
          <span>Velocity</span>
          <span className={velocity.changePct >= 0 ? 'positive' : 'negative'}>{velocity.changePct >= 0 ? '+' : ''}{velocity.changePct.toFixed(2)}% / {velocity.intervalMinutes}m</span>
        </div>
      )}
      {pattern && (
        <div className="oc-tip__pattern">
          <svg className="oc-chart__sparkline" viewBox={`0 0 ${SPARKLINE.width} ${SPARKLINE.height}`} preserveAspectRatio="none">
            <polyline points={sparklinePoints(pattern.series)} fill="none" stroke={sparklineColor(pattern.direction)} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <span className={`oc-chart__pattern-label oc-chart__pattern-label--${pattern.direction.toLowerCase()}`}>{velocityTrendLabel(pattern.trend)}</span>
        </div>
      )}
    </div>
  );
};

/** A strike's details over the OI chart: PCR, each side's OI story, the strike's signal, and quick Sell buttons. */
const StrikeTooltip: React.FC<{
  row: OptionChainRow;
  isAtm: boolean;
  ce: OiBar;
  pe: OiBar;
  ceVelocity: OiVelocity | undefined;
  peVelocity: OiVelocity | undefined;
  bottomPx: number;
  livePrices: Map<number, number>;
  snapshots: OiSnapshot[];
  flowByToken: Map<number, FlowReading>;
  signal: ReturnType<StrikeSignals['get']>;
  onQuickTrade?: QuickTrade;
  /** After a Sell is placed, so the tooltip can close. */
  onTraded: () => void;
}> = ({ row, isAtm, ce, pe, ceVelocity, peVelocity, bottomPx, livePrices, snapshots, flowByToken, signal, onQuickTrade, onTraded }) => {
  const sellButton = (instrument: OptionInstrument | null, optionType: OptionTypeId) => {
    const ltp = instrument ? (livePrices.get(instrument.instrumentToken) ?? null) : null;
    return (
      <button
        className={`oc-chart__tooltip-sell-btn oc-chart__tooltip-sell-btn--${optionType.toLowerCase()}`}
        disabled={!instrument || ltp === null}
        onClick={async (e) => {
          e.stopPropagation();
          if (!instrument || ltp === null || !onQuickTrade) return;
          if (await onQuickTrade(instrument, row.strike, optionType, Side.SELL)) onTraded();
        }}
      >
        Sell {optionType} {ltp !== null ? `@ ${ltp.toFixed(0)}` : ''}
      </button>
    );
  };

  return (
    <div className="oc-chart__tooltip" style={{ bottom: `${bottomPx}px` }}>
      <div className="oc-tip__header">
        <span className="oc-tip__strike">{row.strike}{isAtm && <span className="oc-tip__atm">ATM</span>}</span>
        <span className="oc-tip__pcr">PCR <strong>{ce.oi > 0 ? (pe.oi / ce.oi).toFixed(2) : '-'}</strong></span>
      </div>
      <TooltipSide optionType={OptionType.CE} option={row.ce} bar={ce} velocity={ceVelocity} snapshots={snapshots} flowByToken={flowByToken} />
      <TooltipSide optionType={OptionType.PE} option={row.pe} bar={pe} velocity={peVelocity} snapshots={snapshots} flowByToken={flowByToken} />
      {signal && (
        <div className="oc-tip__signal">
          <div className="oc-tip__row">
            <span>Signal</span>
            <span style={{ color: signal.color, fontWeight: 600 }}>{signal.label}</span>
          </div>
          {signal.confidence && (
            <div className="oc-tip__row">
              <span>Volume</span>
              <span className={`oc-chart__tooltip-confidence oc-chart__tooltip-confidence--${signal.confidence.toLowerCase()}`}>
                {VOLUME_CONFIDENCE_LABELS[signal.confidence]}
              </span>
            </div>
          )}
        </div>
      )}
      {onQuickTrade && (
        <div className="oc-chart__tooltip-actions">
          {sellButton(row.pe, OptionType.PE)}
          {sellButton(row.ce, OptionType.CE)}
        </div>
      )}
    </div>
  );
};

export default StrikeTooltip;
