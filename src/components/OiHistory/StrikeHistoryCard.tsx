import React from 'react';
import { LevelsIcon } from '@/components/icons/Icons';
import { REALIZED_WINDOW, type ExpiryStats } from '@/services/fairValue';
import { OptionType, type SideId } from '../../../shared/tradeEnums.js';
import { VolVerdict, volVerdictLabel, type VolVerdictId } from '../../../shared/analysisEnums.js';
import { OiHistoryTab, type OiHistoryTabId } from '@/utils/uiEnums';
import type { SignalPerformanceSummary, TradeSignalRow } from './types';
import type { StrikeChartData } from './strikeChart';
import { expiryLabel } from './analysis';
import { StrikeOiChart } from './StrikeOiChart';
import { TradeSetupDashboard } from './TradeSetupDashboard';

export interface FairSummary { stats: ExpiryStats | null; realized: number | null; verdict: VolVerdictId | null; spot: number | null }

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const verdictClass = (verdict: VolVerdictId) => (verdict === VolVerdict.OptionsExpensive ? 'rich' : verdict === VolVerdict.OptionsCheap ? 'cheap' : 'fair');

const ToggleButton: React.FC<{ active: boolean; onClick: () => void; title?: string; children: React.ReactNode }> = ({ active, onClick, title, children }) => (
  <button type="button" className={`oi-history__volume-toggle ${active ? 'oi-history__volume-toggle--active' : ''}`} onClick={onClick} aria-pressed={active} title={title}>
    {children}
  </button>
);

/** ATM IV against realised volatility, the verdict, and the straddle's expected move for the fair-value expiry. */
const FairValueSummary: React.FC<{ summary: FairSummary; hasFair: boolean }> = ({ summary, hasFair }) => (
  <div className="oi-history__fair-summary">
    <span className="oi-history__fair-stat">
      <span>ATM IV</span>
      <strong>{summary.stats?.atmIv != null ? percent(summary.stats.atmIv) : '-'}</strong>
    </span>
    <span className="oi-history__fair-stat">
      <span>Realised ({REALIZED_WINDOW}d)</span>
      <strong>{summary.realized !== null ? percent(summary.realized) : '-'}</strong>
    </span>
    {summary.verdict && (
      <span className={`oi-history__fair-verdict oi-history__fair-verdict--${verdictClass(summary.verdict)}`}>{volVerdictLabel(summary.verdict)}</span>
    )}
    <span className="oi-history__fair-stat">
      <span>Expected move</span>
      <strong>
        {summary.stats?.straddle != null
          ? `±${Math.round(summary.stats.straddle)}${summary.spot ? ` (${((summary.stats.straddle / summary.spot) * 100).toFixed(1)}%)` : ''}`
          : '-'}
      </strong>
    </span>
    {hasFair ? (
      <span className="oi-history__fair-note">
        Grey line = price at the expiry&apos;s fitted IV curve; the gap to the price is shaded. Above it is expensive, below is cheap.
      </span>
    ) : (
      <span className="oi-history__fair-note oi-history__fair-note--warn">
        No fair value for this expiry: on these dates fewer than 5 out-of-the-money strikes traded, too few to fit an IV curve. Far-month stock options are often this thin, and their prices go stale.
      </span>
    )}
  </div>
);

export interface StrikeHistoryCardProps {
  strike: number;
  chart: StrikeChartData;
  tab: OiHistoryTabId;
  onTab: (tab: OiHistoryTabId) => void;
  /** The underlying stock's symbol when it has entry & exit zones (null for indices). */
  zonesSymbol: string | null;
  onShowZones: () => void;
  /** Every expiry of the day (the legend) and the ones the table shows. */
  tableExpiries: string[];
  visibleExpiries: string[];
  hiddenExpiries: Set<string>;
  /** The expiries the chart draws, and the one expiry in the fair-value view (null outside it). */
  chartExpiries: string[];
  fairExpiry: string | null;
  isMonthlyExpiry: (expiry: string) => boolean;
  expiryColors: Map<string, string>;
  onToggleExpiry: (expiry: string) => void;
  onPickFairExpiry: (expiry: string) => void;
  showVolume: boolean;
  onShowVolume: (show: boolean) => void;
  showFairValue: boolean;
  onShowFairValue: (show: boolean) => void;
  fairSummary: FairSummary | null;
  filterDate: string;
  signalPerformance: SignalPerformanceSummary | null;
  signalRows: TradeSignalRow[];
  onTrade: (side: SideId) => void;
  onDeleteSignal: (id: number) => void;
}

