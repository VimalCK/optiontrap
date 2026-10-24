import React from 'react';
import type { SignalPerformanceSummary, TradeSetupData } from './types';
import { formatPct, formatPcr } from './helpers';
import { checklistStatusText, sortChecklistByStatus, readinessScore, setupReadinessLabel, setupReadinessWidth, expiryLabel } from './analysis';

interface TradeSetupDashboardProps {
  setup: TradeSetupData;
  selectedStrike: number | null;
  filterDate: string;
  expiries: string[];
  isMonthlyExpiry: (expiry: string) => boolean;
  signalPerformance: SignalPerformanceSummary | null;
  onTrade: (mode: 'buy' | 'sell') => void;
  onExport: () => void;
}

/** Recorded signal outcomes for the scrip: win rate, returns and Excel export. */
const SignalPerformancePanel: React.FC<{ signalPerformance: SignalPerformanceSummary; onExport: () => void }> = ({ signalPerformance, onExport }) => (
  <div className="oi-history__signal-performance oi-history__signal-performance--dashboard">
    <div className="oi-history__signal-performance-head">
      <span>Recorded setup performance</span>
      <div>
        <strong>{signalPerformance.total} signals · {signalPerformance.open} open · {signalPerformance.evaluated} evaluated</strong>
        <button type="button" className="oi-history__signal-export" onClick={onExport}>Export Excel</button>
      </div>
    </div>
    <div className={`oi-history__signal-confidence ${signalPerformance.evaluated >= 20 ? 'is-ready' : ''}`}>
      {signalPerformance.evaluated >= 20
        ? 'Performance sample is large enough for an initial review.'
        : signalPerformance.open > 0
          ? `${signalPerformance.open} signal${signalPerformance.open === 1 ? '' : 's'} remain open; current return is provisional until expiry.`
          : `Preliminary sample: ${Math.max(0, 20 - signalPerformance.evaluated)} more evaluated signals needed before trusting the percentages.`}
    </div>
    <div className="oi-history__signal-performance-grid">
      <span>Open <strong>{signalPerformance.open}</strong></span>
      <span>Current open avg <strong>{signalPerformance.averageOpenReturn === null ? '-' : `${signalPerformance.averageOpenReturn >= 0 ? '+' : ''}${signalPerformance.averageOpenReturn.toFixed(1)}%`}</strong></span>
      <span>Win rate <strong>{signalPerformance.winRate === null ? '-' : `${signalPerformance.winRate.toFixed(0)}%`}</strong></span>
      <span>Avg return <strong>{signalPerformance.averageReturn === null ? '-' : `${signalPerformance.averageReturn >= 0 ? '+' : ''}${signalPerformance.averageReturn.toFixed(1)}%`}</strong></span>
      <span>Avg best move <strong>{signalPerformance.averageMaxFavorable === null ? '-' : `+${signalPerformance.averageMaxFavorable.toFixed(1)}%`}</strong></span>
      <span>Avg worst move <strong>{signalPerformance.averageMaxAdverse === null ? '-' : `${signalPerformance.averageMaxAdverse.toFixed(1)}%`}</strong></span>
      <span>Sell <strong>{signalPerformance.sellWinRate === null ? '-' : `${signalPerformance.sellWinRate.toFixed(0)}% (${signalPerformance.sellEvaluated})`}</strong></span>
      <span>Buy <strong>{signalPerformance.buyWinRate === null ? '-' : `${signalPerformance.buyWinRate.toFixed(0)}% (${signalPerformance.buyEvaluated})`}</strong></span>
    </div>
    <div className="oi-history__signal-breakdown">
      {signalPerformance.optionBreakdown.map((item) => (
        <span key={item.label}>
          {item.label}
          <strong>{item.winRate === null ? '-' : `${item.winRate.toFixed(0)}%`}</strong>
          <small>{item.evaluated} evaluated{item.averageReturn === null ? '' : ` · ${item.averageReturn >= 0 ? '+' : ''}${item.averageReturn.toFixed(1)}% avg`}</small>
        </span>
      ))}
    </div>
    <div className="oi-history__signal-quality">
      <span>Avg win <strong>{signalPerformance.averageWin === null ? '-' : `+${signalPerformance.averageWin.toFixed(1)}%`}</strong></span>
      <span>Avg loss <strong>{signalPerformance.averageLoss === null ? '-' : `${signalPerformance.averageLoss.toFixed(1)}%`}</strong></span>
      <span>Profit factor <strong>{signalPerformance.profitFactor === null ? '-' : signalPerformance.profitFactor === Infinity ? '∞' : signalPerformance.profitFactor.toFixed(2)}</strong></span>
    </div>
  </div>
);

