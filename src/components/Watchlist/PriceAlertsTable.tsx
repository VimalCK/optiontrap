import React from 'react';
import { ResetIcon, TrashIcon } from '@/components/icons/Icons';
import type { PriceAlert } from '@/services/priceAlerts';
import { PriceAlertStatus, priceAlertConditionLabel } from '../../../shared/appEnums.js';
import { countByStatus, formatAlertTime, groupAlerts } from './priceAlertRows';
import { formatPrice, type LivePrice } from './watchlistRows';

const AlertRow: React.FC<{ alert: PriceAlert; price: LivePrice | undefined; onReset: (id: string) => void; onDelete: (id: string) => void }> = ({ alert, price, onReset, onDelete }) => (
  <tr>
    <td>{alert.note && <div className="wl-alerts-table__note">{alert.note}</div>}</td>
    <td className="wl-alerts-table__center">{priceAlertConditionLabel(alert.condition)}</td>
    <td className="wl-alerts-table__num">{formatPrice(alert.value)}</td>
    <td className="wl-alerts-table__num">{price ? formatPrice(price.ltp) : alert.triggeredPrice ? formatPrice(alert.triggeredPrice) : '-'}</td>
    <td className="wl-alerts-table__center">
      <span className={`wl-alert-status wl-alert-status--${alert.status.toLowerCase()}`}>
        {alert.status === PriceAlertStatus.Active ? 'Active' : 'Triggered'}
      </span>
    </td>
    <td className="wl-alerts-table__center">{formatAlertTime(alert.triggeredAt)}</td>
    <td className="wl-alerts-table__center">
      <div className="wl-alert-actions">
        {alert.status === PriceAlertStatus.Triggered && (
          <button type="button" className="wl-alert-action" onClick={() => onReset(alert.id)} title="Reset alert" aria-label={`Reset ${alert.tradingsymbol} alert`}>
            <ResetIcon size={14} />
          </button>
        )}
        <button type="button" className="wl-alert-action wl-alert-action--delete" onClick={() => onDelete(alert.id)} title="Delete alert" aria-label={`Delete ${alert.tradingsymbol} alert`}>
          <TrashIcon size={14} />
        </button>
      </div>
    </td>
  </tr>
);

/** Every price alert, grouped by instrument; triggered ones stay until reset or deleted. */
const PriceAlertsTable: React.FC<{
  alerts: PriceAlert[];
  livePrices: Map<number, LivePrice>;
  onReset: (id: string) => void;
  onDelete: (id: string) => void;
}> = ({ alerts, livePrices, onReset, onDelete }) => {
  const total = countByStatus(alerts);
  return (
    <div className="wl-alerts">
      <div className="wl-alerts__header">
        <div>
          <h3 className="wl-alerts__title">Price Alerts</h3>
          <p className="wl-alerts__desc">Triggered alerts stay here until you reset or delete them.</p>
        </div>
        <span className="wl-alerts__count">{total.active} active / {total.triggered} triggered</span>
      </div>

      {alerts.length === 0 ? (
        <div className="wl-alerts__empty">No price alerts yet. Use the Alert button on a watchlist item.</div>
      ) : (
        <div className="wl-alerts__table-wrap">
          <table className="wl-alerts-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="wl-alerts-table__center">Condition</th>
                <th className="wl-alerts-table__num">Tgt</th>
                <th className="wl-alerts-table__num">LTP</th>
                <th className="wl-alerts-table__center">Status</th>
                <th className="wl-alerts-table__center">Time</th>
                <th className="wl-alerts-table__center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groupAlerts(alerts).map((group) => {
                const count = countByStatus(group.alerts);
                return (
                  <React.Fragment key={group.key}>
                    <tr className="wl-alert-group-row">
                      <td colSpan={7}>
                        <span className="wl-alerts-table__symbol">{group.symbol}</span>
                        <span className={`wl-alerts-table__exchange wl-exchange--${group.exchange.toLowerCase()}`}>{group.exchange}</span>
                        <span className="wl-alert-group-row__count">{count.active} active / {count.triggered} triggered</span>
                      </td>
                    </tr>
                    {group.alerts.map((alert) => (
                      <AlertRow key={alert.id} alert={alert} price={livePrices.get(alert.instrumentToken)} onReset={onReset} onDelete={onDelete} />
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PriceAlertsTable;
