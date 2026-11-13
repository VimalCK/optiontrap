import React, { useState } from 'react';
import IconButton from '@/components/IconButton/IconButton';
import { InfoIcon } from '@/components/icons/Icons';
import { useElementWidth } from '@/hooks/useElementWidth';
import type { OptionChainRow } from '@/services/optionChain';
import type { OiSnapshot, OiVelocity } from '@/services/oiSnapshots';
import type { FlowReading } from '@/services/oiFlow';
import type { computeStrikeSignals } from '@/services/combinedSignal';
import { OptionType, type OptionTypeId } from '../../../shared/tradeEnums.js';
import { OiChartGuide } from './AnalyzerGuides';
import StrikeTooltip from './StrikeTooltip';
import type { ChainPrices, QuickTrade } from './ChainTable';
import { expectedRangeBand, maxChainOi, oiAxisLabel, oiBar, strikeLabelStep, tooltipBottomPx, valueOf, type OiBar } from './chainMetrics';

const AXIS_STEPS = 8;
const AXIS_LINES = Array.from({ length: AXIS_STEPS + 1 }, (_, i) => i);

export type StrikeSignals = ReturnType<typeof computeStrikeSignals>;

export interface OiChartProps {
  chain: OptionChainRow[];
  atmStrike: number;
  prices: ChainPrices & { volumeData: Map<number, number> };
  averageVolume: number;
  spotPrice: number;
  expectedMove: number;
  velocity: Map<number, OiVelocity>;
  snapshots: OiSnapshot[];
  flowByToken: Map<number, FlowReading>;
  strikeSignals: StrikeSignals;
  /** Absent outside paper trading: the tooltip then has no Sell buttons. */
  onQuickTrade?: QuickTrade;
}

const OiBarView: React.FC<{ bar: OiBar; optionType: OptionTypeId }> = ({ bar, optionType }) => (
  <div className="oc-chart__bar-wrapper">
    {bar.shedMarker !== null && <div className={`oc-chart__bar-prev oc-chart__bar-prev--${optionType.toLowerCase()}`} style={{ height: `${bar.shedMarker}%` }} />}
    <div className={`oc-chart__bar oc-chart__bar--${optionType.toLowerCase()} ${bar.confirmed ? 'oc-chart__bar--confirmed' : ''}`} style={{ height: `${bar.height}%` }}>
      {bar.addedPct > 0 && <div className={`oc-chart__bar-added oc-chart__bar-added--${optionType.toLowerCase()}`} style={{ height: `${bar.addedPct}%` }} />}
    </div>
  </div>
);

const VelocityArrow: React.FC<{ velocity: OiVelocity; optionType: OptionTypeId }> = ({ velocity, optionType }) => (
  <span className={`oc-chart__velocity oc-chart__velocity--${optionType.toLowerCase()} ${velocity.changePct > 0 ? 'oc-chart__velocity--up' : 'oc-chart__velocity--down'}`}>
    {velocity.changePct > 0 ? '▲' : '▼'}
  </span>
);

/**
 * The OI chart: CE and PE OI per strike against the previous day (added OI highlighted, shed OI marked), the
 * expected range shaded, fast OI moves flagged, and each strike's signal as a heatmap. Clicking a column opens its
 * tooltip.
 */
