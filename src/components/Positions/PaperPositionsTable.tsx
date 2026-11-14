import React from 'react';
import type { Position } from '@/services/positions';
import TradingViewLink from '@/components/TradingViewLink/TradingViewLink';
import PositionInstrument from '@/components/PositionInstrument/PositionInstrument';
import { paperPositionPnl } from './paperPnl';
import { pnlTone } from './riskLabels';

const hasJournalNotes = (pos: Position) => pos.confidence != null || pos.targetPrice != null || pos.stopLossPrice != null || !!pos.note;

/** The last column holds the Exit button or the Exited badge, so it has no heading. */
export const PAPER_POSITION_COLUMNS = ['Instrument', 'Side', 'Qty', 'Avg', 'LTP/Exit', 'P&L', ''];

/** The paper positions table and its header, around the rows given. */
export const PaperPositionsFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="positions-table-scroll">
    <table className="positions-table">
      <thead>
        <tr>
          {PAPER_POSITION_COLUMNS.map((column, index) => <th key={index}>{column}</th>)}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);

const PaperPositionsTable: React.FC<{
  positions: Position[];
  livePrices: Map<number, number>;
  onExit: (pos: Position) => void;
}> = ({ positions, livePrices, onExit }) => (
  <PaperPositionsFrame>
    {positions.map((pos) => {
      const ltp = livePrices.get(pos.instrumentToken);
      const pnl = paperPositionPnl(pos, ltp);
      return (
        <tr key={pos.id} className={pos.exited ? 'positions-table__row--exited' : ''}>
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
    })}
  </PaperPositionsFrame>
);

export default PaperPositionsTable;
