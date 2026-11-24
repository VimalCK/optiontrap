import React, { useState } from 'react';
import type { Position } from '@/services/positions';
import IconButton from '@/components/IconButton/IconButton';
import { ChevronDownIcon } from '@/components/icons/Icons';
import { useStrategies } from '@/hooks/useStrategies';
import TradingViewLink from '@/components/TradingViewLink/TradingViewLink';
import PositionInstrument from '@/components/PositionInstrument/PositionInstrument';
import DayGroupRow, { useDayGroups } from '@/components/DayGroupRow/DayGroupRow';
import { groupByMarketDay } from '@/utils/groupByMarketDay';
import { istTimeLabel } from '@/utils/marketStatus';
import { paperPositionPnl, paperPositionsPnl } from './paperPnl';
import { pnlTone } from './riskLabels';
import { positionRows, type PositionRow } from './strategyLegs';

const hasJournalNotes = (pos: Position) => pos.confidence != null || pos.targetPrice != null || pos.stopLossPrice != null || !!pos.note;

/** The last column holds the Exit button or the Exited badge, so it has no heading. */
export const PAPER_POSITION_COLUMNS = ['Instrument', 'Side', 'Qty', 'Avg', 'LTP/Exit', 'P&L', ''];

const NUMBER_COLUMNS = new Set(['Qty', 'Avg', 'LTP/Exit', 'P&L']);

/** Columns before P&L, so a day's P&L lines up under it. */
const PNL_COLUMN = PAPER_POSITION_COLUMNS.indexOf('P&L');

/** The paper positions table and its header, around the bodies given (a tbody per day). */
export const PaperPositionsFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="positions-table-scroll">
    <table className="positions-table">
      <thead className="sticky-head">
        <tr>
          {PAPER_POSITION_COLUMNS.map((column, index) => <th key={index} className={NUMBER_COLUMNS.has(column) ? 'table-num' : undefined}>{column}</th>)}
        </tr>
      </thead>
      {children}
    </table>
  </div>
);

interface PaperPositionRowProps {
  pos: Position;
  ltp: number | undefined;
  onExit: () => void;
  /** Under the instrument: a combined row's legs toggle, or a leg's strategy. */
  extra?: React.ReactNode;
  className?: string;
}

const rowClass = (pos: Position, className: string | undefined) =>
  [pos.exited ? 'positions-table__row--exited' : '', className].filter(Boolean).join(' ');

const PaperPositionRow: React.FC<PaperPositionRowProps> = ({ pos, ltp, onExit, extra, className }) => {
  const pnl = paperPositionPnl(pos, ltp);
  return (
    <tr className={rowClass(pos, className)}>
      <td>
        {/* The entry time only: the day is in the group's heading row. */}
        <PositionInstrument instrument={pos} detail={istTimeLabel(new Date(pos.entryTime))}>
          <TradingViewLink symbol={pos.tradingsymbol} exchange={pos.exchange} />
        </PositionInstrument>
        {extra}
        {hasJournalNotes(pos) && (
          <div className="positions-table__meta">
            {pos.confidence != null && <span>Conf {pos.confidence}%</span>}
            {pos.targetPrice != null && <span>Tgt {pos.targetPrice.toFixed(2)}</span>}
            {pos.stopLossPrice != null && <span>SL {pos.stopLossPrice.toFixed(2)}</span>}
            {pos.note && <span className="positions-table__note">{pos.note}</span>}
          </div>
        )}
      </td>
      <td><span className={`positions-table__side positions-table__side--${pos.side.toLowerCase()}`}>{pos.side}</span></td>
      <td className="table-num">{pos.quantity}</td>
      <td className="table-num">{pos.entryPrice.toFixed(2)}</td>
      <td className="table-num">
        {pos.exited ? pos.exitPrice!.toFixed(2) : (ltp !== undefined ? ltp.toFixed(2) : '-')}
        {/* Still ticking after the exit, to see where the price went since; the P&L stays at the exit. */}
        {pos.exited && ltp !== undefined && <span className="positions-table__pct">LTP {ltp.toFixed(2)}</span>}
      </td>
      <td className={`table-num ${pnlTone(pnl.value)}`}>
        {pnl.value >= 0 ? '+' : ''}{pnl.value.toFixed(2)}
        <span className="positions-table__pct">{pnl.pct >= 0 ? '+' : ''}{pnl.pct.toFixed(2)}%</span>
      </td>
      <td>
        {pos.exited
          ? <span className="positions-table__exited-badge">EXITED</span>
          : <button type="button" className="positions-table__exit" onClick={onExit} title="Exit position">EXIT</button>}
      </td>
    </tr>
  );
};

/** Several strategies' positions in one instrument: one row as the broker shows it, its legs folded under it. */
const CombinedPositionRows: React.FC<{
  row: PositionRow;
  ltp: number | undefined;
  strategyLabel: (id: string | null) => string;
  onExit: (positions: Position[]) => void;
}> = ({ row, ltp, strategyLabel, onExit }) => {
  const [expanded, setExpanded] = useState(false);
  const legsToggle = (
    <div className="positions-table__legs">
      <IconButton
        icon={<ChevronDownIcon size={14} />}
        label={expanded ? 'Hide the strategies' : 'Show the strategies'}
        expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="positions-table__legs-toggle"
      />
      <span>{row.legs.length} strategies</span>
    </div>
  );
  return (
    <>
      <PaperPositionRow pos={row.position} ltp={ltp} onExit={() => onExit(row.legs)} extra={legsToggle} />
      {expanded && row.legs.map((leg) => (
        <PaperPositionRow
          key={leg.id}
          pos={leg}
          ltp={ltp}
          onExit={() => onExit([leg])}
          extra={<span className="positions-table__strategy">{strategyLabel(leg.strategyId)}</span>}
          className="positions-table__row--leg"
        />
      ))}
    </>
  );
};

/**
 * The positions grouped by the IST day they were opened, newest first, each day under its heading row. Several
 * strategies' open positions in one instrument show as one combined row, as the broker nets them.
 */
const PaperPositionsTable: React.FC<{
  positions: Position[];
  livePrices: Map<number, number>;
  /** Exit these positions: one, or every leg of a combined row. */
  onExit: (positions: Position[]) => void;
}> = ({ positions, livePrices, onExit }) => {
  const days = useDayGroups();
  const { strategies } = useStrategies();
  const strategyLabel = (id: string | null) => strategies?.find((s) => s.id === id)?.label ?? id ?? '';
  return (
    <PaperPositionsFrame>
      {groupByMarketDay(positionRows(positions), (row) => row.position.entryTime).map(({ day, items }) => (
        <tbody key={day}>
          <DayGroupRow
            day={day}
            count={items.length}
            noun="position"
            pnl={paperPositionsPnl(items.map((row) => row.position), livePrices)}
            pnlColumn={PNL_COLUMN}
            columns={PAPER_POSITION_COLUMNS.length}
            expanded={days.isExpanded(day)}
            onToggle={() => days.toggle(day)}
          />
          {days.isExpanded(day) && items.map((row) => {
            const ltp = livePrices.get(row.position.instrumentToken);
            return row.legs.length > 0
              ? <CombinedPositionRows key={row.position.id} row={row} ltp={ltp} strategyLabel={strategyLabel} onExit={onExit} />
              : <PaperPositionRow key={row.position.id} pos={row.position} ltp={ltp} onExit={() => onExit([row.position])} />;
          })}
        </tbody>
      ))}
    </PaperPositionsFrame>
  );
};

export default PaperPositionsTable;