/** The selected strike's OI and price history (all expiries, or one with its fair value) and its trade setup. */
const StrikeHistoryCard: React.FC<StrikeHistoryCardProps> = (props) => {
  const { strike, chart, tab, fairExpiry, isMonthlyExpiry, expiryColors, showVolume } = props;
  const inFairView = fairExpiry !== null;
  const tabButton = (id: OiHistoryTabId, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={`oi-history__analysis-tab ${tab === id ? 'oi-history__analysis-tab--active' : ''}`}
      onClick={() => props.onTab(id)}
    >
      {label}
    </button>
  );
  const chartProps = { dates: chart.dates, dateMap: chart.dateMap, maxOi: chart.maxOi, expiries: props.chartExpiries, expiryColors, showVolume, showFair: inFairView };

  return (
    <div className="oi-history__chart-wrap card">
      <div className="oi-history__chart-header">
        <span className="oi-history__chart-title">
          Strike {strike}
          {props.zonesSymbol && (
            <button
              type="button"
              className="oi-history__zones-btn"
              onClick={props.onShowZones}
              title={`Entry & exit zones for ${props.zonesSymbol}`}
              aria-label={`Entry and exit zones for ${props.zonesSymbol}`}
            >
              <LevelsIcon size={14} />
            </button>
          )}
        </span>
        <div className="oi-history__chart-controls">
          <div className="oi-history__analysis-tabs" role="tablist" aria-label="OI analysis view">
            {tabButton(OiHistoryTab.History, 'OI Price History')}
            {tabButton(OiHistoryTab.Setup, 'Trade Setup')}
          </div>
        </div>
      </div>

      {tab === OiHistoryTab.History && (
        <>
          <div className="oi-history__chart-pair">
            <StrikeOiChart optionType={OptionType.CE} maxPrice={chart.maxCePrice} {...chartProps} />
            <StrikeOiChart optionType={OptionType.PE} maxPrice={chart.maxPePrice} {...chartProps} />
          </div>

          {/* Legend: toggles expiries, or picks the single expiry in the fair-value view */}
          <div className="oi-history__chart-legend">
            {props.tableExpiries.map((expiry) => {
              const label = expiryLabel(expiry, isMonthlyExpiry(expiry));
              const isOff = inFairView ? expiry !== fairExpiry : props.hiddenExpiries.has(expiry);
              return (
                <button
                  key={expiry}
                  type="button"
                  className={`oi-history__chart-legend-item ${isOff ? 'oi-history__chart-legend-item--hidden' : ''}`}
                  onClick={() => (inFairView ? props.onPickFairExpiry(expiry) : props.onToggleExpiry(expiry))}
                  aria-pressed={!isOff}
                  title={inFairView ? `Show fair value for ${label}` : `${isOff ? 'Show' : 'Hide'} ${label} in table and chart`}
                >
                  <span className="oi-history__chart-legend-swatch" style={{ background: expiryColors.get(expiry) }} />
                  {label}
                </button>
              );
            })}
            {inFairView ? (
              <>
                <span className="oi-history__chart-legend-item"><span className="oi-history__chart-legend-dash" /> Fair value</span>
                <span className="oi-history__chart-legend-item"><span className="oi-history__chart-legend-tick oi-history__chart-legend-tick--rich" /> Expensive</span>
                <span className="oi-history__chart-legend-item"><span className="oi-history__chart-legend-tick oi-history__chart-legend-tick--cheap" /> Cheap</span>
              </>
            ) : (
              <span className="oi-history__chart-legend-item"><span className="oi-history__chart-legend-bar" /> {showVolume ? 'Volume' : 'OI'}</span>
            )}
          </div>

          <div className="oi-history__chart-metric-row">
            {/* In the fair-value view the bars show rich / cheap %, so the bar metric does not apply */}
            {!props.showFairValue && (
              <div className="oi-history__metric-toggle" role="group" aria-label="Chart bar metric">
                <ToggleButton active={!showVolume} onClick={() => props.onShowVolume(false)}>OI</ToggleButton>
                <ToggleButton active={showVolume} onClick={() => props.onShowVolume(true)}>Volume</ToggleButton>
              </div>
            )}
            <div className="oi-history__metric-toggle" role="group" aria-label="Chart view">
              <ToggleButton active={!props.showFairValue} onClick={() => props.onShowFairValue(false)}>All expiries</ToggleButton>
              <ToggleButton active={props.showFairValue} onClick={() => props.onShowFairValue(true)} title="Show one expiry with its fair value from the IV curve">Fair value</ToggleButton>
            </div>
          </div>
          {inFairView && props.fairSummary && <FairValueSummary summary={props.fairSummary} hasFair={chart.hasFair} />}
        </>
      )}

      {tab === OiHistoryTab.Setup && (
        <TradeSetupDashboard
          setup={chart}
          selectedStrike={strike}
          filterDate={props.filterDate}
          expiries={props.visibleExpiries}
          isMonthlyExpiry={isMonthlyExpiry}
          signalPerformance={props.signalPerformance}
          onTrade={props.onTrade}
          signalRows={props.signalRows}
          onDeleteSignal={props.onDeleteSignal}
        />
      )}
    </div>
  );
};

export default StrikeHistoryCard;
