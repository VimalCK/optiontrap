import React, { useState } from 'react';
import type { KitePosition } from '@/services/kiteApi';
import { positionsPnl } from '@/services/livePositions';
import { useLivePositions } from '@/hooks/useLivePositions';
import TradingViewLink from '@/components/TradingViewLink/TradingViewLink';
import Message from '@/components/Message/Message';
import LoadingState from '@/components/LoadingState/LoadingState';
import { RefreshIcon } from '@/components/icons/Icons';
import { formatSignedAmount } from '@/utils/formatAmount';
import { LiveView, type LiveViewId, MessageTone } from '@/utils/uiEnums';
import { Side } from '../../../shared/tradeEnums.js';
import { pnlTone } from './riskLabels';

/** Kite's live position lists, in the order their tabs show. */
const LIVE_VIEWS: LiveViewId[] = [LiveView.Net, LiveView.Day];

const LiveViewControls: React.FC<{ view: LiveViewId; onView: (view: LiveViewId) => void; onRefresh: () => void }> = ({ view, onView, onRefresh }) => (
  <div className="live-positions__controls">
    <div className="positions-mode-tabs">
      {LIVE_VIEWS.map((v) => (
        <button key={v} className={`positions-mode-tab ${view === v ? 'positions-mode-tab--active' : ''}`} onClick={() => onView(v)}>
          {v === LiveView.Net ? 'Net Positions' : 'Day Positions'}
        </button>
      ))}
    </div>
    <button className="oc-refresh-btn" onClick={onRefresh}>
      <RefreshIcon size={12} strokeWidth={2.2} />
      Refresh
    </button>
  </div>
);

const LiveInstrument: React.FC<{ pos: KitePosition }> = ({ pos }) => (
  <span className="positions-table__instrument">
    <span className="live-positions__symbol">{pos.tradingsymbol}</span>
    <TradingViewLink symbol={pos.tradingsymbol} exchange={pos.exchange} />
    <span className="live-positions__exchange">{pos.exchange}</span>
  </span>
);

const positionKey = (pos: KitePosition) => `${pos.exchange}:${pos.tradingsymbol}`;

const ActivePositionsTable: React.FC<{ list: KitePosition[] }> = ({ list }) => (
  <div className="card" style={{ marginBottom: 'var(--card-gap)' }}>
    <h4 className="live-positions__section-title">Active</h4>
    <div className="positions-table-scroll">
      <table className="positions-table live-positions-table">
        <thead>
          <tr>
            <th>Instrument</th>
            <th>Product</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Avg</th>
            <th>LTP</th>
            <th>P&L</th>
          </tr>
        </thead>
        <tbody>
          {list.map((pos) => {
            const side = pos.quantity > 0 ? Side.BUY : Side.SELL;
            return (
              <tr key={positionKey(pos)}>
                <td><LiveInstrument pos={pos} /></td>
                <td><span className="live-positions__product">{pos.product}</span></td>
                <td><span className={`positions-table__side positions-table__side--${side.toLowerCase()}`}>{side}</span></td>
                <td>{Math.abs(pos.quantity)}</td>
                <td>{pos.average_price > 0 ? pos.average_price.toFixed(2) : '-'}</td>
                <td>{pos.last_price > 0 ? pos.last_price.toFixed(2) : '-'}</td>
                <td className={pnlTone(pos.pnl)}>{formatSignedAmount(pos.pnl)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
);

const ExitedPositionsTable: React.FC<{ list: KitePosition[] }> = ({ list }) => (
  <div className="card" style={{ marginBottom: 'var(--card-gap)' }}>
    <h4 className="live-positions__section-title">Exited</h4>
    <div className="positions-table-scroll">
      <table className="positions-table live-positions-table">
        <thead>
          <tr>
            <th>Instrument</th>
            <th>P&L</th>
          </tr>
        </thead>
        <tbody>
          {list.map((pos) => (
            <tr key={positionKey(pos)} className="positions-table__row--exited">
              <td><LiveInstrument pos={pos} /></td>
              <td className={pnlTone(pos.pnl)}>{formatSignedAmount(pos.pnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const LivePositions: React.FC = () => {
  // Priced from quotes on load and from ticks while the market is open.
  const { positions, loading, error, reload } = useLivePositions();
  const [view, setView] = useState<LiveViewId>(LiveView.Net);

  if (loading) return <div className="card"><LoadingState label="Loading live positions…" /></div>;
  if (error) return <Message tone={MessageTone.Error}>{error}</Message>;

  const rows = view === LiveView.Net ? positions.net : positions.day;
  const controls = <LiveViewControls view={view} onView={setView} onRefresh={reload} />;

  if (rows.length === 0) {
    return (
      <>
        {controls}
        <div className="card">
          <h3 className="card__title">No {view === LiveView.Net ? 'Net' : 'Day'} Positions</h3>
          <p className="card__description">No open positions for the selected view.</p>
        </div>
      </>
    );
  }

  const openRows = rows.filter((p) => p.quantity !== 0);
  const closedRows = rows.filter((p) => p.quantity === 0);
  const totalPnL = positionsPnl(rows);

  return (
    <>
      {controls}
      <div className="card" style={{ marginBottom: 'var(--card-gap)' }}>
        <div className="positions-summary">
          <div className="positions-summary__item">
            <span className="positions-summary__label">Total P&L</span>
            <span className={`positions-summary__value ${pnlTone(totalPnL)}`}>{formatSignedAmount(totalPnL)}</span>
          </div>
        </div>
      </div>
      {openRows.length > 0 && <ActivePositionsTable list={openRows} />}
      {closedRows.length > 0 && <ExitedPositionsTable list={closedRows} />}
    </>
  );
};

export default LivePositions;
