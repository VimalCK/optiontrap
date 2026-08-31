/**
 * HoldingsView — equity holdings content (no page header).
 * Rendered inside the Holdings & Positions tabbed page.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { HoldingsIcon } from '@/components/icons/Icons';
import { fetchHoldings, Holding } from '@/services/kiteApi';
import { Tick } from '@/services/kiteTicker';
import { tickerSubscribe } from '@/services/tickerSingleton';
import { getMarketStatus, MarketStatus } from '@/utils/marketStatus';
import '@/styles/holdings.css';

type AllocationView = 'bar' | 'treemap';

interface AllocationItem {
  symbol: string;
  exchange: string;
  investedValue: number;
  currentValue: number;
  percentage: number;
  pnl: number;
  pnlPercentage: number;
  isPledged: boolean;
}

const HoldingsView: React.FC = () => {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allocationView, setAllocationView] = useState<AllocationView>('bar');
  const [marketStatus, setMarketStatus] = useState<MarketStatus>(getMarketStatus);
  const [expandedStock, setExpandedStock] = useState<string | null>(null);
  const [privacyMode, setPrivacyMode] = useState(() =>
    localStorage.getItem('optiontrap_privacy_mode') === 'true'
  );

  const handleTicks = useCallback((ticks: Tick[]) => {
    setHoldings((prev) => {
      const priceMap = new Map<number, Tick>();
      ticks.forEach((t) => priceMap.set(t.instrumentToken, t));
      return prev.map((h) => {
        const tick = priceMap.get(h.instrument_token);
        if (!tick) return h;
        const newLastPrice = tick.lastPrice;
        const qty = h.quantity > 0 ? h.quantity : h.collateral_quantity;
        const newPnl = (newLastPrice - h.average_price) * qty;
        const closePrice = tick.closePrice ?? h.close_price;
        const dayChange = newLastPrice - closePrice;
        const dayChangePct = closePrice > 0 ? (dayChange / closePrice) * 100 : 0;
        return { ...h, last_price: newLastPrice, close_price: closePrice, pnl: newPnl, day_change: dayChange, day_change_percentage: dayChangePct };
      });
    });
  }, []);

  useEffect(() => {
    loadHoldings();
    const statusInterval = setInterval(() => setMarketStatus(getMarketStatus()), 30000);
    return () => { clearInterval(statusInterval); };
  }, []);

  useEffect(() => {
    if (holdings.length === 0 || marketStatus !== 'live') return;
    const tokens = holdings.map((h) => h.instrument_token);
    return tickerSubscribe('holdings', tokens, handleTicks);
  }, [holdings, marketStatus, handleTicks]);

  const loadHoldings = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHoldings();
      setHoldings(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load holdings';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const getEffectiveQty = (h: Holding) => {
    const qty = h.t1_quantity + h.realised_quantity - h.used_quantity;
    return qty > 0 ? qty : h.collateral_quantity;
  };

  const totalInvestment   = holdings.reduce((sum, h) => sum + h.average_price * getEffectiveQty(h), 0);
  const totalCurrentValue = holdings.reduce((sum, h) => sum + h.last_price * getEffectiveQty(h), 0);
  const totalPnl          = holdings.reduce((sum, h) => sum + h.pnl, 0);
  const totalDayChange    = holdings.reduce((sum, h) => sum + h.day_change * getEffectiveQty(h), 0);

  const allocation: AllocationItem[] = holdings
    .map((h) => {
      const qty = getEffectiveQty(h);
      const currentValue  = h.last_price * qty;
      const investedValue = h.average_price * qty;
      return {
        symbol: h.tradingsymbol,
        exchange: h.exchange,
        investedValue,
        currentValue,
        percentage: totalCurrentValue > 0 ? (currentValue / totalCurrentValue) * 100 : 0,
        pnl: h.pnl,
        pnlPercentage: investedValue > 0 ? (h.pnl / investedValue) * 100 : 0,
        isPledged: h.collateral_quantity > 0 && h.collateral_type === 'pledge',
      };
    })
    .sort((a, b) => b.currentValue - a.currentValue);

  return (
    <div>
      {/* Sub-header row: market status + privacy toggle */}
      <div className="holdings-subheader">
        <div className="holdings-status-row">
          {marketStatus === 'live'     && <span className="live-badge">● LIVE</span>}
          {marketStatus === 'pre-open' && <span className="live-badge live-badge--preopen">● PRE-OPEN</span>}
          {marketStatus === 'closed'   && <span className="live-badge live-badge--closed">● CLOSED</span>}
          <span className="holdings-count">{holdings.length > 0 ? `${holdings.length} holdings` : ''}</span>
        </div>
        <button
          className={`privacy-toggle ${privacyMode ? 'active' : ''}`}
          onClick={() => setPrivacyMode((p) => {
            const next = !p;
            localStorage.setItem('optiontrap_privacy_mode', String(next));
            return next;
          })}
          title="Privacy mode"
          aria-pressed={privacyMode}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {privacyMode ? (
              <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><path d="M1 1l22 22" /></>
            ) : (
              <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
            )}
          </svg>
        </button>
      </div>

      {loading && (
        <div className="holdings-loading">
          <div className="redirect-spinner" />
          <p>Loading holdings...</p>
        </div>
      )}

      {error && (
        <div className="card holdings-error">
          <p>{error}</p>
          <button className="btn btn--primary" onClick={loadHoldings} style={{ marginTop: 12 }}>Retry</button>
        </div>
      )}

      {!loading && !error && holdings.length > 0 && (
        <>
          {/* Summary */}
          <div className="card-grid card-grid--two-col">
            <div className="card holdings-stat">
              <span className="holdings-stat__label">Total P&L</span>
              <span className={`holdings-stat__value ${totalPnl >= 0 ? 'positive' : 'negative'} ${privacyMode ? 'blurred' : ''}`}>
                {totalPnl >= 0 ? '+' : ''}{totalPnl.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                <small> ({totalInvestment > 0 ? ((totalPnl / totalInvestment) * 100).toFixed(2) : '0.00'}%)</small>
              </span>
            </div>
            <div className="card holdings-stat">
              <span className="holdings-stat__label">Day Change</span>
              <span className={`holdings-stat__value ${totalDayChange >= 0 ? 'positive' : 'negative'}`}>
                {totalDayChange >= 0 ? '+' : ''}{totalDayChange.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Allocation */}
          <div className="card" style={{ marginTop: 24 }}>
            <div className="allocation-header">
              <div>
                <h3 className="card__title">Allocation</h3>
                <p className="card__description">Portfolio weight by current market value</p>
                <div className="allocation-summary">
                  <span className="allocation-summary__item">
                    <span className="allocation-summary__label">Invested</span>
                    <span className={`allocation-summary__value ${privacyMode ? 'blurred' : ''}`}>{totalInvestment.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  </span>
                  <span className="allocation-summary__divider" />
                  <span className="allocation-summary__item">
                    <span className="allocation-summary__label">Current</span>
                    <span className={`allocation-summary__value ${privacyMode ? 'blurred' : ''}`}>{totalCurrentValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  </span>
                </div>
              </div>
              <div className="allocation-toggle">
                <button className={`allocation-toggle__btn ${allocationView === 'bar' ? 'active' : ''}`} onClick={() => setAllocationView('bar')} title="Bar view">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 16h3" /><path d="M7 12h7" /><path d="M7 8h11" /></svg>
                </button>
                <button className={`allocation-toggle__btn ${allocationView === 'treemap' ? 'active' : ''}`} onClick={() => setAllocationView('treemap')} title="Treemap view">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>
                </button>
              </div>
            </div>

            {allocationView === 'bar' ? (
              <div className="allocation-list">
                {allocation.map((item) => {
                  const key = `${item.exchange}:${item.symbol}`;
                  const isExpanded = expandedStock === key;
                  return (
                    <div key={key} className={`allocation-item ${isExpanded ? 'allocation-item--expanded' : ''}`} onClick={() => setExpandedStock(isExpanded ? null : key)}>
                      <div className="allocation-item__row">
                        <div className="allocation-item__info">
                          <span className="allocation-item__symbol">
                            {item.symbol}
                            {item.isPledged && <span className="badge-pledged" title="Pledged">P</span>}
                          </span>
                          <span className="allocation-item__exchange">{item.exchange}</span>
                        </div>
                        <div className="allocation-item__bar-wrapper">
                          <div className="allocation-item__bar" style={{ width: `${Math.max(item.percentage, 1)}%` }} />
                        </div>
                        <span className="allocation-item__pct">{item.percentage.toFixed(1)}%</span>
                      </div>
                      {isExpanded && (
                        <div className="allocation-item__detail">
                          <div className="allocation-detail__chip">
                            <span className="allocation-detail__label">Invested</span>
                            <span className={`allocation-detail__value ${privacyMode ? 'blurred' : ''}`}>{item.investedValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                          </div>
                          <div className="allocation-detail__chip">
                            <span className="allocation-detail__label">Current</span>
                            <span className={`allocation-detail__value ${privacyMode ? 'blurred' : ''}`}>{item.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                          </div>
                          <div className="allocation-detail__chip">
                            <span className="allocation-detail__label">P&L</span>
                            <span className={`allocation-detail__value ${item.pnl >= 0 ? 'positive' : 'negative'} ${privacyMode ? 'blurred' : ''}`}>
                              {item.pnl >= 0 ? '+' : ''}{item.pnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })} ({item.pnlPercentage.toFixed(2)}%)
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <Treemap data={allocation} />
            )}
          </div>

          {/* Holdings Table */}
          <div className="card holdings-table-card" style={{ marginTop: 24, overflow: 'auto' }}>
            <h3 className="card__title" style={{ marginBottom: 16 }}>All Holdings</h3>
            <table className="holdings-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Qty</th>
                  <th>Avg Price</th>
                  <th>LTP</th>
                  <th>Change</th>
                  <th>P&L</th>
                  <th>Day Change</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const qty = getEffectiveQty(h);
                  const investedValue = h.average_price * qty;
                  const pnlPct = investedValue > 0 ? (h.pnl / investedValue) * 100 : 0;
                  const isPledged = h.collateral_quantity > 0 && h.collateral_type === 'pledge';
                  return (
                    <tr key={`${h.exchange}:${h.tradingsymbol}`}>
                      <td>
                        <span className="holdings-table__symbol">{h.tradingsymbol}</span>
                        {isPledged && <span className="badge-pledged" title="Pledged">P</span>}
                        <span className="holdings-table__exchange">{h.exchange}</span>
                      </td>
                      <td className={privacyMode ? 'blurred' : ''}>{qty}</td>
                      <td className={privacyMode ? 'blurred' : ''}>{h.average_price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td>{h.last_price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className={h.day_change >= 0 ? 'positive' : 'negative'}>
                        {h.day_change >= 0 ? '+' : ''}{h.day_change.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className={`${h.pnl >= 0 ? 'positive' : 'negative'} ${privacyMode ? 'blurred' : ''}`}>
                        {h.pnl >= 0 ? '+' : ''}{h.pnl.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        <small> ({pnlPct.toFixed(2)}%)</small>
                      </td>
                      <td className={h.day_change_percentage >= 0 ? 'positive' : 'negative'}>
                        {h.day_change >= 0 ? '+' : ''}{(h.day_change * qty).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        <small> ({h.day_change_percentage >= 0 ? '+' : ''}{h.day_change_percentage.toFixed(2)}%)</small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && !error && holdings.length === 0 && (
        <div className="card">
          <div className="card__icon"><HoldingsIcon /></div>
          <h3 className="card__title">No Holdings</h3>
          <p className="card__description">You don't have any equity holdings in your DEMAT account.</p>
        </div>
      )}
    </div>
  );
};

// ── Treemap ────────────────────────────────────────────────────────────────────

function computeTreemapLayout(
  items: { value: number; index: number }[],
  x: number, y: number, width: number, height: number,
): { x: number; y: number; w: number; h: number; index: number }[] {
  const results: { x: number; y: number; w: number; h: number; index: number }[] = [];
  if (items.length === 0) return results;
  if (items.length === 1) { results.push({ x, y, w: width, h: height, index: items[0].index }); return results; }

  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total === 0) return results;

  const sorted = [...items].sort((a, b) => b.value - a.value);
  let remaining = total;
  let cx = x, cy = y;
  const isWide = width >= height;

  for (let i = 0; i < sorted.length; i++) {
    const ratio = sorted[i].value / remaining;
    remaining -= sorted[i].value;
    if (isWide) {
      const w = width * ratio;
      results.push({ x: cx, y: cy, w: Math.max(w, 0), h: height, index: sorted[i].index });
      cx += w; width -= w;
    } else {
      const h = height * ratio;
      results.push({ x: cx, y: cy, w: width, h: Math.max(h, 0), index: sorted[i].index });
      cy += h; height -= h;
    }
  }
  return results;
}

const Treemap: React.FC<{ data: AllocationItem[] }> = ({ data }) => {
  const items = data.map((item, index) => ({ value: item.percentage, index }));
  const rects = computeTreemapLayout(items, 0, 0, 100, 100);

  return (
    <div className="treemap">
      {rects.map((rect) => {
        const item = data[rect.index];
        const pnlPct = item.pnlPercentage;
        const intensity = Math.min(Math.abs(pnlPct) / 20, 1);
        const bgColor = pnlPct >= 0 ? `rgba(34, 197, 94, ${0.15 + intensity * 0.55})` : `rgba(239, 68, 68, ${0.15 + intensity * 0.55})`;
        const textColor = pnlPct >= 0 ? '#22c55e' : '#ef4444';
        return (
          <div
            key={`${item.exchange}:${item.symbol}`}
            className="treemap__cell"
            style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%`, background: bgColor }}
            title={`${item.symbol}: ${item.percentage.toFixed(1)}% | P&L: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`}
          >
            {rect.w > 8 && rect.h > 12 && (
              <div className="treemap__cell-content">
                <span className="treemap__cell-symbol">{item.symbol}</span>
                {rect.w > 12 && rect.h > 20 && <span className="treemap__cell-pnl" style={{ color: textColor }}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%</span>}
                {rect.w > 15 && rect.h > 28 && <span className="treemap__cell-pct">{item.percentage.toFixed(1)}%</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default HoldingsView;
