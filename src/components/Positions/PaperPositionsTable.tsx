import React from 'react';
import type { Position } from '@/services/positions';
import TradingViewLink from '@/components/TradingViewLink/TradingViewLink';
import PositionInstrument from '@/components/PositionInstrument/PositionInstrument';
import DayGroupRow, { useDayGroups } from '@/components/DayGroupRow/DayGroupRow';
import { groupByMarketDay } from '@/utils/groupByMarketDay';
import { paperPositionPnl, paperPositionsPnl } from './paperPnl';
import { pnlTone } from './riskLabels';

const hasJournalNotes = (pos: Position) => pos.confidence != null || pos.targetPrice != null || pos.stopLossPrice != null || !!pos.note;

/** The last column holds the Exit button or the Exited badge, so it has no heading. */
export const PAPER_POSITION_COLUMNS = ['Instrument', 'Side', 'Qty', 'Avg', 'LTP/Exit', 'P&L', ''];

/** Columns before P&L, so a day's P&L lines up under it. */
const PNL_COLUMN = PAPER_POSITION_COLUMNS.indexOf('P&L');

/** The paper positions table and its header, around the bodies given (a tbody per day). */
export const PaperPositionsFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="positions-table-scroll">
    <table className="positions-table">
      <thead>
        <tr>
          {PAPER_POSITION_COLUMNS.map((column, index) => <th key={index}>{column}</th>)}
        </tr>
      </thead>
      {children}
    </table>
  </div>
);

const PaperPositionRow: React.FC<{ pos: Position; ltp: number | undefined; onExit: (pos: Position) => void }> = ({ pos, ltp, onExit }) => {
  const pnl = paperPositionPnl(pos, ltp);
  return (
    <tr className={pos.exited ? 'positions-table__row--exited' : ''}>
      <td>
        <PositionInstrument instrument={pos}>
          <TradingViewLink symbol={pos.tradingsymbol} exchange={pos.exchange} />
        </PositionInstrument>
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
      <td>{pos.quantity}</td>
      <td>{pos.entryPrice.toFixed(2)}</td>
      <td>{pos.exited ? pos.exitPrice!.toFixed(2) : (ltp !== undefined ? ltp.toFixed(2) : '-')}</td>
      <td className={pnlTone(pnl.value)}>
        {pnl.value >= 0 ? '+' : ''}{pnl.value.toFixed(2)}
        <span className="positions-table__pct"> ({pnl.pct >= 0 ? '+' : ''}{pnl.pct.toFixed(2)}%)</span>
      </td>
      <td>
        {pos.exited
          ? <span className="positions-table__exited-badge">EXITED</span>
          : <button type="button" className="positions-table__exit" onClick={() => onExit(pos)} title="Exit position">EXIT</button>}
      </td>
    </tr>
  );
};

/** The positions grouped by the IST day they were opened, newest first, each day under its heading row. */
const PaperPositionsTable: React.FC<{
  positions: Position[];
  livePrices: Map<number, number>;
  onExit: (pos: Position) => void;
}> = ({ positions, livePrices, onExit }) => {
  const days = useDayGroups();
  return (
    <PaperPositionsFrame>
      {groupByMarketDay(positions, (pos) => pos.entryTime).map(({ day, items }) => (
        <tbody key={day}>
          <DayGroupRow
            day={day}
            count={items.length}
            noun="position"
            pnl={paperPositionsPnl(items, livePrices)}
            pnlColumn={PNL_COLUMN}
            columns={PAPER_POSITION_COLUMNS.length}
            expanded={days.isExpanded(day)}
            onToggle={() => days.toggle(day)}
          />
          {days.isExpanded(day) && items.map((pos) => <PaperPositionRow key={pos.id} pos={pos} ltp={livePrices.get(pos.instrumentToken)} onExit={onExit} />)}
        </tbody>
      ))}
    </PaperPositionsFrame>
  );
};

export default PaperPositionsTable;
