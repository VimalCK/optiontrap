import React, { useMemo } from 'react';
import { OptionChainRow } from '@/services/optionChain';
import { calculateEdgeScores, calculateExpectedMove, StrikeEdge } from '@/services/edgeScore';
import { calculateMaxPain } from '@/services/trapAnalysis';

interface BestStrikesProps {
  chain: OptionChainRow[];
  oiData: Map<number, number>;
  livePrices: Map<number, number>;
  spotPrice: number;
  atmStrike: number;
}

const BestStrikes: React.FC<BestStrikesProps> = ({
  chain,
  oiData,
  livePrices,
  spotPrice,
  atmStrike,
}) => {
  const edgeScores = useMemo(
    () => calculateEdgeScores(chain, oiData, livePrices, spotPrice, atmStrike),
    [chain, oiData, livePrices, spotPrice, atmStrike],
  );

  const expectedMove = useMemo(
    () => calculateExpectedMove(chain, atmStrike, livePrices),
    [chain, atmStrike, livePrices],
  );

  const maxPain = useMemo(() => calculateMaxPain(chain, oiData), [chain, oiData]);

  // Top 3 CE and PE recommendations
  const topCe = useMemo(() => edgeScores.filter((s) => s.type === 'ce').slice(0, 3), [edgeScores]);
  const topPe = useMemo(() => edgeScores.filter((s) => s.type === 'pe').slice(0, 3), [edgeScores]);

  if (edgeScores.length === 0) {
    return <div className="best-strikes__empty">No data available for recommendations.</div>;
  }

  const renderStrikeCard = (item: StrikeEdge, rank: number) => (
    <div key={`${item.type}-${item.strike}`} className="best-strike-card">
      <div className="best-strike-card__header">
        <span className="best-strike-card__rank">#{rank}</span>
        <span className="best-strike-card__strike">{item.strike}</span>
        <span className={`best-strike-card__type best-strike-card__type--${item.type}`}>
          {item.type.toUpperCase()}
        </span>
      </div>
      <div className="best-strike-card__metrics">
        <div className="best-strike-card__metric">
          <span className="best-strike-card__metric-label">POP</span>
          <span className={`best-strike-card__metric-value ${item.pop >= 70 ? 'positive' : item.pop >= 50 ? '' : 'negative'}`}>
            {item.pop.toFixed(0)}%
          </span>
        </div>
        <div className="best-strike-card__metric">
          <span className="best-strike-card__metric-label">Premium</span>
          <span className="best-strike-card__metric-value">₹{item.premium.toFixed(2)}</span>
        </div>
        <div className="best-strike-card__metric">
          <span className="best-strike-card__metric-label">Distance</span>
          <span className="best-strike-card__metric-value">{Math.round(item.distanceFromSpot)} pts</span>
        </div>
        <div className="best-strike-card__metric">
          <span className="best-strike-card__metric-label">OI Wall</span>
          <span className={`best-strike-card__metric-value ${item.oiWallStrength >= 1.5 ? 'positive' : ''}`}>
            {item.oiWallStrength > 0 ? `${item.oiWallStrength.toFixed(1)}x` : 'None'}
          </span>
        </div>
      </div>
      {item.reasons.length > 0 && (
        <div className="best-strike-card__reasons">
          {item.reasons.map((r, i) => (
            <span key={i} className="best-strike-card__reason">• {r}</span>
          ))}
        </div>
      )}
      <div className="best-strike-card__score">
        Edge Score: <strong>{item.edgeScore.toFixed(1)}</strong>
      </div>
    </div>
  );

  return (
    <div className="best-strikes">
      {/* Summary */}
      <div className="best-strikes__summary">
        <div className="best-strikes__summary-item">
          <span className="best-strikes__summary-label">Expected Move</span>
          <span className="best-strikes__summary-value">±{expectedMove.toFixed(0)} pts</span>
        </div>
        <div className="best-strikes__summary-item">
          <span className="best-strikes__summary-label">Safe Range</span>
          <span className="best-strikes__summary-value">
            {(spotPrice - expectedMove).toFixed(0)} – {(spotPrice + expectedMove).toFixed(0)}
          </span>
        </div>
        <div className="best-strikes__summary-item">
          <span className="best-strikes__summary-label">Max Pain</span>
          <span className="best-strikes__summary-value">{maxPain}</span>
        </div>
      </div>

      {/* Recommendations */}
      <div className="best-strikes__grid">
        <div className="best-strikes__column">
          <h4 className="best-strikes__column-title best-strikes__column-title--ce">Sell CE</h4>
          {topCe.length > 0 ? (
            topCe.map((item, i) => renderStrikeCard(item, i + 1))
          ) : (
            <p className="best-strikes__empty">No CE recommendations</p>
          )}
        </div>
        <div className="best-strikes__column">
          <h4 className="best-strikes__column-title best-strikes__column-title--pe">Sell PE</h4>
          {topPe.length > 0 ? (
            topPe.map((item, i) => renderStrikeCard(item, i + 1))
          ) : (
            <p className="best-strikes__empty">No PE recommendations</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default BestStrikes;
