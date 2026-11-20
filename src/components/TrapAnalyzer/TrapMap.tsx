import React, { useState } from 'react';
import { MAX_TRAP_SCORE, TRAP_CAUTION_SCORE, TRAP_LIKELY_SCORE, type TrapAnalysis } from '@/services/trapAnalysis';
import { OptionType, type OptionTypeId } from '../../../shared/tradeEnums.js';
import { TrapVerdict } from '../../../shared/analysisEnums.js';
import { isLabelledStrike } from './strikeLabels';

export type TrapMapRow = TrapAnalysis & { strike: number };

interface TrapMapProps {
  ceRows: TrapMapRow[];
  peRows: TrapMapRow[];
  atmStrike: number;
  maxPain: number;
  spotPrice: number;
  expectedMove: number;
  labelStep: number;
  onSelect: (strike: number) => void;
}

/** A safe strike still gets a short bar, so every strike shows. */
const SAFE_STUB_SHARE = 0.06;

const ZONES = [
  { verdict: TrapVerdict.Safe, from: 0, to: TRAP_CAUTION_SCORE },
  { verdict: TrapVerdict.Caution, from: TRAP_CAUTION_SCORE, to: TRAP_LIKELY_SCORE },
  { verdict: TrapVerdict.LikelyTrapped, from: TRAP_LIKELY_SCORE, to: MAX_TRAP_SCORE },
];

const percent = (score: number) => `${(score / MAX_TRAP_SCORE) * 100}%`;

/** A bar's height as a share of its half: its score on the 0–9 scale, or a stub for a score of 0. */
export const barShare = (trapScore: number): number => (trapScore === 0 ? SAFE_STUB_SHARE : Math.min(1, trapScore / MAX_TRAP_SCORE));

/** Whether a strike lies within spot ± the expected move. */
const inRange = (strike: number, spotPrice: number, expectedMove: number) =>
  expectedMove > 0 && strike >= spotPrice - expectedMove && strike <= spotPrice + expectedMove;

interface HalfProps extends Pick<TrapMapProps, 'atmStrike' | 'maxPain' | 'spotPrice' | 'expectedMove' | 'onSelect'> {
  rows: TrapMapRow[];
  optionType: OptionTypeId;
  hovered: number | null;
  onHover: (strike: number | null) => void;
}

/** One half of the map: calls rise above the centre line, puts hang below it. */
const MapHalf: React.FC<HalfProps> = ({ rows, optionType, atmStrike, maxPain, spotPrice, expectedMove, hovered, onHover, onSelect }) => {
  const calls = optionType === OptionType.CE;
  // Calls grow up from the centre line, so their zones stack from the bottom edge; puts from the top.
  const edge = calls ? 'bottom' : 'top';
  return (
    <div className={calls ? 'trap-map__bars trap-map__bars--top' : 'trap-map__bars trap-map__bars--bottom'}>
      {ZONES.map(({ verdict, from, to }) => (
        <div key={verdict} className={`trap-map__zone trap-map__zone--${verdict.toLowerCase()}`} style={{ [edge]: percent(from), height: percent(to - from) }} />
      ))}
      <span className="trap-map__half-label">{optionType === OptionType.CE ? 'Calls' : 'Puts'}</span>
      {rows.map((row, idx) => {
        const range = inRange(row.strike, spotPrice, expectedMove);
        const classes = [
          'trap-map__col',
          row.strike === atmStrike && 'trap-map__col--atm',
          row.strike === maxPain && 'trap-map__col--maxpain',
          range && 'trap-map__col--in-range',
          range && !inRange(rows[idx - 1]?.strike ?? -Infinity, spotPrice, expectedMove) && 'trap-map__col--range-start',
          range && !inRange(rows[idx + 1]?.strike ?? Infinity, spotPrice, expectedMove) && 'trap-map__col--range-end',
          hovered === row.strike && 'trap-map__col--hovered',
        ].filter(Boolean).join(' ');
        return (
          <div
            key={row.strike}
            className={classes}
            onClick={() => onSelect(row.strike)}
            onMouseEnter={() => onHover(row.strike)}
            onMouseLeave={() => onHover(null)}
          >
            <div className={`trap-map__bar trap-map__bar--${row.verdict.toLowerCase()}`} style={{ height: `${barShare(row.trapScore) * 100}%` }} />
          </div>
        );
      })}
    </div>
  );
};

