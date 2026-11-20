import React, { useState, useMemo } from 'react';
import { OptionChainRow } from '@/services/optionChain';
import { analyzeTrap, buildTrapContext, trapPositionOf, TrapAnalysis, type TrapContext } from '@/services/trapAnalysis';
import AppSelect from '@/components/AppSelect/AppSelect';
import SegmentedControl, { type SegmentOption } from '@/components/SegmentedControl/SegmentedControl';
import IconButton from '@/components/IconButton/IconButton';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons/Icons';
import type { FlowReading } from '@/services/oiFlow';
import { OptionType, SIDES, Side, type OptionTypeId, type SideId } from '../../../shared/tradeEnums.js';
import { AnalyzerView, Tone, type AnalyzerViewId } from '@/utils/uiEnums';
import '@/styles/trapanalyzer.css';
import { strikeLabelStep } from './strikeLabels';
import TrapMap, { type TrapMapRow } from './TrapMap';
import TrapVerdictCard from './TrapVerdictCard';

interface TrapAnalyzerProps {
  chain: OptionChainRow[];
  oiData: Map<number, number>;
  prevDayOi: Map<number, number>;
  closePrices: Map<number, number>;
  livePrices: Map<number, number>;
  spotPrice: number;
  atmStrike: number;
  daysToExpiry?: number;
  maxPain: number;
  expectedMove: number;
  /** IV-based flow per option token; shown next to the OI signal, not scored. */
  flowByToken?: Map<number, FlowReading>;
}

/** A sold position shows red when chosen, a bought one green. */
const POSITION_OPTIONS: SegmentOption<SideId>[] = SIDES.map(({ id, label }) => ({ id, label, tone: id === Side.SELL ? Tone.Negative : Tone.Positive }));

const VIEW_OPTIONS: SegmentOption<AnalyzerViewId>[] = [
  { id: AnalyzerView.Map, label: 'Map' },
  { id: AnalyzerView.Single, label: 'Single' },
];

interface MapInputs {
  chain: OptionChainRow[];
  spotPrice: number;
  oiData: Map<number, number>;
  prevDayOi: Map<number, number>;
  closePrices: Map<number, number>;
  livePrices: Map<number, number>;
  daysToExpiry?: number;
}

/** Every strike's trap analysis for one side and option type. */
function trapMapRows(side: SideId, optionType: OptionTypeId, inputs: MapInputs, trapCtx: TrapContext | null): TrapMapRow[] {
  if (!trapCtx) return [];
  const { chain, spotPrice, oiData, prevDayOi, closePrices, livePrices, daysToExpiry } = inputs;
  return chain.map((row) => ({
    strike: row.strike,
    ...analyzeTrap(trapPositionOf(side, optionType), row.strike, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices, daysToExpiry, trapCtx),
  }));
}

