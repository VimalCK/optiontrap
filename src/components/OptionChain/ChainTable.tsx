import React from 'react';
import type { OptionChainRow, OptionInstrument } from '@/services/optionChain';
import { OptionType, Side, type OptionTypeId, type SideId } from '../../../shared/tradeEnums.js';
import { maxChainOi, optionPrice, percentChange, signedPercent, type Change } from './chainMetrics';

export interface ChainPrices {
  livePrices: Map<number, number>;
  closePrices: Map<number, number>;
  oiData: Map<number, number>;
  prevDayOi: Map<number, number>;
}

/** A B/S click: an intraday market order for the option; resolves to whether it was placed. */
export type QuickTrade = (instrument: OptionInstrument, strike: number, optionType: OptionTypeId, side: SideId) => Promise<boolean>;

const ChangeBadge: React.FC<{ change: Change | null }> = ({ change }) => (change ? <span className={`oc-cell-chg ${change.color}`}>{signedPercent(change.pct)}</span> : null);

const OiCell: React.FC<{ instrument: OptionInstrument | null; prices: ChainPrices; className: string }> = ({ instrument, prices, className }) => {
  const oi = instrument ? prices.oiData.get(instrument.instrumentToken) : undefined;
  const change = instrument ? percentChange(oi, prices.prevDayOi.get(instrument.instrumentToken)) : null;
  return (
    <td className={className}>
      <span className="oc-oi-content">
        {oi !== undefined ? oi.toLocaleString('en-IN') : '-'}
        <ChangeBadge change={change} />
      </span>
    </td>
  );
};

/** An LTP cell: a click opens the order popup; hovering shows B/S buttons for a quick intraday market order. */
const LtpCell: React.FC<{
  instrument: OptionInstrument | null;
  strike: number;
  optionType: OptionTypeId;
  prices: ChainPrices;
  className: string;
  onOpenOrder: (price: number) => void;
  onQuickTrade?: QuickTrade;
}> = ({ instrument, strike, optionType, prices, className, onOpenOrder, onQuickTrade }) => {
  const price = optionPrice(instrument, prices.livePrices);
  const change = instrument ? percentChange(prices.livePrices.get(instrument.instrumentToken), prices.closePrices.get(instrument.instrumentToken)) : null;
  const tradeButton = (side: SideId, label: string) => (
    <button
      className={`oc-ltp-action-btn oc-ltp-action-btn--${side.toLowerCase()}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!instrument || price === null || !onQuickTrade) return;
        void onQuickTrade(instrument, strike, optionType, side);
      }}
    >
      {label}
    </button>
  );
  return (
    <td className={`oc-cell-ltp oc-cell-ltp--clickable oc-cell-ltp--hover-btns ${className}`} onClick={() => onOpenOrder(price ?? 0)}>
      {tradeButton(Side.BUY, 'B')}
      <span className="oc-ltp-price">
        {price !== null ? price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
        <ChangeBadge change={change} />
      </span>
      {tradeButton(Side.SELL, 'S')}
    </td>
  );
};

/**
 * The option chain: CE and PE OI and LTP per strike, each with its change from the previous day, the ATM row
 * marked, and OI bars behind the strike. `orderOpen` is the option whose order popup is open.
 */
const ChainTable: React.FC<{
  chain: OptionChainRow[];
  atmStrike: number;
  prices: ChainPrices;
  orderOpen: { strike: number; optionType: OptionTypeId } | null;
  onOpenOrder: (strike: number, optionType: OptionTypeId, price: number) => void;
  /** Absent outside paper trading: the B/S buttons then do nothing. */
  onQuickTrade?: QuickTrade;
}> = ({ chain, atmStrike, prices, orderOpen, onOpenOrder, onQuickTrade }) => {
  const maxOi = maxChainOi(chain, prices.oiData);
  const barWidth = (instrument: OptionInstrument | null) => {
    const oi = instrument ? prices.oiData.get(instrument.instrumentToken) : undefined;
    return `${maxOi > 0 && oi ? (oi / maxOi) * 50 : 0}%`;
  };

  return (
    <div className="option-chain-table-wrapper">
      <table className="option-chain-table">
        <colgroup>
          <col className="oc-col-oi" />
          <col className="oc-col-ltp" />
          <col className="oc-col-strike" />
          <col className="oc-col-ltp" />
          <col className="oc-col-oi" />
        </colgroup>
        <thead>
          <tr>
            <th className="oc-header-ce" colSpan={2}>CALLS</th>
            <th className="oc-header-strike">STRIKE</th>
            <th className="oc-header-pe" colSpan={2}>PUTS</th>
          </tr>
          <tr>
            <th>OI</th>
            <th>LTP</th>
            <th></th>
            <th>LTP</th>
            <th>OI</th>
          </tr>
        </thead>
        <tbody>
          {chain.map((row) => {
            const ceItm = row.strike < atmStrike ? 'oc-cell--itm-ce' : '';
            const peItm = row.strike > atmStrike ? 'oc-cell--itm-pe' : '';
            const isOrderOpen = orderOpen?.strike === row.strike;
            return (
              <tr key={row.strike} className={`${row.strike === atmStrike ? 'oc-row--atm' : ''} ${isOrderOpen ? 'oc-row--active' : ''}`} style={{ position: 'relative' }}>
                <OiCell instrument={row.ce} prices={prices} className={`oc-cell-oi oc-cell-oi--ce ${ceItm}`} />
                <LtpCell instrument={row.ce} strike={row.strike} optionType={OptionType.CE} prices={prices} className={ceItm} onOpenOrder={(price) => onOpenOrder(row.strike, OptionType.CE, price)} onQuickTrade={onQuickTrade} />
                <td className="oc-cell-strike">
                  <div className="oc-strike-bars">
                    <div className="oc-oi-bar oc-oi-bar--ce" style={{ width: barWidth(row.ce) }} />
                    <div className="oc-oi-bar oc-oi-bar--pe" style={{ width: barWidth(row.pe) }} />
                  </div>
                  {row.strike}
                </td>
                <LtpCell instrument={row.pe} strike={row.strike} optionType={OptionType.PE} prices={prices} className={peItm} onOpenOrder={(price) => onOpenOrder(row.strike, OptionType.PE, price)} onQuickTrade={onQuickTrade} />
                <OiCell instrument={row.pe} prices={prices} className={`oc-cell-oi oc-cell-oi--pe ${peItm}`} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default ChainTable;
