import React, { useState, useMemo } from 'react';
import { OptionChainRow } from '@/services/optionChain';
import { analyzeTrap, TrapAnalysis, calculateMaxPain, calculatePCR } from '@/services/trapAnalysis';
import '@/styles/trapanalyzer.css';

interface TrapAnalyzerProps {
  chain: OptionChainRow[];
  oiData: Map<number, number>;
  prevDayOi: Map<number, number>;
  closePrices: Map<number, number>;
  livePrices: Map<number, number>;
  spotPrice: number;
  atmStrike: number;
}

type PositionType = 'buy-ce' | 'buy-pe' | 'sell-ce' | 'sell-pe';

const TrapAnalyzer: React.FC<TrapAnalyzerProps> = ({
  chain,
  oiData,
  prevDayOi,
  closePrices,
  livePrices,
  spotPrice,
  atmStrike,
}) => {
  const [positionType, setPositionType] = useState<PositionType>('buy-ce');
  const [selectedStrike, setSelectedStrike] = useState<number>(atmStrike);

  // Update selected strike when ATM changes
  React.useEffect(() => {
    if (atmStrike > 0) setSelectedStrike(atmStrike);
  }, [atmStrike]);

  // Get available strikes for the dropdown
  const strikes = useMemo(() => chain.map((r) => r.strike), [chain]);

  // Summary metrics
  const maxPain = useMemo(() => calculateMaxPain(chain, oiData), [chain, oiData]);
  const pcr = useMemo(() => calculatePCR(chain, oiData), [chain, oiData]);

  // Run analysis
  const analysis: TrapAnalysis | null = useMemo(() => {
    if (chain.length === 0 || spotPrice === 0) return null;
    return analyzeTrap(positionType, selectedStrike, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices);
  }, [positionType, selectedStrike, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices]);

  const verdictClass = analysis ? `trap-verdict--${analysis.verdict}` : '';

  return (
    <div className="trap-analyzer">
      {/* Summary Bar */}
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
          <span className="trap-summary__value">{spotPrice > 0 ? spotPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '-'}</span>
        </div>
      </div>

      {/* Position Input */}
      <div className="trap-input">
        <div className="trap-input__row">
          <div className="trap-input__group">
            <label className="trap-input__label">Position</label>
            <select
              className="trap-input__select"
              value={positionType}
              onChange={(e) => setPositionType(e.target.value as PositionType)}
            >
              <option value="buy-ce">Buy CE (Long Call)</option>
              <option value="buy-pe">Buy PE (Long Put)</option>
              <option value="sell-ce">Sell CE (Short Call)</option>
              <option value="sell-pe">Sell PE (Short Put)</option>
            </select>
          </div>
          <div className="trap-input__group">
            <label className="trap-input__label">Strike</label>
            <select
              className="trap-input__select"
              value={selectedStrike}
              onChange={(e) => setSelectedStrike(Number(e.target.value))}
            >
              {strikes.map((s) => (
                <option key={s} value={s}>{s}{s === atmStrike ? ' (ATM)' : ''}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Verdict */}
      {analysis && (
        <div className={`trap-verdict ${verdictClass}`}>
          <div className="trap-verdict__header">
            <span className="trap-verdict__icon">
              {analysis.verdict === 'safe' && '✓'}
              {analysis.verdict === 'caution' && '⚠'}
              {analysis.verdict === 'likely-trapped' && '✕'}
            </span>
            <span className="trap-verdict__label">{analysis.verdictLabel}</span>
          </div>

          <div className="trap-verdict__details">
            {/* OI Signal */}
            <div className="trap-detail">
              <span className="trap-detail__label">OI Signal</span>
              <span className={`trap-detail__value trap-detail__value--${analysis.oiSignal.sentiment}`}>
                {analysis.oiSignal.label}
              </span>
            </div>

            {/* Max Pain distance */}
            <div className="trap-detail">
              <span className="trap-detail__label">Max Pain</span>
              <span className="trap-detail__value">
                {analysis.maxPain} ({analysis.distanceToMaxPain > 0 ? `${analysis.distanceToMaxPain} pts away` : 'at strike'})
              </span>
            </div>

            {/* Nearest walls */}
            {analysis.nearestResistance && (
              <div className="trap-detail">
                <span className="trap-detail__label">Resistance</span>
                <span className="trap-detail__value">
                  {analysis.nearestResistance.strike} ({analysis.nearestResistance.strength.toFixed(1)}x OI)
                </span>
              </div>
            )}
            {analysis.nearestSupport && (
              <div className="trap-detail">
                <span className="trap-detail__label">Support</span>
                <span className="trap-detail__value">
                  {analysis.nearestSupport.strike} ({analysis.nearestSupport.strength.toFixed(1)}x OI)
                </span>
              </div>
            )}
          </div>

          {/* Reasons */}
          <div className="trap-reasons">
            {analysis.reasons.map((reason, i) => (
              <div key={i} className="trap-reason">
                <span className="trap-reason__bullet">•</span>
                <span>{reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TrapAnalyzer;
