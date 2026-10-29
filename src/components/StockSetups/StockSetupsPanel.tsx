import React, { useEffect, useMemo, useState } from 'react';
import { analyzeStock, MIN_CANDLES, type StockAnalysis, type Zone, type StockState, type MarketCheck } from '../../../shared/stockSetups.js';
import { fetchStockCandles, type StockCandles } from '@/services/stockSetups';
import { isAbortError } from '@/services/apiClient';
import type { PriceAlertCondition } from '@/services/priceAlerts';

interface StockSetupsPanelProps {
  instrumentToken: number;
  tradingsymbol: string;
  /** Live price from the watchlist ticker; the last close is used without it. */
  livePrice: number | undefined;
  onClose: () => void;
  onSetAlert: (condition: PriceAlertCondition, value: number, note: string) => void;
}

/** Re-run the analysis only when the live price has moved this much: zones don't change tick by tick. */
const REPRICE_MOVE = 0.005;

const STATE_LABEL: Record<StockState, string> = {
  falling: 'Falling',
  stretched: 'Stretched',
  turning: 'Turning',
  uptrend: 'Uptrend',
  sideways: 'Sideways',
};

const MARKET_TEXT: Record<MarketCheck['relation'], string> = {
  alone: 'falling on its own while the market holds: stock-specific selling, higher risk',
  'with-market': 'falling with the market: it often recovers when the market does',
  stronger: 'stronger than the market',
  'in-line': 'moving in line with the market',
};

const rs = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

function Strength({ value }: { value: 1 | 2 | 3 }) {
  return (
    <span className="wl-sz-strength" title={`Strength ${value} of 3`} aria-label={`Strength ${value} of 3`}>
      {[1, 2, 3].map((n) => <span key={n} className={n <= value ? 'wl-sz-strength__dot wl-sz-strength__dot--on' : 'wl-sz-strength__dot'} />)}
    </span>
  );
}

function historyText(zone: Zone): string {
  const { tests, held, failed, avgMovePct } = zone.history;
  if (!tests) return 'No past tests';
  const verb = zone.side === 'support' ? 'held' : 'rejected';
  const broke = failed ? `, broke ${failed}` : '';
  const move = avgMovePct !== null ? ` · avg move ${avgMovePct.toFixed(1)}%` : '';
  return `${verb} ${held} of ${tests}${broke}${move}`;
}

