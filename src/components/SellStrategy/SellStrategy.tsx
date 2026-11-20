import React, { useMemo, useState, useCallback } from 'react';
import { OptionChainRow } from '@/services/optionChain';
import { OiSnapshot } from '@/services/oiSnapshots';
import { autoPickOf, computeSellRecommendations, computeBuyRecommendations, rankSetups, setupOverview } from '@/services/sellStrategy';
import { calculateMaxPain, calculatePCR } from '@/services/trapAnalysis';
import { calculateExpectedMove } from '@/services/edgeScore';
import TrapAnalyzer from '@/components/TrapAnalyzer/TrapAnalyzer';
import type { FlowReading } from '@/services/oiFlow';
import '@/styles/sellstrategy.css';
import { Side, type TradingModeId } from '../../../shared/tradeEnums.js';
import { StrategyMode, type StrategyModeId } from '../../../shared/appEnums.js';
import type { ToastColorId } from '@/utils/uiEnums';
import { effectiveMarketData, type StrategySetup } from './strategySetups';
import { useStrategyTrade } from './useStrategyTrade';
import StrategySummaryBar from './StrategySummaryBar';
import StrategyModeToggle from './StrategyModeToggle';
import RecommendationRow from './RecommendationRow';

/** How many setups a tab lists. */
const SHOWN_SETUPS = 5;

/** Which sides' missing setups each tab explains. */
const GAP_SIDES: Partial<Record<StrategyModeId, string[]>> = {
  [StrategyMode.Best]: [Side.SELL, Side.BUY],
  [StrategyMode.Sell]: [Side.SELL],
  [StrategyMode.Buy]: [Side.BUY],
};

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
  /** Whether `expiry` is the nearest one, the expiry the Option Analyzer setups automation trades. */
  nearestExpiry: boolean;
  onToast: (text: string, color: ToastColorId) => void;
  mode: StrategyModeId;
  onModeChange: (mode: StrategyModeId) => void;
  volumeData: Map<number, number>;
  avgVolume: number;
  /** IV-based flow per option token, shown in the trap analyzer. */
  flowByToken?: Map<number, FlowReading>;
}

/** The setups a tab lists, best first. */
function setupsFor(mode: StrategyModeId, ranked: StrategySetup[], sell: StrategySetup[], buy: StrategySetup[]): StrategySetup[] {
  if (mode === StrategyMode.Best) return ranked.slice(0, SHOWN_SETUPS);
  return mode === StrategyMode.Sell ? sell : buy;
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
  nearestExpiry,
  onToast,
  mode,
  onModeChange,
  volumeData,
  avgVolume,
  flowByToken,
}) => {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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
    () => computeSellRecommendations(chain, effectiveOi, effectivePrices, prevDayOi, closePrices, snapshots, effectiveSpot, { now: new Date(), expiry }, atmStrike, volumeData, avgVolume),
    [chain, effectiveOi, effectivePrices, prevDayOi, closePrices, snapshots, effectiveSpot, expiry, atmStrike, volumeData, avgVolume],
  );

  const buyRecs = useMemo(
    () => computeBuyRecommendations(chain, effectiveOi, effectivePrices, prevDayOi, closePrices, snapshots, effectiveSpot, { now: new Date(), expiry }, atmStrike, volumeData, avgVolume),
    [chain, effectiveOi, effectivePrices, prevDayOi, closePrices, snapshots, effectiveSpot, expiry, atmStrike, volumeData, avgVolume],
  );

  const overview = useMemo(
    () => setupOverview(chain, effectiveOi, effectivePrices, snapshots, effectiveSpot, { now: new Date(), expiry }, atmStrike),
    [chain, effectiveOi, effectivePrices, snapshots, effectiveSpot, expiry, atmStrike],
  );

  const ranked = useMemo<StrategySetup[]>(() => rankSetups<StrategySetup>(sellRecs, buyRecs), [sellRecs, buyRecs]);
  const autoPick = nearestExpiry ? autoPickOf(ranked) : null;

  const handleTrade = useStrategyTrade({ chain, effectivePrices, orderMode, expiry, onToast });

  const handleModeChange = useCallback((newMode: StrategyModeId) => {
    onModeChange(newMode);
    setExpandedKey(null);
  }, [onModeChange]);

  const recommendations = setupsFor(mode, ranked, sellRecs, buyRecs);
  const gapSides = GAP_SIDES[mode] ?? [];
  const gaps = overview.gaps.filter((gap) => gapSides.includes(gap.side));

  const featured = recommendations.find((rec) => rec === autoPick) ?? recommendations[0];
  const others = recommendations.filter((rec) => rec !== featured);

  const summaryBar = (
    <StrategySummaryBar maxPain={maxPain} pcr={pcr} spot={effectiveSpot} expectedMove={expectedMove} day={overview.day} />
  );
  const toggle = (
    <div className="sell-strategy__tabs">
      <StrategyModeToggle mode={mode} onChange={handleModeChange} />
      {gaps.length > 0 && (
        <ul className="sell-strategy__gaps">
          {gaps.map((gap) => <li key={gap.text} className="sell-strategy__gap" title={gap.detail}>{gap.text}</li>)}
        </ul>
      )}
    </div>
  );
  const rowOf = (rec: StrategySetup, isFeatured: boolean) => {
    const key = `${rec.type}-${rec.strikes.join('-')}`;
    return (
      <RecommendationRow
        key={key}
        rec={rec}
        spot={effectiveSpot}
        orderMode={orderMode}
        expiry={expiry}
        featured={isFeatured}
        autoPick={rec === autoPick}
        expanded={expandedKey === key}
        onToggle={() => setExpandedKey(expandedKey === key ? null : key)}
        onTrade={handleTrade}
      />
    );
  };
  const trapAnalyzer = (
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
  );

  if (snapshots.length < 2 && oiData.size === 0) {
    return (
      <div className="sell-strategy">
        {summaryBar}
        {toggle}
        {mode === StrategyMode.Analyzer ? trapAnalyzer : (
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

      {mode === StrategyMode.Analyzer ? trapAnalyzer : recommendations.length === 0 ? (
        <div className="sell-strategy__empty">
          No {mode === StrategyMode.Best ? '' : `${mode.toLowerCase()} `}opportunities detected — all strikes scored below threshold.
        </div>
      ) : (
        <div className="sell-strategy__list">
          {featured && rowOf(featured, true)}
          {others.map((rec) => rowOf(rec, false))}
        </div>
      )}
    </div>
  );
};

export default SellStrategy;
