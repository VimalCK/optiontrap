import React, { useMemo, useState, useCallback } from 'react';
import { OptionChainRow } from '@/services/optionChain';
import { OiSnapshot } from '@/services/oiSnapshots';
import { computeSellRecommendations, computeBuyRecommendations, SellRecommendation, BuyRecommendation } from '@/services/sellStrategy';
import { calculateMaxPain, calculatePCR } from '@/services/trapAnalysis';
import { calculateExpectedMove } from '@/services/edgeScore';
import TrapAnalyzer from '@/components/TrapAnalyzer/TrapAnalyzer';
import type { FlowReading } from '@/services/oiFlow';
import '@/styles/sellstrategy.css';
import type { TradingModeId } from '../../../shared/tradeEnums.js';
import { StrategyMode, type StrategyModeId } from '../../../shared/appEnums.js';
import type { ToastColorId } from '@/utils/uiEnums';
import { BUY_BREAKDOWN_LABELS, SELL_BREAKDOWN_LABELS, effectiveMarketData } from './strategySetups';
import { useStrategyTrade } from './useStrategyTrade';
import StrategySummaryBar from './StrategySummaryBar';
import StrategyModeToggle from './StrategyModeToggle';
import RecommendationRow from './RecommendationRow';

interface SellStrategyProps {
  chain: OptionChainRow[];
  oiData: Map<number, number>;
  livePrices: Map<number, number>;
  prevDayOi: Map<number, number>;
  closePrices: Map<number, number>;
  snapshots: OiSnapshot[];
  spotPrice: number;
  daysToExpiry?: number;
  atmStrike?: number;
  orderMode: TradingModeId;
  expiry: string;
  onToast: (text: string, color: ToastColorId) => void;
  mode: StrategyModeId;
  onModeChange: (mode: StrategyModeId) => void;
  volumeData: Map<number, number>;
  avgVolume: number;
  /** IV-based flow per option token, shown in the trap analyzer. */
  flowByToken?: Map<number, FlowReading>;
}

const SellStrategy: React.FC<SellStrategyProps> = ({
  chain,
  oiData,
  livePrices,
  prevDayOi,
  closePrices,
  snapshots,
  spotPrice,
  daysToExpiry,
  atmStrike,
  orderMode,
  expiry,
  onToast,
  mode,
  onModeChange,
  volumeData,
  avgVolume,
  flowByToken,
}) => {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // Build effective data (snapshot fallback for market closed)
  const { effectiveOi, effectivePrices, effectiveSpot } = useMemo(
    () => effectiveMarketData(oiData, livePrices, spotPrice, snapshots),
    [oiData, livePrices, spotPrice, snapshots],
  );

  // Summary metrics — always visible regardless of mode
  const maxPain = useMemo(() => calculateMaxPain(chain, effectiveOi), [chain, effectiveOi]);
  const pcr = useMemo(() => calculatePCR(chain, effectiveOi), [chain, effectiveOi]);
  const expectedMove = useMemo(() => calculateExpectedMove(chain, atmStrike ?? 0, effectivePrices), [chain, atmStrike, effectivePrices]);

  const sellRecs = useMemo(
    () => computeSellRecommendations(chain, effectiveOi, effectivePrices, prevDayOi, closePrices, snapshots, effectiveSpot, daysToExpiry, atmStrike, volumeData, avgVolume),
    [chain, effectiveOi, effectivePrices, prevDayOi, closePrices, snapshots, effectiveSpot, daysToExpiry, atmStrike, volumeData, avgVolume],
  );

  const buyRecs = useMemo(
    () => computeBuyRecommendations(chain, effectiveOi, effectivePrices, prevDayOi, closePrices, snapshots, effectiveSpot, daysToExpiry, atmStrike, volumeData, avgVolume),
    [chain, effectiveOi, effectivePrices, prevDayOi, closePrices, snapshots, effectiveSpot, daysToExpiry, atmStrike, volumeData, avgVolume],
  );

  const handleTrade = useStrategyTrade({ chain, effectivePrices, orderMode, expiry, mode, onToast });

  const handleModeChange = useCallback((newMode: StrategyModeId) => {
    onModeChange(newMode);
    setExpandedIdx(null);
  }, [onModeChange]);

  const recommendations: (SellRecommendation | BuyRecommendation)[] = mode === StrategyMode.Sell ? sellRecs : buyRecs;
  const breakdownLabels = mode === StrategyMode.Sell ? SELL_BREAKDOWN_LABELS : BUY_BREAKDOWN_LABELS;

  const summaryBar = <StrategySummaryBar maxPain={maxPain} pcr={pcr} spot={effectiveSpot} expectedMove={expectedMove} />;
  const toggle = <StrategyModeToggle mode={mode} onChange={handleModeChange} />;

  if (snapshots.length < 2 && oiData.size === 0) {
    return (
      <div className="sell-strategy">
        {summaryBar}
        {toggle}
        {mode === StrategyMode.Analyzer ? (
          <TrapAnalyzer
            chain={chain}
            oiData={effectiveOi}
            prevDayOi={prevDayOi}
            closePrices={closePrices}
            livePrices={effectivePrices}
            spotPrice={effectiveSpot}
            atmStrike={atmStrike ?? 0}
            daysToExpiry={daysToExpiry}
            maxPain={maxPain}
            expectedMove={expectedMove}
            flowByToken={flowByToken}
          />
        ) : (
          <div className="sell-strategy__empty">
            Waiting for market data — need at least 20 minutes of OI snapshots to generate recommendations.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="sell-strategy">
      {summaryBar}
      {toggle}

      {mode === StrategyMode.Analyzer ? (
        <TrapAnalyzer
          chain={chain}
          oiData={effectiveOi}
          prevDayOi={prevDayOi}
          closePrices={closePrices}
          livePrices={effectivePrices}
          spotPrice={effectiveSpot}
          atmStrike={atmStrike ?? 0}
          daysToExpiry={daysToExpiry}
          maxPain={maxPain}
          expectedMove={expectedMove}
          flowByToken={flowByToken}
        />
      ) : recommendations.length === 0 ? (
        <div className="sell-strategy__empty">
          No {mode.toLowerCase()} opportunities detected — all strikes scored below threshold.
        </div>
      ) : (
        <div className="sell-strategy__list">
          {recommendations.map((rec, idx) => (
            <RecommendationRow
              key={`${rec.type}-${rec.strikes.join('-')}`}
              rec={rec}
              mode={mode}
              orderMode={orderMode}
              expiry={expiry}
              breakdownLabels={breakdownLabels}
              expanded={expandedIdx === idx}
              onToggle={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              onTrade={handleTrade}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default SellStrategy;
