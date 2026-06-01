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
type AnalyzerView = 'single' | 'map';

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
  const [view, setView] = useState<AnalyzerView>('single');

  // Update selected strike when ATM changes
  React.useEffect(() => {
    if (atmStrike > 0) setSelectedStrike(atmStrike);
  }, [atmStrike]);

  // Get available strikes for the dropdown
  const strikes = useMemo(() => chain.map((r) => r.strike), [chain]);

  // Summary metrics
  const maxPain = useMemo(() => calculateMaxPain(chain, oiData), [chain, oiData]);
  const pcr = useMemo(() => calculatePCR(chain, oiData), [chain, oiData]);

  // Run analysis for single view
  const analysis: TrapAnalysis | null = useMemo(() => {
    if (chain.length === 0 || spotPrice === 0) return null;
    return analyzeTrap(positionType, selectedStrike, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices);
  }, [positionType, selectedStrike, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices]);

  // Run analysis for all strikes (map view)
  const mapData = useMemo(() => {
    if (chain.length === 0 || spotPrice === 0) return [];
    return chain.map((row) => {
      const result = analyzeTrap(positionType, row.strike, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices);
      return { strike: row.strike, ...result };
    });
  }, [positionType, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices]);

  const maxTrapScore = useMemo(() => {
    if (mapData.length === 0) return 7;
    const max = Math.max(...mapData.map((d) => d.trapScore));
    return Math.max(max, 7); // minimum 7 for y-axis scale
  }, [mapData]);

  const verdictClass = analysis ? `trap-verdict--${analysis.verdict}` : '';

  const handleMapBarClick = (strike: number) => {
    setSelectedStrike(strike);
    setView('single');
  };

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

      {/* View Toggle + Position Selector */}
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
          {view === 'single' && (
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
          )}
          <div className="trap-input__group">
            <label className="trap-input__label">View</label>
            <div className="trap-view-toggle">
              <button
                className={`trap-view-toggle__btn ${view === 'single' ? 'active' : ''}`}
                onClick={() => setView('single')}
              >
                Single
              </button>
              <button
                className={`trap-view-toggle__btn ${view === 'map' ? 'active' : ''}`}
                onClick={() => setView('map')}
              >
                Map
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Single View - Verdict */}
      {view === 'single' && analysis && (
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
            <div className="trap-detail">
              <span className="trap-detail__label">OI Signal</span>
              <span className={`trap-detail__value trap-detail__value--${analysis.oiSignal.sentiment}`}>
                {analysis.oiSignal.label}
              </span>
            </div>
            <div className="trap-detail">
              <span className="trap-detail__label">Max Pain</span>
              <span className="trap-detail__value">
                {analysis.maxPain} ({analysis.distanceToMaxPain > 0 ? `${analysis.distanceToMaxPain} pts away` : 'at strike'})
              </span>
            </div>
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

      {/* Map View - Bar Chart */}
      {view === 'map' && mapData.length > 0 && (
        <div className="trap-map">
          <div className="trap-map__body">
            <div className="trap-map__yaxis">
              {[...Array(5)].map((_, i) => {
                const value = Math.round(maxTrapScore * (4 - i) / 4);
                return <span key={i} style={{ top: `${(i / 4) * 100}%` }}>{value}</span>;
              })}
            </div>
            <div className="trap-map__chart">
              <div className="trap-map__bars">
                <div className="trap-map__gridlines">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="trap-map__gridline" style={{ top: `${(i / 4) * 100}%` }} />
                  ))}
                </div>
                {/* Threshold zones */}
                <div className="trap-map__zone trap-map__zone--trapped" style={{ height: `${((maxTrapScore - 4) / maxTrapScore) * 100}%` }} />
                <div className="trap-map__zone trap-map__zone--caution" style={{ top: `${((maxTrapScore - 4) / maxTrapScore) * 100}%`, height: `${(2 / maxTrapScore) * 100}%` }} />
                {mapData.map((item) => {
                  const height = maxTrapScore > 0 ? (item.trapScore / maxTrapScore) * 100 : 0;
                  const displayHeight = item.trapScore === 0 ? 8 : height; // minimum height for safe bars
                  const isAtm = item.strike === atmStrike;
                  const barColor = item.verdict === 'likely-trapped' ? 'var(--trap-red)' :
                    item.verdict === 'caution' ? 'var(--trap-yellow)' : 'var(--trap-green)';
                  return (
                    <div
                      key={item.strike}
                      className={`trap-map__col ${isAtm ? 'trap-map__col--atm' : ''}`}
                      onClick={() => handleMapBarClick(item.strike)}
                      title={`${item.strike}: ${item.verdictLabel} (score: ${item.trapScore})`}
                    >
                      <div
                        className="trap-map__bar"
                        style={{ height: `${displayHeight}%`, background: barColor }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="trap-map__xaxis">
                {mapData.map((item) => (
                  <span key={item.strike} className="trap-map__strike-label">
                    {item.strike % 100 === 0 ? item.strike : ''}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="trap-map__legend">
            <span className="trap-map__legend-item"><span className="trap-map__legend-dot trap-map__legend-dot--safe"></span>Safe</span>
            <span className="trap-map__legend-item"><span className="trap-map__legend-dot trap-map__legend-dot--caution"></span>Caution</span>
            <span className="trap-map__legend-item"><span className="trap-map__legend-dot trap-map__legend-dot--trapped"></span>Likely Trapped</span>
            <span className="trap-map__legend-hint">Click bar for details</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrapAnalyzer;
