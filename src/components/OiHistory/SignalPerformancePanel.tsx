import React from 'react';
import type { SignalPerformanceSummary, TradeSignalRow } from './types';
import { SignalBreakdownTable } from './SignalBreakdownTable';
import { SignalResultsGrid } from './SignalResultsGrid';

export const SignalPerformancePanel: React.FC<{ signalPerformance: SignalPerformanceSummary; signalRows: TradeSignalRow[]; onDeleteSignal?: (id: number) => void }> = ({ signalPerformance, signalRows, onDeleteSignal }) => (
  <div className="oi-history__signal-performance oi-history__signal-performance--dashboard">
    <div className="oi-history__signal-performance-head">
      <span>Recorded setup performance</span>
      <strong>{signalPerformance.total} signals · {signalPerformance.open} open · {signalPerformance.evaluated} evaluated</strong>
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
    <div className="oi-history__signal-quality">
      <span>Avg win <strong>{signalPerformance.averageWin === null ? '-' : `+${signalPerformance.averageWin.toFixed(1)}%`}</strong></span>
      <span>Avg loss <strong>{signalPerformance.averageLoss === null ? '-' : `${signalPerformance.averageLoss.toFixed(1)}%`}</strong></span>
      <span>Profit factor <strong>{signalPerformance.profitFactor === null ? '-' : signalPerformance.profitFactor === Infinity ? '∞' : signalPerformance.profitFactor.toFixed(2)}</strong></span>
    </div>
    {signalRows.length > 0 && <SignalBreakdownTable signals={signalRows} />}
    {signalRows.length > 0 && <SignalResultsGrid rows={signalRows} onDelete={onDeleteSignal} />}
  </div>
);