const Verdict: React.FC<{ type: OptionTypeId; row?: TrapMapRow }> = ({ type, row }) => (
  row ? (
    <span className={`trap-map__readout-verdict trap-map__readout-verdict--${row.verdict.toLowerCase()}`}>
      {type} · {row.verdictLabel} <span className="trap-map__readout-score">({row.trapScore})</span>
    </span>
  ) : null
);

/**
 * Every strike's trap score for the chosen position: calls above the centre
 * line, puts below, coloured by verdict over the Safe / Caution / Trapped zones.
 * The line on top reads out the strike under the pointer (ATM until then).
 */
const TrapMap: React.FC<TrapMapProps> = ({ ceRows, peRows, atmStrike, maxPain, spotPrice, expectedMove, labelStep, onSelect }) => {
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = hovered ?? atmStrike;
  const tags = [
    shown === atmStrike && 'ATM',
    shown === maxPain && 'Max pain',
    inRange(shown, spotPrice, expectedMove) && 'In expected range',
  ].filter(Boolean);
  const half = { atmStrike, maxPain, spotPrice, expectedMove, hovered, onHover: setHovered, onSelect };

  return (
    <div className="trap-map">
      <div className="trap-map__readout">
        <span className="trap-map__readout-strike">{shown.toLocaleString('en-IN')}</span>
        <Verdict type={OptionType.CE} row={ceRows.find((row) => row.strike === shown)} />
        <Verdict type={OptionType.PE} row={peRows.find((row) => row.strike === shown)} />
        {tags.map((tag) => <span key={String(tag)} className="trap-map__readout-tag">{tag}</span>)}
      </div>

      <div className="trap-map__frame">
        <div className="trap-map__plot">
          <div className="trap-map__markers" aria-hidden="true">
            {ceRows.map((row) => (
              <span key={row.strike} className="trap-map__marker">
                {row.strike === atmStrike && <span className="trap-map__flag trap-map__flag--atm">ATM</span>}
                {row.strike === maxPain && <span className="trap-map__flag trap-map__flag--maxpain">MP</span>}
              </span>
            ))}
          </div>
          <MapHalf rows={ceRows} optionType={OptionType.CE} {...half} />
          <div className="trap-map__center-axis" />
          <MapHalf rows={peRows} optionType={OptionType.PE} {...half} />
          <div className="trap-map__xaxis">
            {ceRows.map((row) => (
              <span key={row.strike} className="trap-map__strike-label">{isLabelledStrike(row.strike, labelStep) ? row.strike : ''}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="trap-map__legend">
        <span className="trap-map__legend-item"><span className="trap-map__legend-dot trap-map__legend-dot--safe" />Safe</span>
        <span className="trap-map__legend-item"><span className="trap-map__legend-dot trap-map__legend-dot--caution" />Caution</span>
        <span className="trap-map__legend-item"><span className="trap-map__legend-dot trap-map__legend-dot--likelytrapped" />Likely trapped</span>
        <span className="trap-map__legend-item"><span className="trap-map__legend-line trap-map__legend-line--atm" />ATM</span>
        <span className="trap-map__legend-item"><span className="trap-map__legend-line trap-map__legend-line--maxpain" />Max pain</span>
        <span className="trap-map__legend-item"><span className="trap-map__legend-dot trap-map__legend-dot--range" />Expected range</span>
        <span className="trap-map__legend-hint">Click a bar for that strike's details</span>
      </div>
    </div>
  );
};

export default TrapMap;
