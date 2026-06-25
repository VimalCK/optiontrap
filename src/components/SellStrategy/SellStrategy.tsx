import React, { useMemo, useState, useCallback } from 'react';
import { OptionChainRow } from '@/services/optionChain';
import { OiSnapshot } from '@/services/oiSnapshots';
import {
  computeSellRecommendations,
  computeBuyRecommendations,
  SellRecommendation,
  BuyRecommendation,
  BuyScoreBreakdown,
  ScoreBreakdown,
} from '@/services/sellStrategy';
import { calculateMaxPain, calculatePCR } from '@/services/trapAnalysis';
import { calculateExpectedMove } from '@/services/edgeScore';
import { addPosition } from '@/services/positions';
import TrapAnalyzer from '@/components/TrapAnalyzer/TrapAnalyzer';
import '@/styles/sellstrategy.css';

export type StrategyMode = 'sell' | 'buy' | 'analyzer';

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
  orderMode: 'paper' | 'live';
  expiry: string;
  onToast: (text: string, color: 'green' | 'red') => void;
  mode: StrategyMode;
  onModeChange: (mode: StrategyMode) => void;
}

function scoreColorClass(score: number): string {
  if (score >= 80) return 'very-high';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

function sellBadgeLabel(type: SellRecommendation['type']): string {
  switch (type) {
    case 'sell-ce': return 'Sell CE';
    case 'sell-pe': return 'Sell PE';
    case 'sell-straddle': return 'Straddle';
    case 'sell-strangle': return 'Strangle';
  }
}

function buyBadgeLabel(type: BuyRecommendation['type']): string {
  switch (type) {
    case 'buy-ce': return 'Buy CE';
    case 'buy-pe': return 'Buy PE';
    case 'buy-straddle': return 'Straddle';
    case 'buy-strangle': return 'Strangle';
  }
}

function strikeLabel(strikes: number[]): string {
  if (strikes.length === 2) return `${strikes[0]} / ${strikes[1]}`;
  return String(strikes[0]);
}

function actionBtnClass(type: string): string {
  if (type.includes('ce') || type === 'sell-ce' || type === 'buy-ce') return 'ce';
  if (type.includes('pe') || type === 'sell-pe' || type === 'buy-pe') return 'pe';
  if (type.includes('straddle')) return 'straddle';
  if (type.includes('strangle')) return 'strangle';
  return 'ce';
}

const SELL_BREAKDOWN_LABELS: [string, keyof ScoreBreakdown, number][] = [
  ['Pinning', 'pinning', 25],
  ['OI Wall', 'oiWall', 25],
  ['Velocity', 'velocity', 20],
  ['PCR', 'pcrExtreme', 15],
  ['Theta', 'timeDecay', 15],
];

const BUY_BREAKDOWN_LABELS: [string, keyof BuyScoreBreakdown, number][] = [
  ['Breakout', 'breakout', 25],
  ['Direction', 'directionalOi', 25],
  ['Momentum', 'momentum', 20],
  ['PCR Shift', 'pcrShift', 15],
  ['Risk/Rwd', 'riskReward', 15],
];

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
}) => {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // Build effective data (snapshot fallback for market closed)
  const { effectiveOi, effectivePrices, effectiveSpot } = useMemo(() => {
    let oi = oiData;
    let prices = livePrices;
    let spot = spotPrice;

    if (oiData.size === 0 && snapshots.length > 0) {
      const latest = snapshots[snapshots.length - 1];
      oi = new Map(Object.entries(latest.data).map(([k, v]) => [Number(k), v]));
      if (latest.prices) {
        prices = new Map(Object.entries(latest.prices).map(([k, v]) => [Number(k), v]));
      }
      if (spot === 0 && latest.spot) {
        spot = latest.spot;
      }
    }
    return { effectiveOi: oi, effectivePrices: prices, effectiveSpot: spot };
  }, [oiData, livePrices, spotPrice, snapshots]);

  // Summary metrics — always visible regardless of mode
  const maxPain = useMemo(() => calculateMaxPain(chain, effectiveOi), [chain, effectiveOi]);
  const pcr = useMemo(() => calculatePCR(chain, effectiveOi), [chain, effectiveOi]);
  const expectedMove = useMemo(() => calculateExpectedMove(chain, atmStrike ?? 0, effectivePrices), [chain, atmStrike, effectivePrices]);

  const sellRecs = useMemo(
    () => computeSellRecommendations(chain, effectiveOi, effectivePrices, prevDayOi, closePrices, snapshots, effectiveSpot, daysToExpiry, atmStrike),
    [chain, effectiveOi, effectivePrices, prevDayOi, closePrices, snapshots, effectiveSpot, daysToExpiry, atmStrike],
  );

  const buyRecs = useMemo(
    () => computeBuyRecommendations(chain, effectiveOi, effectivePrices, prevDayOi, closePrices, snapshots, effectiveSpot, daysToExpiry, atmStrike),
    [chain, effectiveOi, effectivePrices, prevDayOi, closePrices, snapshots, effectiveSpot, daysToExpiry, atmStrike],
  );

  const handleTrade = useCallback(async (rec: SellRecommendation | BuyRecommendation) => {
    if (orderMode !== 'paper' || !expiry) return;

    const side = mode === 'sell' ? 'SELL' : 'BUY';
    const verb = mode === 'sell' ? 'SELL' : 'BUY';

    try {
      const type = rec.type;
      if (type === 'sell-ce' || type === 'sell-pe' || type === 'buy-ce' || type === 'buy-pe') {
        const optionType = type.includes('ce') ? 'CE' : 'PE';
        const row = chain.find((r) => r.strike === rec.strikes[0]);
        const instrument = type.includes('ce') ? row?.ce : row?.pe;
        if (!instrument) return;
        const ltp = effectivePrices.get(instrument.instrumentToken) ?? 0;
        await addPosition({
          tradingsymbol: instrument.tradingsymbol,
          instrumentToken: instrument.instrumentToken,
          strike: rec.strikes[0],
          optionType,
          side,
          quantity: instrument.lotSize,
          entryPrice: ltp,
          expiry,
        });
        onToast(`${verb} ${rec.strikes[0]}${optionType} @ ${ltp.toFixed(2)}`, 'green');
      } else if (type === 'sell-straddle' || type === 'buy-straddle') {
        const row = chain.find((r) => r.strike === rec.strikes[0]);
        if (!row?.ce || !row?.pe) return;
        const ceLtp = effectivePrices.get(row.ce.instrumentToken) ?? 0;
        const peLtp = effectivePrices.get(row.pe.instrumentToken) ?? 0;
        await addPosition({
          tradingsymbol: row.ce.tradingsymbol,
          instrumentToken: row.ce.instrumentToken,
          strike: rec.strikes[0],
          optionType: 'CE',
          side,
          quantity: row.ce.lotSize,
          entryPrice: ceLtp,
          expiry,
        });
        await addPosition({
          tradingsymbol: row.pe.tradingsymbol,
          instrumentToken: row.pe.instrumentToken,
          strike: rec.strikes[0],
          optionType: 'PE',
          side,
          quantity: row.pe.lotSize,
          entryPrice: peLtp,
          expiry,
        });
        onToast(`${verb} Straddle ${rec.strikes[0]} CE@${ceLtp.toFixed(0)} PE@${peLtp.toFixed(0)}`, 'green');
      } else if (type === 'sell-strangle' || type === 'buy-strangle') {
        const ceRow = chain.find((r) => r.strike === rec.strikes[0]);
        const peRow = chain.find((r) => r.strike === rec.strikes[1]);
        if (!ceRow?.ce || !peRow?.pe) return;
        const ceLtp = effectivePrices.get(ceRow.ce.instrumentToken) ?? 0;
        const peLtp = effectivePrices.get(peRow.pe.instrumentToken) ?? 0;
        await addPosition({
          tradingsymbol: ceRow.ce.tradingsymbol,
          instrumentToken: ceRow.ce.instrumentToken,
          strike: rec.strikes[0],
          optionType: 'CE',
          side,
          quantity: ceRow.ce.lotSize,
          entryPrice: ceLtp,
          expiry,
        });
        await addPosition({
          tradingsymbol: peRow.pe.tradingsymbol,
          instrumentToken: peRow.pe.instrumentToken,
          strike: rec.strikes[1],
          optionType: 'PE',
          side,
          quantity: peRow.pe.lotSize,
          entryPrice: peLtp,
          expiry,
        });
        onToast(`${verb} Strangle ${rec.strikes[0]}CE@${ceLtp.toFixed(0)} ${rec.strikes[1]}PE@${peLtp.toFixed(0)}`, 'green');
      }
    } catch {
      onToast('Failed to add position', 'red');
    }
  }, [chain, effectivePrices, orderMode, expiry, onToast, mode]);

  // Reset expanded row when switching modes
  const handleModeChange = useCallback((newMode: StrategyMode) => {
    onModeChange(newMode);
    setExpandedIdx(null);
  }, [onModeChange]);

  const recommendations = mode === 'sell' ? sellRecs : buyRecs;
  const breakdownLabels = mode === 'sell' ? SELL_BREAKDOWN_LABELS : BUY_BREAKDOWN_LABELS;

  const renderSummaryBar = () => (
    <div className="trap-summary">
      <div className="trap-summary__item">
        <span className="trap-summary__label">Max Pain</span>
        <span className="trap-summary__value">{maxPain > 0 ? maxPain : '-'}</span>
      </div>
      <div className="trap-summary__item">
        <span className="trap-summary__label">PCR</span>
        <span className={`trap-summary__value ${pcr > 1 ? 'positive' : pcr < 1 ? 'negative' : ''}`}>
          {pcr > 0 ? pcr.toFixed(2) : '-'}
        </span>
      </div>
      <div className="trap-summary__item">
        <span className="trap-summary__label">Spot</span>
        <span className="trap-summary__value">{effectiveSpot > 0 ? effectiveSpot.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '-'}</span>
      </div>
      <div className="trap-summary__item">
        <span className="trap-summary__label">Expected Move</span>
        <span className="trap-summary__value">{expectedMove > 0 ? `±${expectedMove.toFixed(0)}` : '-'}</span>
      </div>
    </div>
  );

  const renderToggle = () => (
    <div className="sell-strategy__toggle">
      <button className={`sell-strategy__toggle-btn ${mode === 'sell' ? 'sell-strategy__toggle-btn--active-sell' : ''}`} onClick={() => handleModeChange('sell')}>Sell</button>
      <button className={`sell-strategy__toggle-btn ${mode === 'buy' ? 'sell-strategy__toggle-btn--active-buy' : ''}`} onClick={() => handleModeChange('buy')}>Buy</button>
      <button className={`sell-strategy__toggle-btn ${mode === 'analyzer' ? 'sell-strategy__toggle-btn--active-analyzer' : ''}`} onClick={() => handleModeChange('analyzer')}>Analyzer</button>
    </div>
  );

  if (snapshots.length < 2 && oiData.size === 0) {
    return (
      <div className="sell-strategy">
        {renderSummaryBar()}
        {renderToggle()}
        {mode === 'analyzer' ? (
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
      {renderSummaryBar()}
      {renderToggle()}

      {mode === 'analyzer' ? (
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
        />
      ) : recommendations.length === 0 ? (
        <div className="sell-strategy__empty">
          No {mode} opportunities detected — all strikes scored below threshold.
        </div>
      ) : (
        <div className="sell-strategy__list">
          {recommendations.map((rec, idx) => {
            const isExpanded = expandedIdx === idx;
            const colorClass = scoreColorClass(rec.score);
            const badge = mode === 'sell'
              ? sellBadgeLabel((rec as SellRecommendation).type)
              : buyBadgeLabel((rec as BuyRecommendation).type);

            return (
              <div key={`${rec.type}-${rec.strikes.join('-')}`} className="sell-strategy__row">
                <div
                  className="sell-strategy__row-main"
                  onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                >
                  <span className={`sell-strategy__badge sell-strategy__badge--${rec.type}`}>
                    {badge}
                  </span>
                  <span className="sell-strategy__strike">{strikeLabel(rec.strikes)}</span>

                  <div className="sell-strategy__score-area">
                    <div className="sell-strategy__score-track">
                      <div
                        className={`sell-strategy__score-fill sell-strategy__score-fill--${colorClass}`}
                        style={{ width: `${rec.score}%` }}
                      />
                    </div>
                    <span className={`sell-strategy__score-value sell-strategy__score-value--${colorClass}`}>
                      {rec.score}
                    </span>
                  </div>

                  {mode === 'sell' && (
                    <span className="sell-strategy__pop">
                      <span className="sell-strategy__pop-label">POP</span>
                      <span className={`sell-strategy__pop-value ${(rec as SellRecommendation).pop >= 70 ? 'positive' : (rec as SellRecommendation).pop >= 50 ? '' : 'negative'}`}>
                        {(rec as SellRecommendation).pop.toFixed(0)}%
                      </span>
                    </span>
                  )}
                  <span className="sell-strategy__premium">₹{rec.premium.toFixed(1)}</span>
                  <span className="sell-strategy__pattern">{rec.pattern}</span>

                  {orderMode === 'paper' && (
                    <button
                      className={`sell-strategy__sell-btn sell-strategy__sell-btn--${actionBtnClass(rec.type)}`}
                      onClick={(e) => { e.stopPropagation(); handleTrade(rec); }}
                      disabled={!expiry}
                    >
                      {mode === 'sell' ? 'Sell' : 'Buy'}
                    </button>
                  )}

                  <span className={`sell-strategy__expand ${isExpanded ? 'sell-strategy__expand--open' : ''}`}>
                    ▼
                  </span>
                </div>

                {isExpanded && (
                  <div className="sell-strategy__details">
                    <div className="sell-strategy__breakdown">
                      {breakdownLabels.map(([label, key, max]) => {
                        const value = (rec.breakdown as unknown as Record<string, number>)[key] ?? 0;
                        return (
                          <div key={label} className="sell-strategy__breakdown-item">
                            <span className="sell-strategy__breakdown-label">{label}</span>
                            <span className={`sell-strategy__breakdown-value ${value > 0 ? 'sell-strategy__breakdown-value--active' : 'sell-strategy__breakdown-value--zero'}`}>
                              {value}/{max}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="sell-strategy__reasons">
                      {rec.reasons.map((r, i) => (
                        <span key={i} className="sell-strategy__reason">• {r}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SellStrategy;
