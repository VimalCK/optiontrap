import React from 'react';
import { formatNumericDate } from '@/utils/marketStatus';
import type { OptionMomentumSide, PremiumDecaySide, SellingSetupSummary, SignalPerformanceSummary, TradeSetupData, TradeSetupSummary, TradeSignalRow } from './types';
import { expiryLabel } from './expiries';
import { OptionType, Side, type SideId } from '../../../shared/tradeEnums.js';
import { Bias, SellingSetup, TradeSetupStatus, sellingSetupLabel } from '../../../shared/analysisEnums.js';
import { SetupModeCard } from './SetupModeCard';
import { SetupSidesSummary, type SetupSideReading } from './SetupSidesSummary';
import { SignalPerformancePanel } from './SignalPerformancePanel';
import { SetupEvidenceDrawer } from './SetupEvidenceDrawer';

interface TradeSetupDashboardProps {
  setup: TradeSetupData;
  selectedStrike: number | null;
  filterDate: string;
  expiries: string[];
  isMonthlyExpiry: (expiry: string) => boolean;
  signalPerformance: SignalPerformanceSummary | null;
  signalRows: TradeSignalRow[];
  onDeleteSignal?: (id: number) => void;
  onTrade: (side: SideId) => void;
}

/** Rising premium suits a buyer. */
const momentumReading = (side: OptionMomentumSide | null): SetupSideReading | null => side && {
  changePct: side.momentumPct,
  favourable: side.momentumPct >= 0,
  statusText: side.momentumPct >= 0 ? 'Momentum up' : 'Momentum down',
  oiChangePct: side.oiChangePct,
  latestVolume: side.latestVolume,
  daysToExpiry: side.daysToExpiry,
};

/** Falling premium suits a seller. */
const decayReading = (side: PremiumDecaySide | null): SetupSideReading | null => side && {
  changePct: side.decayPct,
  favourable: side.decayPct <= 0,
  statusText: side.decayPct <= 0 ? 'Decay active' : 'Premium rising',
  oiChangePct: side.oiChangePct,
  latestVolume: side.latestVolume,
  daysToExpiry: side.daysToExpiry,
};

const buyTrade = (setup: TradeSetupSummary) => (
  setup.status !== TradeSetupStatus.Avoid && (setup.direction === Bias.Bullish || setup.direction === Bias.Bearish)
    ? { side: Side.BUY, label: `Buy ${setup.direction === Bias.Bullish ? OptionType.CE : OptionType.PE}` }
    : null
);

const sellTrade = (setup: SellingSetupSummary) => (
  setup.status !== TradeSetupStatus.Avoid && (setup.type === SellingSetup.CallSell || setup.type === SellingSetup.PutSell)
    ? { side: Side.SELL, label: `Sell ${setup.type === SellingSetup.CallSell ? OptionType.CE : OptionType.PE}` }
    : null
);

export const TradeSetupDashboard: React.FC<TradeSetupDashboardProps> = ({
  setup,
  selectedStrike,
  filterDate,
  expiries,
  isMonthlyExpiry,
  signalPerformance,
  signalRows,
  onDeleteSignal,
  onTrade,
}) => {
  const expiryText = (expiry: string | null) => (expiry ? expiryLabel(expiry, isMonthlyExpiry(expiry)) : 'Unavailable');
  return (
    <div className={`oi-history__setup-dashboard oi-history__setup-dashboard--${setup.tradeSetup.status.toLowerCase()}`}>
      <div className="oi-history__setup-titlebar">
        <div>
          <span>TRADE SETUP</span>
          <h3>Decision dashboard</h3>
          <p>One view for buying momentum, selling decay, and the conditions that invalidate each idea.</p>
        </div>
        <div className="oi-history__setup-titlebar-meta">
          <strong>{selectedStrike ?? '-'} STRIKE</strong>
          <span>{formatNumericDate(filterDate)} · {expiries.length} expiry{expiries.length === 1 ? '' : 'ies'}</span>
        </div>
      </div>
      <div className="oi-history__setup-choice-grid">
        <SetupModeCard
          title="Option Buying Trade"
          setupName={setup.tradeSetup.direction}
          meterLabel="Buying setup"
          setup={setup.tradeSetup}
          summary={(
            <SetupSidesSummary
              title="Nearest-expiry momentum"
              expiryText={expiryText(setup.optionMomentum.nearestExpiry)}
              tag="Buying pressure"
              sides={{ [OptionType.CE]: momentumReading(setup.optionMomentum.ce), [OptionType.PE]: momentumReading(setup.optionMomentum.pe) }}
            />
          )}
          approach={{ label: 'Strategy', value: setup.tradeSetup.strategy }}
          trade={buyTrade(setup.tradeSetup)}
          onTrade={onTrade}
        />
        <SetupModeCard
          title="Option Selling Trade"
          setupName={sellingSetupLabel(setup.sellingSetup.type)}
          meterLabel="Selling setup"
          setup={setup.sellingSetup}
          summary={(
            <SetupSidesSummary
              title="Nearest-expiry decay monitor"
              expiryText={expiryText(setup.premiumDecay.nearestExpiry)}
              tag="Time decay"
              className="oi-history__decay-monitor"
              sides={{ [OptionType.CE]: decayReading(setup.premiumDecay.ce), [OptionType.PE]: decayReading(setup.premiumDecay.pe) }}
            />
          )}
          approach={{
            label: 'Structure',
            value: setup.sellingSetup.type === SellingSetup.NoSell ? 'Wait for support/resistance setup' : 'Prefer defined-risk credit spread',
          }}
          trade={sellTrade(setup.sellingSetup)}
          onTrade={onTrade}
        />
      </div>

      {signalPerformance && <SignalPerformancePanel signalPerformance={signalPerformance} signalRows={signalRows} onDeleteSignal={onDeleteSignal} />}

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

      <SetupEvidenceDrawer setup={setup} expiries={expiries} isMonthlyExpiry={isMonthlyExpiry} />
    </div>
  );
};