/** Entry and exit zones, today's setups and a plan for one watchlist stock. */
const StockSetupsPanel: React.FC<StockSetupsPanelProps> = ({ instrumentToken, tradingsymbol, livePrice, onClose, onSetAlert }) => {
  const [data, setData] = useState<StockCandles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysisPrice, setAnalysisPrice] = useState<number | undefined>(livePrice);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    fetchStockCandles(instrumentToken, controller.signal)
      .then(setData)
      .catch((err) => { if (!isAbortError(err)) setError(err instanceof Error ? err.message : 'Failed to load candles'); });
    return () => controller.abort();
  }, [instrumentToken]);

  useEffect(() => {
    if (livePrice === undefined) return;
    setAnalysisPrice((prev) => (prev === undefined || Math.abs(livePrice / prev - 1) >= REPRICE_MOVE ? livePrice : prev));
  }, [livePrice]);

  const analysis: StockAnalysis | null = useMemo(
    () => (data ? analyzeStock(data.candles, { price: analysisPrice, market: data.market }) : null),
    [data, analysisPrice],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const zoneRows = (zones: Zone[]) => zones.map((zone) => {
    const support = zone.side === 'support';
    const inside = analysis !== null && zone.low <= analysis.price && analysis.price <= zone.high;
    return (
      <tr key={`${zone.side}-${zone.low}`}>
        <td className="wl-sz-zones__range">{rs(zone.low)} – {rs(zone.high)}{inside && <span className="wl-sz-tag">price here</span>}</td>
        <td className="wl-sz-zones__num">{inside ? '—' : pct(zone.distancePct)}</td>
        <td><Strength value={zone.strength} /></td>
        <td className="wl-sz-zones__why">{zone.reasons.join(', ')}</td>
        <td className="wl-sz-zones__history">{historyText(zone)}</td>
        <td>
          <button
            type="button"
            className="wl-sz-alert"
            onClick={() => onSetAlert(
              support ? 'below' : 'above',
              Number((support ? zone.high : zone.low).toFixed(2)),
              `${support ? 'Support' : 'Resistance'} zone ${rs(zone.low)}–${rs(zone.high)} (${zone.reasons.join(', ')})`,
            )}
            title={support ? 'Alert when price falls into this zone' : 'Alert when price rises into this zone'}
          >
            Alert
          </button>
        </td>
      </tr>
    );
  });

  return (
    <div className="wl-alert-modal-overlay" onMouseDown={onClose}>
      <div className="wl-sz" role="dialog" aria-modal="true" aria-labelledby="wl-sz-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wl-sz__header">
          <div>
            <h3 id="wl-sz-title">{tradingsymbol} · Entry &amp; exit zones</h3>
            {analysis && (
              <p>
                {rs(analysis.price)} {livePrice === undefined && `(close ${analysis.date})`}
                <span className={`wl-sz-state wl-sz-state--${analysis.state}`}>{STATE_LABEL[analysis.state]}</span>
              </p>
            )}
          </div>
          <button className="wl-alert-modal__close" onClick={onClose} aria-label="Close">x</button>
        </div>

        <div className="wl-sz__body">
          {error && <div className="wl-sz-message wl-sz-message--error">{error}</div>}
          {!data && !error && <div className="wl-sz-message">Loading daily candles…</div>}
          {data?.warning && <div className="wl-sz-message wl-sz-message--warn">Couldn't refresh from Kite ({data.warning}). Showing stored candles up to {data.candles[data.candles.length - 1]?.date}.</div>}
          {data && !analysis && <div className="wl-sz-message">Not enough history yet: zones need at least {MIN_CANDLES} trading days ({data.candles.length} stored).</div>}

          {analysis && (
            <>
              <section className="wl-sz-section">
                <p className="wl-sz-note">{analysis.stateNote}</p>
                {analysis.market && (
                  <p className="wl-sz-note wl-sz-note--muted">
                    Last 20 sessions: {tradingsymbol} {pct(analysis.market.stockPct)}, NIFTY 50 {pct(analysis.market.marketPct)}, {MARKET_TEXT[analysis.market.relation]}.
                  </p>
                )}
              </section>

              {analysis.setups.length > 0 ? (
                <section className="wl-sz-section">
                  <h4>Setups on {analysis.date}</h4>
                  <div className="wl-sz-setups">
                    {analysis.setups.map((setup) => (
                      <div key={setup.type} className={`wl-sz-setup wl-sz-setup--${setup.direction}`}>
                        <div className="wl-sz-setup__head">
                          <span className="wl-sz-setup__dir">{setup.direction === 'buy' ? 'Buy' : 'Sell / exit'}</span>
                          <strong>{setup.label}</strong>
                          <span className="wl-sz-setup__rr">R:R {setup.rewardRisk.toFixed(1)}</span>
                        </div>
                        <div className="wl-sz-setup__levels">
                          <span>Entry <b>{rs(setup.entry)}</b></span>
                          <span>Stop <b>{rs(setup.stop)}</b></span>
                          <span>Target <b>{rs(setup.target)}</b></span>
                        </div>
                        <p>{setup.note}</p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : (
                <section className="wl-sz-section">
                  <h4>Plan</h4>
                  <p className="wl-sz-note">{analysis.plan}</p>
                </section>
              )}

              <section className="wl-sz-section">
                <h4>Support · buy zones</h4>
                {analysis.supports.length ? (
                  <table className="wl-sz-zones"><tbody>{zoneRows(analysis.supports)}</tbody></table>
                ) : <p className="wl-sz-note wl-sz-note--muted">No support zone below the price in the stored history.</p>}
              </section>

              <section className="wl-sz-section">
                <h4>Resistance · sell / exit zones</h4>
                {analysis.resistances.length ? (
                  <table className="wl-sz-zones"><tbody>{zoneRows(analysis.resistances)}</tbody></table>
                ) : <p className="wl-sz-note wl-sz-note--muted">No resistance zone above: the price is at or near its highs.</p>}
              </section>

              <section className="wl-sz-indicators">
                {([
                  ['20-day avg', analysis.indicators.sma20],
                  ['50-day avg', analysis.indicators.sma50],
                  ['200-day avg', analysis.indicators.sma200],
                  ['ATR (14)', analysis.indicators.atr],
                ] as const).map(([label, value]) => (
                  <span key={label}>{label} <b>{value === null ? '—' : rs(value)}</b></span>
                ))}
                <span>RSI (14) <b>{analysis.indicators.rsi === null ? '—' : analysis.indicators.rsi.toFixed(0)}</b></span>
              </section>
            </>
          )}
        </div>

        <div className="wl-sz__footer">
          Zones and counts come from {data ? `${data.candles.length} stored trading days` : 'past prices'}. They improve the odds, not certainty; sell setups on cash stocks are exits, not shorts.
        </div>
      </div>
    </div>
  );
};

export default StockSetupsPanel;