const OiChart: React.FC<OiChartProps> = ({ chain, atmStrike, prices, averageVolume, spotPrice, expectedMove, velocity, snapshots, flowByToken, strikeSignals, onQuickTrade }) => {
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [chartWidth, barsRef] = useElementWidth();
  const { oiData, prevDayOi, volumeData } = prices;
  const maxOi = maxChainOi(chain, oiData);
  const band = expectedRangeBand(chain, spotPrice, expectedMove);
  const labelStep = strikeLabelStep(chartWidth, chain.length);

  return (
    <div className={`card oc-chart-card ${selectedStrike !== null ? 'oc-chart-card--tooltip-open' : ''}`} style={{ marginTop: 'var(--card-gap)' }}>
      <div className="trap-card-header">
        <div className="trap-card-header__left">
          <h3 className="card__title" style={{ marginBottom: 0 }}>OI Chart <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-secondary)' }}>(daily changes)</span></h3>
          <IconButton icon={<InfoIcon />} label="How to read this chart" onClick={() => setShowInfo(!showInfo)} expanded={showInfo} />
        </div>
      </div>
      {showInfo && <OiChartGuide />}
      <div className="oc-chart">
        <div className="oc-chart__body">
          <div className="oc-chart__yaxis">
            {AXIS_LINES.map((i) => <span key={i}>{oiAxisLabel(maxOi * (AXIS_STEPS - i) / AXIS_STEPS)}</span>)}
          </div>
          <div className="oc-chart__main">
            <div className="oc-chart__bars" ref={barsRef} onClick={() => setSelectedStrike(null)}>
              <div className="oc-chart__gridlines">
                {AXIS_LINES.map((i) => <div key={i} className="oc-chart__gridline" style={{ top: `${(i / AXIS_STEPS) * 100}%` }} />)}
              </div>
              {band && <div className="oc-chart__expected-range" style={{ left: `${band.left}%`, right: `${band.right}%` }} />}
              {chain.map((row) => {
                const ce = oiBar(valueOf(row.ce, oiData), valueOf(row.ce, prevDayOi), valueOf(row.ce, volumeData), maxOi, averageVolume);
                const pe = oiBar(valueOf(row.pe, oiData), valueOf(row.pe, prevDayOi), valueOf(row.pe, volumeData), maxOi, averageVolume);
                const ceVelocity = row.ce ? velocity.get(row.ce.instrumentToken) : undefined;
                const peVelocity = row.pe ? velocity.get(row.pe.instrumentToken) : undefined;
                const isSelected = selectedStrike === row.strike;
                return (
                  <div
                    key={row.strike}
                    className={`oc-chart__col ${row.strike === atmStrike ? 'oc-chart__col--atm' : ''} ${isSelected ? 'oc-chart__col--selected' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setSelectedStrike(isSelected ? null : row.strike); }}
                  >
                    {isSelected && (
                      <StrikeTooltip
                        row={row}
                        isAtm={row.strike === atmStrike}
                        ce={ce}
                        pe={pe}
                        ceVelocity={ceVelocity}
                        peVelocity={peVelocity}
                        bottomPx={tooltipBottomPx(chain, oiData, maxOi)}
                        livePrices={prices.livePrices}
                        snapshots={snapshots}
                        flowByToken={flowByToken}
                        signal={strikeSignals.get(row.strike)}
                        onQuickTrade={onQuickTrade}
                        onTraded={() => setSelectedStrike(null)}
                      />
                    )}
                    {(ceVelocity?.isHigh || peVelocity?.isHigh) && (
                      <div className="oc-chart__velocity-stack">
                        {ceVelocity?.isHigh && <VelocityArrow velocity={ceVelocity} optionType={OptionType.CE} />}
                        {peVelocity?.isHigh && <VelocityArrow velocity={peVelocity} optionType={OptionType.PE} />}
                      </div>
                    )}
                    <div className="oc-chart__bar-group">
                      <OiBarView bar={pe} optionType={OptionType.PE} />
                      <OiBarView bar={ce} optionType={OptionType.CE} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="oc-chart__signal-heatmap">
              {chain.map((row) => {
                const signal = strikeSignals.get(row.strike);
                return (
                  <div
                    key={row.strike}
                    className={`oc-chart__heatmap-cell${signal?.weak ? ' oc-chart__heatmap-cell--weak' : ''}`}
                    style={signal ? { background: signal.color } : undefined}
                  />
                );
              })}
            </div>
            <div className="oc-chart__strike-labels">
              {chain.map((row, idx) => (
                <span key={row.strike} className="oc-chart__strike-labels-item">{idx % labelStep === 0 ? row.strike : ''}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="oc-chart__legend">
          <span className="oc-chart__legend-item oc-chart__legend-item--ce"><span className="oc-chart__legend-dot oc-chart__legend-dot--ce"></span>CE OI</span>
          <span className="oc-chart__legend-item oc-chart__legend-item--pe"><span className="oc-chart__legend-dot oc-chart__legend-dot--pe"></span>PE OI</span>
          {expectedMove > 0 && <span className="oc-chart__legend-item"><span className="oc-chart__legend-dot oc-chart__legend-dot--range"></span>Expected Range</span>}
        </div>
      </div>
    </div>
  );
};

export default OiChart;
