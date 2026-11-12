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
import { tradeErrorMessage } from '@/services/positions';
import { placeMarketTrade, placedOrderMessage, placedOrderRefused, type PaperOrder } from '@/services/orders';
import TrapAnalyzer from '@/components/TrapAnalyzer/TrapAnalyzer';
import type { FlowReading } from '@/services/oiFlow';
import '@/styles/sellstrategy.css';
import { OptionType, OrderStatus, Side, TradingMode, type HorizonId, type OptionTypeId, type TradingModeId } from '../../../shared/tradeEnums.js';
import { OptionSetup, optionSetupLabel, setupPatternLabel, type OptionSetupId } from '../../../shared/analysisEnums.js';
import { STRATEGY_MODES, StrategyMode, strategyModeLabel, type StrategyModeId } from '../../../shared/appEnums.js';
import { ToastColor, type ToastColorId } from '@/utils/uiEnums';

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
  /** Intraday or positional: the trade type the Option Chain has chosen (useTradeHorizon). */
  horizon: HorizonId;
  expiry: string;
  onToast: (text: string, color: ToastColorId) => void;
  mode: StrategyModeId;
  onModeChange: (mode: StrategyModeId) => void;
  volumeData: Map<number, number>;
  avgVolume: number;
  /** IV-based flow per option token, shown in the trap analyzer. */
  flowByToken?: Map<number, FlowReading>;
}

