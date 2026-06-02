import React, { useState, useMemo } from 'react';
import { OptionChainRow } from '@/services/optionChain';
import { analyzeTrap, TrapAnalysis, calculateMaxPain, calculatePCR } from '@/services/trapAnalysis';
import { calculateExpectedMove } from '@/services/edgeScore';
import '@/styles/trapanalyzer.css';

interface TrapAnalyzerProps {
  chain: OptionChainRow[];
  oiData: Map<number, number>;
  prevDayOi: Map<number, number>;
  closePrices: Map<number, number>;
  livePrices: Map<number, number>;
  spotPrice: number;
  atmStrike: number;
  daysToExpiry?: number;
}

type PositionSide = 'buy' | 'sell';
type AnalyzerView = 'single' | 'map';

const TrapAnalyzer: React.FC<TrapAnalyzerProps> = ({
  chain,
  oiData,
  prevDayOi,
  closePrices,
  livePrices,
  spotPrice,
  atmStrike,
  daysToExpiry,
}) => {
  const [positionSide, setPositionSide] = useState<PositionSide>('buy');
  const [selectedStrike, setSelectedStrike] = useState<number>(atmStrike);
  const [view, setView] = useState<AnalyzerView>('map');
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null);

  // Update selected strike when ATM changes
  React.useEffect(() => {
    if (atmStrike > 0) setSelectedStrike(atmStrike);
  }, [atmStrike]);

  // Get available strikes for the dropdown
  const strikes = useMemo(() => chain.map((r) => r.strike), [chain]);

  // Summary metrics
  const maxPain = useMemo(() => calculateMaxPain(chain, oiData), [chain, oiData]);
  const pcr = useMemo(() => calculatePCR(chain, oiData), [chain, oiData]);
  const expectedMove = useMemo(() => calculateExpectedMove(chain, atmStrike, livePrices), [chain, atmStrike, livePrices]);

  // Run analysis for single view — both CE and PE
  const analysisCe: TrapAnalysis | null = useMemo(() => {
    if (chain.length === 0 || spotPrice === 0) return null;
    return analyzeTrap(`${positionSide}-ce`, selectedStrike, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices, daysToExpiry);
  }, [positionSide, selectedStrike, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices, daysToExpiry]);

  const analysisPe: TrapAnalysis | null = useMemo(() => {
    if (chain.length === 0 || spotPrice === 0) return null;
    return analyzeTrap(`${positionSide}-pe`, selectedStrike, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices, daysToExpiry);
  }, [positionSide, selectedStrike, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices, daysToExpiry]);

  // Run analysis for all strikes (map view) — both CE and PE
  const mapDataCe = useMemo(() => {
    if (chain.length === 0 || spotPrice === 0) return [];
    return chain.map((row) => {
      const result = analyzeTrap(`${positionSide}-ce`, row.strike, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices, daysToExpiry);
      return { strike: row.strike, ...result };
    });
  }, [positionSide, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices, daysToExpiry]);

  const mapDataPe = useMemo(() => {
    if (chain.length === 0 || spotPrice === 0) return [];
    return chain.map((row) => {
      const result = analyzeTrap(`${positionSide}-pe`, row.strike, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices, daysToExpiry);
      return { strike: row.strike, ...result };
    });
  }, [positionSide, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices, daysToExpiry]);

  const maxTrapScore = 9; // Fixed scale: max possible trap score (7 base + 2 time pressure)

  const handleMapBarClick = (strike: number) => {
    setSelectedStrike(strike);
    setView('single');
  };

  const renderVerdict = (analysis: TrapAnalysis, label: string) => {
    const verdictClass = `trap-verdict--${analysis.verdict}`;
    return (
      <div className={`trap-verdict ${verdictClass}`}>
        <div className="trap-verdict__header">
          <span className="trap-verdict__icon">
            {analysis.verdict === 'safe' && '✓'}
            {analysis.verdict === 'caution' && '⚠'}
            {analysis.verdict === 'likely-trapped' && '✕'}
          </span>
          <span className="trap-verdict__label">{label}: {analysis.verdictLabel}</span>
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
    );
  };

  const renderMapChart = () => (
    <div className="trap-map__section">
      <div className="trap-map__butterfly">
        {/* CE label */}
        <div className="trap-map__side-label trap-map__side-label--ce">CE</div>
        <div className="trap-map__body">
          <div className="trap-map__yaxis">
            {/* Top half: 9 at top down to 0 at center */}
            {[9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((value) => (
              <span key={`top-${value}`} style={{ top: `${((9 - value) / 18) * 100}%` }}>{value}</span>
            ))}
            {/* Bottom half: 1 to 9 going down */}
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((value) => (
              <span key={`bot-${value}`} style={{ top: `${((9 + value) / 18) * 100}%` }}>{value}</span>
            ))}
          </div>
          <div className="trap-map__chart">
            {/* CE bars (grow upward from center) */}
            <div className="trap-map__bars trap-map__bars--top">
              <div className="trap-map__gridlines">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((value) => (
                  <div key={value} className="trap-map__gridline" style={{ bottom: `${(value / 9) * 100}%` }} />
                ))}
              </div>
              <div className="trap-map__zone trap-map__zone--safe" style={{ bottom: '0%', height: `${(2 / 9) * 100}%` }} />
              <div className="trap-map__zone trap-map__zone--caution" style={{ bottom: `${(2 / 9) * 100}%`, height: `${(2 / 9) * 100}%` }} />
              <div className="trap-map__zone trap-map__zone--trapped" style={{ bottom: `${(4 / 9) * 100}%`, height: `${(5 / 9) * 100}%` }} />
              {mapDataCe.map((item, idx) => {
                const height = item.trapScore === 0 ? 8 : (item.trapScore / 9) * 100;
                const isAtm = item.strike === atmStrike;
                const isMaxPain = item.strike === maxPain;
                const inExpectedRange = expectedMove > 0 && item.strike >= (spotPrice - expectedMove) && item.strike <= (spotPrice + expectedMove);
                const nextItem = mapDataCe[idx + 1];
                const prevItem = mapDataCe[idx - 1];
                const isRangeStart = inExpectedRange && (!prevItem || prevItem.strike < (spotPrice - expectedMove));
                const isRangeEnd = inExpectedRange && (!nextItem || nextItem.strike > (spotPrice + expectedMove));
                const barColor = item.verdict === 'likely-trapped' ? 'var(--trap-red)' :
                  item.verdict === 'caution' ? 'var(--trap-yellow)' : 'var(--trap-green)';
                return (
                  <div
                    key={item.strike}
                    className={`trap-map__col ${isAtm ? 'trap-map__col--atm' : ''} ${isMaxPain ? 'trap-map__col--maxpain' : ''} ${inExpectedRange ? 'trap-map__col--in-range' : ''} ${isRangeStart ? 'trap-map__col--range-start' : ''} ${isRangeEnd ? 'trap-map__col--range-end' : ''} ${hoveredStrike === item.strike ? 'trap-map__col--hovered' : ''}`}
                    onClick={() => handleMapBarClick(item.strike)}
                    onMouseEnter={() => setHoveredStrike(item.strike)}
                    onMouseLeave={() => setHoveredStrike(null)}
                    title={`${item.strike} CE: ${item.verdictLabel} (score: ${item.trapScore})${isMaxPain ? ' — MAX PAIN' : ''}${inExpectedRange ? ' — Within expected range' : ''}`}
                  >
                    <div className="trap-map__bar" style={{ height: `${height}%`, background: barColor }} />
                  </div>
                );
              })}
            </div>
            {/* Center axis line */}
            <div className="trap-map__center-axis" />
            {/* PE bars (grow downward from center) */}
            <div className="trap-map__bars trap-map__bars--bottom">
              <div className="trap-map__gridlines">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((value) => (
                  <div key={value} className="trap-map__gridline" style={{ top: `${(value / 9) * 100}%` }} />
                ))}
              </div>
              <div className="trap-map__zone trap-map__zone--safe" style={{ top: '0%', height: `${(2 / 9) * 100}%` }} />
              <div className="trap-map__zone trap-map__zone--caution" style={{ top: `${(2 / 9) * 100}%`, height: `${(2 / 9) * 100}%` }} />
              <div className="trap-map__zone trap-map__zone--trapped" style={{ top: `${(4 / 9) * 100}%`, height: `${(5 / 9) * 100}%` }} />
              {mapDataPe.map((item, idx) => {
                const height = item.trapScore === 0 ? 8 : (item.trapScore / 9) * 100;
                const isAtm = item.strike === atmStrike;
                const isMaxPain = item.strike === maxPain;
                const inExpectedRange = expectedMove > 0 && item.strike >= (spotPrice - expectedMove) && item.strike <= (spotPrice + expectedMove);
                const nextItem = mapDataPe[idx + 1];
                const prevItem = mapDataPe[idx - 1];
                const isRangeStart = inExpectedRange && (!prevItem || prevItem.strike < (spotPrice - expectedMove));
                const isRangeEnd = inExpectedRange && (!nextItem || nextItem.strike > (spotPrice + expectedMove));
                const barColor = item.verdict === 'likely-trapped' ? 'var(--trap-red)' :
                  item.verdict === 'caution' ? 'var(--trap-yellow)' : 'var(--trap-green)';
                return (
                  <div
                    key={item.strike}
                    className={`trap-map__col ${isAtm ? 'trap-map__col--atm' : ''} ${isMaxPain ? 'trap-map__col--maxpain' : ''} ${inExpectedRange ? 'trap-map__col--in-range' : ''} ${isRangeStart ? 'trap-map__col--range-start' : ''} ${isRangeEnd ? 'trap-map__col--range-end' : ''} ${hoveredStrike === item.strike ? 'trap-map__col--hovered' : ''}`}
                    onClick={() => handleMapBarClick(item.strike)}
                    onMouseEnter={() => setHoveredStrike(item.strike)}
                    onMouseLeave={() => setHoveredStrike(null)}
                    title={`${item.strike} PE: ${item.verdictLabel} (score: ${item.trapScore})${isMaxPain ? ' — MAX PAIN' : ''}${inExpectedRange ? ' — Within expected range' : ''}`}
                  >
                    <div className="trap-map__bar" style={{ height: `${height}%`, background: barColor }} />
                  </div>
                );
              })}
            </div>
            {/* X-axis labels */}
            <div className="trap-map__xaxis">
              {mapDataCe.map((item) => (
                <span key={item.strike} className="trap-map__strike-label">
                  {item.strike % 100 === 0 ? item.strike : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
        {/* PE label */}
        <div className="trap-map__side-label trap-map__side-label--pe">PE</div>
      </div>
    </div>
  );

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
        <div className="trap-summary__item">
          <span className="trap-summary__label">Expected Move</span>
          <span className="trap-summary__value">{expectedMove > 0 ? `±${expectedMove.toFixed(0)}` : '-'}</span>
        </div>
      </div>

      {/* View Toggle + Position Selector */}
      <div className="trap-input">
        <div className="trap-input__row">
          <div className="trap-input__group">
            <label className="trap-input__label">Position</label>
            <select
              className="trap-input__select"
              value={positionSide}
              onChange={(e) => setPositionSide(e.target.value as PositionSide)}
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
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
                className={`trap-view-toggle__btn ${view === 'map' ? 'active' : ''}`}
                onClick={() => setView('map')}
              >
                Map
              </button>
              <button
                className={`trap-view-toggle__btn ${view === 'single' ? 'active' : ''}`}
                onClick={() => setView('single')}
              >
                Single
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Single View - CE and PE side by side */}
      {view === 'single' && analysisCe && analysisPe && (
        <div className="trap-verdict-grid">
          {renderVerdict(analysisCe, 'CE')}
          {renderVerdict(analysisPe, 'PE')}
        </div>
      )}

      {/* Map View - CE and PE bars in same chart */}
      {view === 'map' && mapDataCe.length > 0 && (
        <div className="trap-map">
          {renderMapChart()}
          <div className="trap-map__legend">
            <span className="trap-map__legend-item"><span className="trap-map__legend-dot trap-map__legend-dot--safe"></span>Safe</span>
            <span className="trap-map__legend-item"><span className="trap-map__legend-dot trap-map__legend-dot--caution"></span>Caution</span>
            <span className="trap-map__legend-item"><span className="trap-map__legend-dot trap-map__legend-dot--trapped"></span>Likely Trapped</span>
            <span className="trap-map__legend-item"><span className="trap-map__legend-line trap-map__legend-line--atm"></span>ATM</span>
            <span className="trap-map__legend-item"><span className="trap-map__legend-line trap-map__legend-line--maxpain"></span>Max Pain</span>
            <span className="trap-map__legend-item"><span className="trap-map__legend-dot trap-map__legend-dot--range"></span>Expected Range</span>
          </div>
          <div className="trap-map__legend-hint">Click bar for details</div>
        </div>
      )}
    </div>
  );
};

export default TrapAnalyzer;