const TrapAnalyzer: React.FC<TrapAnalyzerProps> = ({
  chain,
  oiData,
  prevDayOi,
  closePrices,
  livePrices,
  spotPrice,
  atmStrike,
  daysToExpiry,
  maxPain,
  expectedMove,
  flowByToken,
}) => {
  const [positionSide, setPositionSide] = useState<SideId>(Side.SELL);
  const [selectedStrike, setSelectedStrike] = useState<number>(atmStrike);
  const [view, setView] = useState<AnalyzerViewId>(AnalyzerView.Map);

  React.useEffect(() => {
    if (atmStrike > 0) setSelectedStrike(atmStrike);
  }, [atmStrike]);

  const strikes = useMemo(() => chain.map((r) => r.strike), [chain]);
  const labelStep = useMemo(() => strikeLabelStep(chain), [chain]);

  // Built once per tick and shared: otherwise each analyzeTrap() call would recompute max pain,
  // PCR and OI walls for every strike (O(n³) overall).
  const trapCtx = useMemo(
    () => (chain.length > 0 && spotPrice > 0 ? buildTrapContext(chain, oiData, spotPrice) : null),
    [chain, oiData, spotPrice],
  );

  const analysisCe: TrapAnalysis | null = useMemo(() => {
    if (!trapCtx) return null;
    return analyzeTrap(trapPositionOf(positionSide, OptionType.CE), selectedStrike, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices, daysToExpiry, trapCtx);
  }, [positionSide, selectedStrike, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices, daysToExpiry, trapCtx]);

  const analysisPe: TrapAnalysis | null = useMemo(() => {
    if (!trapCtx) return null;
    return analyzeTrap(trapPositionOf(positionSide, OptionType.PE), selectedStrike, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices, daysToExpiry, trapCtx);
  }, [positionSide, selectedStrike, spotPrice, chain, oiData, prevDayOi, closePrices, livePrices, daysToExpiry, trapCtx]);

  const mapInputs = useMemo<MapInputs>(
    () => ({ chain, spotPrice, oiData, prevDayOi, closePrices, livePrices, daysToExpiry }),
    [chain, spotPrice, oiData, prevDayOi, closePrices, livePrices, daysToExpiry],
  );
  const mapDataCe = useMemo(() => trapMapRows(positionSide, OptionType.CE, mapInputs, trapCtx), [positionSide, mapInputs, trapCtx]);
  const mapDataPe = useMemo(() => trapMapRows(positionSide, OptionType.PE, mapInputs, trapCtx), [positionSide, mapInputs, trapCtx]);

  const handleMapBarClick = (strike: number) => {
    setSelectedStrike(strike);
    setView(AnalyzerView.Single);
  };

  const flowOf = (optionType: OptionTypeId) => {
    const row = chain.find((r) => r.strike === selectedStrike);
    const option = optionType === OptionType.CE ? row?.ce : row?.pe;
    return option ? flowByToken?.get(option.instrumentToken) : undefined;
  };

  const strikeIndex = strikes.indexOf(selectedStrike);
  const stepStrike = (offset: number) => {
    const next = strikes[strikeIndex + offset];
    if (next !== undefined) setSelectedStrike(next);
  };

  return (
    <div className="trap-analyzer">
      <div className="trap-controls">
        <div className="trap-controls__group">
          <span className="trap-controls__label">Position</span>
          <SegmentedControl options={POSITION_OPTIONS} value={positionSide} onChange={setPositionSide} label="Position" />
        </div>
        <div className="trap-controls__group">
          <span className="trap-controls__label">View</span>
          <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={setView} label="View" />
        </div>
        {view === AnalyzerView.Single && (
          <div className="trap-controls__group">
            <span className="trap-controls__label">Strike</span>
            <div className="trap-controls__strike">
              <IconButton icon={<ChevronLeftIcon />} label="Previous strike" onClick={() => stepStrike(-1)} disabled={strikeIndex <= 0} />
              <AppSelect
                className="trap-controls__strike-select"
                value={selectedStrike}
                options={strikes.map((s) => ({ value: s, label: s === atmStrike ? `${s} (ATM)` : String(s) }))}
                onChange={(v) => setSelectedStrike(Number(v))}
              />
              <IconButton icon={<ChevronRightIcon />} label="Next strike" onClick={() => stepStrike(1)} disabled={strikeIndex < 0 || strikeIndex >= strikes.length - 1} />
            </div>
          </div>
        )}
      </div>

      {view === AnalyzerView.Single && analysisCe && analysisPe && (
        <div className="trap-verdict-grid">
          <TrapVerdictCard analysis={analysisCe} strike={selectedStrike} optionType={OptionType.CE} flow={flowOf(OptionType.CE)} />
          <TrapVerdictCard analysis={analysisPe} strike={selectedStrike} optionType={OptionType.PE} flow={flowOf(OptionType.PE)} />
        </div>
      )}

      {view === AnalyzerView.Map && mapDataCe.length > 0 && (
        <TrapMap
          ceRows={mapDataCe}
          peRows={mapDataPe}
          atmStrike={atmStrike}
          maxPain={maxPain}
          spotPrice={spotPrice}
          expectedMove={expectedMove}
          labelStep={labelStep}
          onSelect={handleMapBarClick}
        />
      )}
    </div>
  );
};

export default TrapAnalyzer;