function scoreColorClass(score: number): string {
  if (score >= 80) return 'very-high';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

/** The option a single-option setup trades. */
const SINGLE_OPTION_SETUPS: Partial<Record<OptionSetupId, OptionTypeId>> = {
  [OptionSetup.SellCe]: OptionType.CE,
  [OptionSetup.BuyCe]: OptionType.CE,
  [OptionSetup.SellPe]: OptionType.PE,
  [OptionSetup.BuyPe]: OptionType.PE,
};

/** Setups that trade a CE and a PE at one strike. */
const STRADDLE_SETUPS: OptionSetupId[] = [OptionSetup.SellStraddle, OptionSetup.BuyStraddle];

/** Setups that trade a CE and a PE at two strikes. */
const STRANGLE_SETUPS: OptionSetupId[] = [OptionSetup.SellStrangle, OptionSetup.BuyStrangle];

function strikeLabel(strikes: number[]): string {
  if (strikes.length === 2) return `${strikes[0]} / ${strikes[1]}`;
  return String(strikes[0]);
}

/** The trade button's colour class for a setup: its option, or straddle / strangle. */
function actionBtnClass(type: OptionSetupId): string {
  const optionType = SINGLE_OPTION_SETUPS[type];
  if (optionType) return optionType.toLowerCase();
  return STRADDLE_SETUPS.includes(type) ? 'straddle' : 'strangle';
}

/** A score breakdown item: its label, its key in the breakdown, and its maximum points. */
interface BreakdownItem<Breakdown> {
  label: string;
  key: keyof Breakdown;
  max: number;
}

const SELL_BREAKDOWN_LABELS: BreakdownItem<ScoreBreakdown>[] = [
  { label: 'Pinning', key: 'pinning', max: 25 },
  { label: 'OI Wall', key: 'oiWall', max: 25 },
  { label: 'Velocity', key: 'velocity', max: 20 },
  { label: 'PCR', key: 'pcrExtreme', max: 15 },
  { label: 'Theta', key: 'timeDecay', max: 15 },
];

const BUY_BREAKDOWN_LABELS: BreakdownItem<BuyScoreBreakdown>[] = [
  { label: 'Breakout', key: 'breakout', max: 25 },
  { label: 'Direction', key: 'directionalOi', max: 25 },
  { label: 'Momentum', key: 'momentum', max: 20 },
  { label: 'PCR Shift', key: 'pcrShift', max: 15 },
  { label: 'Risk/Rwd', key: 'riskReward', max: 15 },
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
  horizon,
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
    () => computeSellRecommendations(chain, effectiveOi, effectivePrices, prevDayOi, closePrices, snapshots, effectiveSpot, daysToExpiry, atmStrike, volumeData, avgVolume),
    [chain, effectiveOi, effectivePrices, prevDayOi, closePrices, snapshots, effectiveSpot, daysToExpiry, atmStrike, volumeData, avgVolume],
  );

  const buyRecs = useMemo(
    () => computeBuyRecommendations(chain, effectiveOi, effectivePrices, prevDayOi, closePrices, snapshots, effectiveSpot, daysToExpiry, atmStrike, volumeData, avgVolume),
    [chain, effectiveOi, effectivePrices, prevDayOi, closePrices, snapshots, effectiveSpot, daysToExpiry, atmStrike, volumeData, avgVolume],
  );

  /**
   * The toast for a two-leg trade: `filledTitle` when both legs filled at once,
   * otherwise what happened to each leg (e.g. orders waiting for the open).
   */
  const showLegs = useCallback((filledTitle: string, legs: [PaperOrder, string][]) => {
    const refused = legs.some(([placed]) => placedOrderRefused(placed));
    const allFilled = legs.every(([placed]) => placed.status === OrderStatus.Filled);
    const text = allFilled ? filledTitle : legs.map(([placed, label]) => placedOrderMessage(placed, label)).join(' · ');
    onToast(text, refused ? ToastColor.Red : ToastColor.Green);
  }, [onToast]);

  const handleTrade = useCallback(async (rec: SellRecommendation | BuyRecommendation) => {
    if (orderMode !== TradingMode.Paper || !expiry) return;

    const side = mode === StrategyMode.Sell ? Side.SELL : Side.BUY;
    const verb = side;
    const note = rec.reasons.slice(0, 3).join(' | ');
    const confidence = Math.max(0, Math.min(100, Math.round(rec.score)));

    try {
      const type = rec.type;
      const optionType = SINGLE_OPTION_SETUPS[type];
      if (optionType) {
        const row = chain.find((r) => r.strike === rec.strikes[0]);
        const instrument = optionType === OptionType.CE ? row?.ce : row?.pe;
        if (!instrument) return;
        const placed = await placeMarketTrade({
          tradingsymbol: instrument.tradingsymbol,
          instrumentToken: instrument.instrumentToken,
          strike: rec.strikes[0],
          optionType,
          side,
          quantity: instrument.lotSize,
          expiry,
          horizon,
          note,
          confidence,
        });
        onToast(placedOrderMessage(placed, `${verb} ${rec.strikes[0]}${optionType}`), placedOrderRefused(placed) ? ToastColor.Red : ToastColor.Green);
      } else if (STRADDLE_SETUPS.includes(type)) {
        const row = chain.find((r) => r.strike === rec.strikes[0]);
        if (!row?.ce || !row?.pe) return;
        const ceLtp = effectivePrices.get(row.ce.instrumentToken) ?? 0;
        const peLtp = effectivePrices.get(row.pe.instrumentToken) ?? 0;
        const ceLeg = await placeMarketTrade({
          tradingsymbol: row.ce.tradingsymbol,
          instrumentToken: row.ce.instrumentToken,
          strike: rec.strikes[0],
          optionType: OptionType.CE,
          side,
          quantity: row.ce.lotSize,
          expiry,
          horizon,
          note,
          confidence,
        });
        const peLeg = await placeMarketTrade({
          tradingsymbol: row.pe.tradingsymbol,
          instrumentToken: row.pe.instrumentToken,
          strike: rec.strikes[0],
          optionType: OptionType.PE,
          side,
          quantity: row.pe.lotSize,
          expiry,
          horizon,
          note,
          confidence,
        });
        showLegs(`${verb} Straddle ${rec.strikes[0]} CE@${ceLtp.toFixed(0)} PE@${peLtp.toFixed(0)}`, [
          [ceLeg, `${verb} ${rec.strikes[0]}CE`],
          [peLeg, `${verb} ${rec.strikes[0]}PE`],
        ]);
      } else if (STRANGLE_SETUPS.includes(type)) {
        const ceRow = chain.find((r) => r.strike === rec.strikes[0]);
        const peRow = chain.find((r) => r.strike === rec.strikes[1]);
        if (!ceRow?.ce || !peRow?.pe) return;
        const ceLtp = effectivePrices.get(ceRow.ce.instrumentToken) ?? 0;
        const peLtp = effectivePrices.get(peRow.pe.instrumentToken) ?? 0;
        const ceLeg = await placeMarketTrade({
          tradingsymbol: ceRow.ce.tradingsymbol,
          instrumentToken: ceRow.ce.instrumentToken,
          strike: rec.strikes[0],
          optionType: OptionType.CE,
          side,
          quantity: ceRow.ce.lotSize,
          expiry,
          horizon,
          note,
          confidence,
        });
        const peLeg = await placeMarketTrade({
          tradingsymbol: peRow.pe.tradingsymbol,
          instrumentToken: peRow.pe.instrumentToken,
          strike: rec.strikes[1],
          optionType: OptionType.PE,
          side,
          quantity: peRow.pe.lotSize,
          expiry,
          horizon,
          note,
          confidence,
        });
        showLegs(`${verb} Strangle ${rec.strikes[0]}CE@${ceLtp.toFixed(0)} ${rec.strikes[1]}PE@${peLtp.toFixed(0)}`, [
          [ceLeg, `${verb} ${rec.strikes[0]}CE`],
          [peLeg, `${verb} ${rec.strikes[1]}PE`],
        ]);
      }
    } catch (err) {
      onToast(tradeErrorMessage(err), ToastColor.Red);
    }
  }, [chain, effectivePrices, orderMode, expiry, onToast, mode, horizon, showLegs]);

  // Reset expanded row when switching modes
  const handleModeChange = useCallback((newMode: StrategyModeId) => {
    onModeChange(newMode);
    setExpandedIdx(null);
  }, [onModeChange]);

  const recommendations: (SellRecommendation | BuyRecommendation)[] = mode === StrategyMode.Sell ? sellRecs : buyRecs;
  const breakdownLabels = mode === StrategyMode.Sell ? SELL_BREAKDOWN_LABELS : BUY_BREAKDOWN_LABELS;

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
      {STRATEGY_MODES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={`sell-strategy__toggle-btn ${mode === id ? `sell-strategy__toggle-btn--active-${id.toLowerCase()}` : ''}`}
          onClick={() => handleModeChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (snapshots.length < 2 && oiData.size === 0) {
    return (
      <div className="sell-strategy">
        {renderSummaryBar()}
        {renderToggle()}
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
      {renderSummaryBar()}
      {renderToggle()}

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
          {recommendations.map((rec, idx) => {
            const isExpanded = expandedIdx === idx;
            const colorClass = scoreColorClass(rec.score);

            return (
              <div key={`${rec.type}-${rec.strikes.join('-')}`} className="sell-strategy__row">
                <div
                  className="sell-strategy__row-main"
                  onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                >
                  <span className={`sell-strategy__badge sell-strategy__badge--${rec.type.toLowerCase()}`}>
                    {optionSetupLabel(rec.type)}
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

                  {mode === StrategyMode.Sell && (
                    <span className="sell-strategy__pop">
                      <span className="sell-strategy__pop-label">POP</span>
                      <span className={`sell-strategy__pop-value ${(rec as SellRecommendation).pop >= 70 ? 'positive' : (rec as SellRecommendation).pop >= 50 ? '' : 'negative'}`}>
                        {(rec as SellRecommendation).pop.toFixed(0)}%
                      </span>
                    </span>
                  )}
                  <span className="sell-strategy__premium">₹{rec.premium.toFixed(1)}</span>
                  <span className="sell-strategy__pattern">{setupPatternLabel(rec.pattern)}</span>

                  {orderMode === TradingMode.Paper && (
                    <button
                      className={`sell-strategy__sell-btn sell-strategy__sell-btn--${actionBtnClass(rec.type)}`}
                      onClick={(e) => { e.stopPropagation(); handleTrade(rec); }}
                      disabled={!expiry}
                    >
                      {strategyModeLabel(mode)}
                    </button>
                  )}

                  <span className={`sell-strategy__expand ${isExpanded ? 'sell-strategy__expand--open' : ''}`}>
                    ▼
                  </span>
                </div>

                {isExpanded && (
                  <div className="sell-strategy__details">
                    <div className="sell-strategy__breakdown">
                      {breakdownLabels.map(({ label, key, max }) => {
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