/** Trade Setup tab: buying and selling setups for the selected strike, with evidence. */
export const TradeSetupDashboard: React.FC<TradeSetupDashboardProps> = ({
  setup,
  selectedStrike,
  filterDate,
  expiries,
  isMonthlyExpiry,
  signalPerformance,
  onTrade,
  onExport,
}) => (
  <div className={`oi-history__setup-dashboard oi-history__setup-dashboard--${setup.tradeSetup.status.toLowerCase()}`}>
    <div className="oi-history__setup-titlebar">
      <div>
        <span>TRADE SETUP</span>
        <h3>Decision dashboard</h3>
        <p>One view for buying momentum, selling decay, and the conditions that invalidate each idea.</p>
      </div>
      <div className="oi-history__setup-titlebar-meta">
        <strong>{selectedStrike ?? '-'} STRIKE</strong>
        <span>{filterDate} · {expiries.length} expiry{expiries.length === 1 ? '' : 'ies'}</span>
      </div>
    </div>
    <div className="oi-history__setup-choice-grid">
      <div className={`oi-history__setup-mode-card oi-history__setup-mode-card--${setup.tradeSetup.status.toLowerCase()}`}>
        <div className="oi-history__setup-mode-card-head">
          <span>Option Buying Trade</span>
          <strong>{setup.tradeSetup.direction} {setup.tradeSetup.status === 'Avoid' ? 'No Trade' : setup.tradeSetup.status}</strong>
        </div>
        <div className="oi-history__readiness-meter">
          <span>Buying setup</span>
          <strong>{setupReadinessLabel(setup.tradeSetup.status, readinessScore(setup.tradeSetup.checklist))}</strong>
          <div><span style={{ width: setupReadinessWidth(setup.tradeSetup.status, readinessScore(setup.tradeSetup.checklist)) }} /></div>
        </div>
        <p>{setup.tradeSetup.action}</p>
        <div className="oi-history__buying-summary">
          <div className="oi-history__buying-summary-head">
            <div>
              <span>Nearest-expiry momentum</span>
              <strong>{setup.optionMomentum.nearestExpiry ? expiryLabel(setup.optionMomentum.nearestExpiry, isMonthlyExpiry(setup.optionMomentum.nearestExpiry)) : 'Unavailable'}</strong>
            </div>
            <em>Buying pressure</em>
          </div>
          <div className="oi-history__buying-summary-grid">
            {(['CE', 'PE'] as const).map((optionType) => {
              const side = optionType === 'CE' ? setup.optionMomentum.ce : setup.optionMomentum.pe;
              return (
                <div key={optionType} className="oi-history__buying-summary-side">
                  <div className="oi-history__buying-summary-side-head">
                    <strong>{optionType}</strong>
                    <span>{side ? (side.momentumPct >= 0 ? 'Momentum up' : 'Momentum down') : 'No history'}</span>
                  </div>
                  <div className={`oi-history__buying-summary-value ${side && side.momentumPct >= 0 ? 'is-positive' : 'is-negative'}`}>
                    <strong>{side ? formatPct(side.momentumPct) : '-'}</strong>
                    <small>premium change</small>
                  </div>
                  <div className="oi-history__buying-summary-metrics">
                    <span>OI <b>{side ? formatPct(side.oiChangePct) : '-'}</b></span>
                    <span>Vol <b>{side && side.latestVolume > 0 ? side.latestVolume.toLocaleString('en-IN') : '-'}</b></span>
                    <span>DTE <b>{side?.daysToExpiry ?? '-'}</b></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="oi-history__setup-primary-action">
          <span>Strategy</span>
          <strong>{setup.tradeSetup.strategy}</strong>
        </div>
        <div className="oi-history__setup-mini-plan">
          <div>
            <span>Trigger</span>
            <strong>{setup.tradeSetup.trigger}</strong>
          </div>
          <div>
            <span>Stop</span>
            <strong>{setup.tradeSetup.invalidation}</strong>
          </div>
          <div>
            <span>Target</span>
            <strong>{setup.tradeSetup.target}</strong>
          </div>
        </div>
        {setup.tradeSetup.status !== 'Avoid' &&
          (setup.tradeSetup.direction === 'Bullish' || setup.tradeSetup.direction === 'Bearish') && (
          <button
            type="button"
            className="oi-history__setup-trade-btn oi-history__setup-trade-btn--buy"
            onClick={() => onTrade('buy')}
          >
            Buy {setup.tradeSetup.direction === 'Bullish' ? 'CE' : 'PE'}
          </button>
        )}
      </div>

      <div className={`oi-history__setup-mode-card oi-history__setup-mode-card--${setup.sellingSetup.status.toLowerCase()}`}>
        <div className="oi-history__setup-mode-card-head">
          <span>Option Selling Trade</span>
          <strong>{setup.sellingSetup.type} {setup.sellingSetup.status === 'Avoid' ? 'No Trade' : setup.sellingSetup.status}</strong>
        </div>
        <div className="oi-history__readiness-meter">
          <span>Selling setup</span>
          <strong>{setupReadinessLabel(setup.sellingSetup.status, readinessScore(setup.sellingSetup.checklist))}</strong>
          <div><span style={{ width: setupReadinessWidth(setup.sellingSetup.status, readinessScore(setup.sellingSetup.checklist)) }} /></div>
        </div>
        <p>{setup.sellingSetup.action}</p>
        <div className="oi-history__buying-summary oi-history__decay-monitor">
          <div className="oi-history__buying-summary-head">
            <div>
              <span>Nearest-expiry decay monitor</span>
              <strong>{setup.premiumDecay.nearestExpiry ? expiryLabel(setup.premiumDecay.nearestExpiry, isMonthlyExpiry(setup.premiumDecay.nearestExpiry)) : 'Unavailable'}</strong>
            </div>
            <em>Time decay</em>
          </div>
          <div className="oi-history__buying-summary-grid">
            {(['CE', 'PE'] as const).map((optionType) => {
              const side = optionType === 'CE' ? setup.premiumDecay.ce : setup.premiumDecay.pe;
              return (
                <div key={optionType} className="oi-history__buying-summary-side">
                  <div className="oi-history__buying-summary-side-head">
                    <strong>{optionType}</strong>
                    <span>{side ? (side.decayPct <= 0 ? 'Decay active' : 'Premium rising') : 'No history'}</span>
                  </div>
                  <div className={`oi-history__buying-summary-value ${side && side.decayPct <= 0 ? 'is-positive' : 'is-negative'}`}>
                    <strong>{side ? formatPct(side.decayPct) : '-'}</strong>
                    <small>premium change</small>
                  </div>
                  <div className="oi-history__buying-summary-metrics">
                    <span>OI <b>{side ? formatPct(side.oiChangePct) : '-'}</b></span>
                    <span>Vol <b>{side && side.latestVolume > 0 ? side.latestVolume.toLocaleString('en-IN') : '-'}</b></span>
                    <span>DTE <b>{side?.daysToExpiry ?? '-'}</b></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="oi-history__setup-primary-action">
          <span>Structure</span>
          <strong>{setup.sellingSetup.type === 'No Sell' ? 'Wait for support/resistance setup' : 'Prefer defined-risk credit spread'}</strong>
        </div>
        <div className="oi-history__setup-mini-plan">
          <div>
            <span>Trigger</span>
            <strong>{setup.sellingSetup.trigger}</strong>
          </div>
          <div>
            <span>Stop</span>
            <strong>{setup.sellingSetup.invalidation}</strong>
          </div>
          <div>
            <span>Target</span>
            <strong>{setup.sellingSetup.target}</strong>
          </div>
        </div>
        {setup.sellingSetup.status !== 'Avoid' &&
          (setup.sellingSetup.type === 'Call Sell' || setup.sellingSetup.type === 'Put Sell') && (
          <button
            type="button"
            className="oi-history__setup-trade-btn oi-history__setup-trade-btn--sell"
            onClick={() => onTrade('sell')}
          >
            Sell {setup.sellingSetup.type === 'Call Sell' ? 'CE' : 'PE'}
          </button>
        )}
      </div>
    </div>

    {signalPerformance && <SignalPerformancePanel signalPerformance={signalPerformance} onExport={onExport} />}

    <div className="oi-history__market-context" aria-label="Market context">
      <span className="oi-history__market-context-title">Market context</span>
      <div className="oi-history__market-context-items">
        <span><small>Price</small><strong>{setup.priceTrend.direction}</strong></span>
        <span><small>Flow</small><strong>{setup.biasSummary.bias} · {setup.biasSummary.strength}</strong></span>
        <span><small>Support</small><strong>{setup.tradeLevels.supportStrike ?? '-'}</strong></span>
        <span><small>Spot</small><strong>{setup.tradeLevels.spot !== null ? setup.tradeLevels.spot.toFixed(2) : '-'}</strong></span>
        <span><small>Resistance</small><strong>{setup.tradeLevels.resistanceStrike ?? '-'}</strong></span>
        <span><small>Max OI</small><strong>{setup.tradeLevels.maxOiStrike ?? '-'}</strong></span>
      </div>
    </div>

    <details className="oi-history__setup-detail-drawer">
      <summary>
        <span>Why this setup?</span>
        <em>Evidence, risk checks, and market context</em>
      </summary>
      <div className="oi-history__setup-evidence-grid">
        <div className="oi-history__setup-detail-section oi-history__setup-detail-section--buying">
          <div className="oi-history__setup-section-heading">
            <span>Option buying</span>
            <strong>{setupReadinessLabel(setup.tradeSetup.status, readinessScore(setup.tradeSetup.checklist))}</strong>
          </div>
        <div className="oi-history__setup-signal-strip">
          {sortChecklistByStatus(setup.tradeSetup.checklist).map((item) => (
            <div key={item.label} className={`oi-history__signal-tile oi-history__signal-tile--${item.status}`}>
              <span>{item.label}</span>
              <strong>{checklistStatusText(item.status)}</strong>
              <em>{item.answer}</em>
            </div>
          ))}
        </div>
        </div>
        <div className="oi-history__setup-detail-section oi-history__setup-detail-section--selling">
          <div className="oi-history__setup-section-heading">
            <span>Option selling</span>
            <strong>{setupReadinessLabel(setup.sellingSetup.status, readinessScore(setup.sellingSetup.checklist))}</strong>
          </div>
        <div className="oi-history__setup-signal-strip">
          {sortChecklistByStatus(setup.sellingSetup.checklist).map((item) => (
            <div key={item.label} className={`oi-history__signal-tile oi-history__signal-tile--${item.status}`}>
              <span>{item.label}</span>
              <strong>{checklistStatusText(item.status)}</strong>
              <em>{item.answer}</em>
            </div>
          ))}
        </div>
        </div>
      </div>
      <div className="oi-history__setup-context">
        <div className={`oi-history__setup-context-item oi-history__setup-context-item--${setup.tradeBias.bias.toLowerCase()}`}>
          <span>Trade bias</span>
          <strong>{setup.tradeBias.title}</strong>
          <em>{setup.tradeBias.action} {setup.tradeBias.reason}</em>
        </div>
        <div className={`oi-history__setup-context-item oi-history__setup-context-item--${setup.priceTrend.direction.toLowerCase()}`}>
          <span>Price trend</span>
          <strong>{setup.priceTrend.direction} - {setup.priceTrend.strength}</strong>
          <em>
            {setup.priceTrend.reason} Start {setup.priceTrend.startPrice !== null ? setup.priceTrend.startPrice.toFixed(2) : '-'} | End {setup.priceTrend.endPrice !== null ? setup.priceTrend.endPrice.toFixed(2) : '-'} | Change {formatPct(setup.priceTrend.changePct)} | Recent {formatPct(setup.priceTrend.recentChangePct)} | Sessions {setup.priceTrend.sessions}
          </em>
        </div>
        <div className={`oi-history__setup-context-item oi-history__setup-context-item--${setup.biasSummary.bias.toLowerCase()}`}>
          <span>Option flow</span>
          <strong>{setup.biasSummary.bias} - {setup.biasSummary.strength}</strong>
          <em>
            {setup.biasSummary.reason} Confidence {setup.biasSummary.confidence}% | Days {setup.biasSummary.bullishDays}/{setup.biasSummary.bearishDays}/{setup.biasSummary.neutralDays} | CE OI {formatPct(setup.biasSummary.ceOiChangePct)} | PE OI {formatPct(setup.biasSummary.peOiChangePct)} | PCR {formatPcr(setup.biasSummary.pcrStart)} -&gt; {formatPcr(setup.biasSummary.pcrEnd)} | Score {setup.biasSummary.score}
          </em>
        </div>
      </div>
      <div className="oi-history__setup-details">
        <div>
          <span>Recent 3-session lean</span>
          <strong className={`oi-history__bias-text--${setup.biasSummary.recentBias.toLowerCase()}`}>
            {setup.biasSummary.recentBias} ({setup.biasSummary.recentScore > 0 ? '+' : ''}{setup.biasSummary.recentScore})
          </strong>
        </div>
        <div>
          <span>Main driver</span>
          <strong>{setup.biasSummary.driver}</strong>
        </div>
        <div>
          <span>Visible expiries</span>
          <strong>{expiries.map((exp) => expiryLabel(exp, isMonthlyExpiry(exp))).join(', ')}</strong>
        </div>
        {setup.biasSummary.warning && (
          <div className="oi-history__bias-warning">
            <span>Watch</span>
            <strong>{setup.biasSummary.warning}</strong>
          </div>
        )}
      </div>
    </details>
  </div>
);
