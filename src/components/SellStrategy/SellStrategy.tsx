import React, { useMemo, useState, useCallback } from 'react';
import { OptionChainRow } from '@/services/optionChain';
import { OiSnapshot } from '@/services/oiSnapshots';
import { computeSellRecommendations, SellRecommendation } from '@/services/sellStrategy';
import { addPosition } from '@/services/positions';
import '@/styles/sellstrategy.css';

interface SellStrategyProps {
  chain: OptionChainRow[];
  oiData: Map<number, number>;
  livePrices: Map<number, number>;
  prevDayOi: Map<number, number>;
  closePrices: Map<number, number>;
  snapshots: OiSnapshot[];
  spotPrice: number;
  daysToExpiry?: number;
  orderMode: 'paper' | 'live';
  expiry: string;
  onToast: (text: string, color: 'green' | 'red') => void;
}

function scoreColorClass(score: number): string {
  if (score >= 80) return 'very-high';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

function badgeLabel(type: SellRecommendation['type']): string {
  switch (type) {
    case 'sell-ce': return 'Sell CE';
    case 'sell-pe': return 'Sell PE';
    case 'sell-straddle': return 'Straddle';
    case 'sell-strangle': return 'Strangle';
  }
}

function strikeLabel(rec: SellRecommendation): string {
  if (rec.strikes.length === 2) return `${rec.strikes[0]} / ${rec.strikes[1]}`;
  return String(rec.strikes[0]);
}

function sellBtnClass(type: SellRecommendation['type']): string {
  switch (type) {
    case 'sell-ce': return 'ce';
    case 'sell-pe': return 'pe';
    case 'sell-straddle': return 'straddle';
    case 'sell-strangle': return 'strangle';
  }
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
  orderMode,
  expiry,
  onToast,
}) => {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const recommendations = useMemo(
    () => computeSellRecommendations(chain, oiData, livePrices, prevDayOi, closePrices, snapshots, spotPrice, daysToExpiry),
    [chain, oiData, livePrices, prevDayOi, closePrices, snapshots, spotPrice, daysToExpiry],
  );

  const handleSell = useCallback(async (rec: SellRecommendation) => {
    if (orderMode !== 'paper' || !expiry) return;

    try {
      if (rec.type === 'sell-ce' || rec.type === 'sell-pe') {
        const optionType = rec.type === 'sell-ce' ? 'CE' : 'PE';
        const row = chain.find((r) => r.strike === rec.strikes[0]);
        const instrument = rec.type === 'sell-ce' ? row?.ce : row?.pe;
        if (!instrument) return;
        const ltp = livePrices.get(instrument.instrumentToken) ?? 0;
        await addPosition({
          tradingsymbol: instrument.tradingsymbol,
          instrumentToken: instrument.instrumentToken,
          strike: rec.strikes[0],
          optionType,
          side: 'SELL',
          quantity: instrument.lotSize,
          entryPrice: ltp,
          expiry,
        });
        onToast(`SELL ${rec.strikes[0]}${optionType} @ ${ltp.toFixed(2)}`, 'green');
      } else if (rec.type === 'sell-straddle') {
        const row = chain.find((r) => r.strike === rec.strikes[0]);
        if (!row?.ce || !row?.pe) return;
        const ceLtp = livePrices.get(row.ce.instrumentToken) ?? 0;
        const peLtp = livePrices.get(row.pe.instrumentToken) ?? 0;
        await addPosition({
          tradingsymbol: row.ce.tradingsymbol,
          instrumentToken: row.ce.instrumentToken,
          strike: rec.strikes[0],
          optionType: 'CE',
          side: 'SELL',
          quantity: row.ce.lotSize,
          entryPrice: ceLtp,
          expiry,
        });
        await addPosition({
          tradingsymbol: row.pe.tradingsymbol,
          instrumentToken: row.pe.instrumentToken,
          strike: rec.strikes[0],
          optionType: 'PE',
          side: 'SELL',
          quantity: row.pe.lotSize,
          entryPrice: peLtp,
          expiry,
        });
        onToast(`SELL Straddle ${rec.strikes[0]} CE@${ceLtp.toFixed(0)} PE@${peLtp.toFixed(0)}`, 'green');
      } else if (rec.type === 'sell-strangle') {
        const ceRow = chain.find((r) => r.strike === rec.strikes[0]);
        const peRow = chain.find((r) => r.strike === rec.strikes[1]);
        if (!ceRow?.ce || !peRow?.pe) return;
        const ceLtp = livePrices.get(ceRow.ce.instrumentToken) ?? 0;
        const peLtp = livePrices.get(peRow.pe.instrumentToken) ?? 0;
        await addPosition({
          tradingsymbol: ceRow.ce.tradingsymbol,
          instrumentToken: ceRow.ce.instrumentToken,
          strike: rec.strikes[0],
          optionType: 'CE',
          side: 'SELL',
          quantity: ceRow.ce.lotSize,
          entryPrice: ceLtp,
          expiry,
        });
        await addPosition({
          tradingsymbol: peRow.pe.tradingsymbol,
          instrumentToken: peRow.pe.instrumentToken,
          strike: rec.strikes[1],
          optionType: 'PE',
          side: 'SELL',
          quantity: peRow.pe.lotSize,
          entryPrice: peLtp,
          expiry,
        });
        onToast(`SELL Strangle ${rec.strikes[0]}CE@${ceLtp.toFixed(0)} ${rec.strikes[1]}PE@${peLtp.toFixed(0)}`, 'green');
      }
    } catch {
      onToast('Failed to add position', 'red');
    }
  }, [chain, livePrices, orderMode, expiry, onToast]);

  if (snapshots.length < 2) {
    return (
      <div className="sell-strategy">
        <div className="sell-strategy__empty">
          Waiting for market data — need at least 20 minutes of OI snapshots to generate recommendations.
        </div>
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <div className="sell-strategy">
        <div className="sell-strategy__empty">
          No sell opportunities detected — all strikes scored below threshold.
        </div>
      </div>
    );
  }

  return (
    <div className="sell-strategy">
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
                <span className={`sell-strategy__badge sell-strategy__badge--${rec.type}`}>
                  {badgeLabel(rec.type)}
                </span>
                <span className="sell-strategy__strike">{strikeLabel(rec)}</span>

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

                <span className="sell-strategy__pattern">{rec.pattern}</span>

                {orderMode === 'paper' && (
                  <button
                    className={`sell-strategy__sell-btn sell-strategy__sell-btn--${sellBtnClass(rec.type)}`}
                    onClick={(e) => { e.stopPropagation(); handleSell(rec); }}
                    disabled={!expiry}
                  >
                    Sell
                  </button>
                )}

                <span className={`sell-strategy__expand ${isExpanded ? 'sell-strategy__expand--open' : ''}`}>
                  ▼
                </span>
              </div>

              {isExpanded && (
                <div className="sell-strategy__details">
                  <div className="sell-strategy__breakdown">
                    {([
                      ['Pinning', rec.breakdown.pinning, 25],
                      ['OI Wall', rec.breakdown.oiWall, 25],
                      ['Velocity', rec.breakdown.velocity, 20],
                      ['PCR', rec.breakdown.pcrExtreme, 15],
                      ['Theta', rec.breakdown.timeDecay, 15],
                    ] as [string, number, number][]).map(([label, value, max]) => (
                      <div key={label} className="sell-strategy__breakdown-item">
                        <span className="sell-strategy__breakdown-label">{label}</span>
                        <span className={`sell-strategy__breakdown-value ${value > 0 ? 'sell-strategy__breakdown-value--active' : 'sell-strategy__breakdown-value--zero'}`}>
                          {value}/{max}
                        </span>
                      </div>
                    ))}
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
    </div>
  );
};

export default SellStrategy;
