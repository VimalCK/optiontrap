import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatNumericDate } from '@/utils/marketStatus';
import { analyzeStock, MIN_CANDLES, type StockAnalysis, type Zone } from '../../../shared/stockSetups.js';
import { LevelSide, MarketRelation, MoveDirection, type MarketRelationId, type MoveDirectionId } from '../../../shared/analysisEnums.js';
import { backfillSetupHistory, fetchExpectedMove, fetchStockCandles, type ExpectedMove, type StockCandles } from '@/services/stockSetups';
import { isAbortError } from '@/services/apiClient';
import StockSetupsGuide from './StockSetupsGuide';
import SetupScorecard from './SetupScorecard';
import TradingViewLink from '@/components/TradingViewLink/TradingViewLink';
import { realizedVol, REALIZED_WINDOW, TRADING_DAYS } from '@/services/fairValue';
import { PriceAlertCondition, type PriceAlertConditionId } from '../../../shared/appEnums.js';
import { Side } from '../../../shared/tradeEnums.js';
import { StockSetupsView, type StockSetupsViewId } from '@/utils/uiEnums';
// Also opened from OI History, where the watchlist styles aren't otherwise loaded.
import '@/styles/watchlist.css';

interface StockSetupsPanelProps {
  instrumentToken: number;
  tradingsymbol: string;
  /** Live price from the watchlist ticker; the last close is used without it. */
  livePrice: number | undefined;
  onClose: () => void;
  /** Where the zone bells lead; without it (outside the watchlist) the bells are hidden. */
  onSetAlert?: (condition: PriceAlertConditionId, value: number, note: string) => void;
}

/** Re-run the analysis only when the live price has moved this much: zones don't change tick by tick. */
const REPRICE_MOVE = 0.005;
const LADDER_ZONES = 3;

const MARKET_LABEL: Record<MarketRelationId, string> = {
  [MarketRelation.Alone]: 'Falling on its own',
  [MarketRelation.WithMarket]: 'Falling with the market',
  [MarketRelation.Stronger]: 'Stronger than market',
  [MarketRelation.InLine]: 'In line with market',
};

/** `market`: the market reference index's label. */
const marketText = (relation: MarketRelationId, market: string): string => ({
  [MarketRelation.Alone]: 'Stock-specific selling while the market holds: higher risk.',
  [MarketRelation.WithMarket]: 'Moving down with the market: it often recovers when the market does.',
  [MarketRelation.Stronger]: `Holding up better than ${market}.`,
  [MarketRelation.InLine]: `Moving with ${market}.`,
})[relation];

const rs = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
/** The price range a ± move spans around the price, e.g. "₹323 – ₹361". Whole rupees above ₹100. */
const band = (price: number, move: number) => {
  const fmt = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: price >= 100 ? 0 : 2 })}`;
  return `${fmt(price - move)} – ${fmt(price + move)}`;
};
/** A daily rupee move with its share of the price, e.g. "≈ ±₹6 a day (1.7%)". */
const perDay = (price: number, move: number) => `≈ ±₹${move.toFixed(move >= 10 ? 0 : 1)} a day (${((move / price) * 100).toFixed(1)}%)`;
/** Trading sessions (weekdays) after today up to and including the expiry; holidays are ignored. */
function sessionsTo(expiry: string): number {
  const end = new Date(`${expiry}T00:00:00Z`);
  const day = new Date(`${new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)}T00:00:00Z`);
  let sessions = 0;
  for (day.setUTCDate(day.getUTCDate() + 1); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) sessions++;
  }
  return sessions;
}
/** "2026-11-24" → "24 Nov" */
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const tone = (v: number): MoveDirectionId => (v >= 0 ? MoveDirection.Up : MoveDirection.Down);

function Strength({ value }: { value: 1 | 2 | 3 }) {
  return (
    <span className="wl-sz-strength" title={`Strength ${value} of 3`} aria-label={`Strength ${value} of 3`}>
      {[1, 2, 3].map((n) => <span key={n} className={n <= value ? 'wl-sz-strength__bar wl-sz-strength__bar--on' : 'wl-sz-strength__bar'} />)}
    </span>
  );
}

/** RSI as words: under 30 oversold, over 70 overbought, 45–55 neutral, normal otherwise. */
function rsiLabel(rsi: number): { text: string; tone: MoveDirectionId } {
  if (rsi < 30) return { text: 'Oversold', tone: MoveDirection.Down };
  if (rsi > 70) return { text: 'Overbought', tone: MoveDirection.Up };
  if (rsi >= 45 && rsi <= 55) return { text: 'Neutral', tone: MoveDirection.Neutral };
  return { text: 'Normal', tone: MoveDirection.Neutral };
}

function historyText(zone: Zone): string {
  const { tests, held, failed, avgMovePct } = zone.history;
  if (!tests) return 'No past tests';
  const verb = zone.side === LevelSide.Support ? 'Held' : 'Rejected';
  const broke = failed ? ` · broke ${failed}` : '';
  const move = avgMovePct !== null ? ` · avg move ${avgMovePct.toFixed(1)}%` : '';
  return `${verb} ${held} of ${tests}${broke}${move}`;
}

function PriceLadder({ analysis }: { analysis: StockAnalysis }) {
  const supports = analysis.supports.slice(0, LADDER_ZONES);
  const resistances = analysis.resistances.slice(0, LADDER_ZONES);
  const zones = [...supports, ...resistances];
  if (!zones.length) return null;
  const lo = Math.min(analysis.price, ...zones.map((z) => z.low));
  const hi = Math.max(analysis.price, ...zones.map((z) => z.high));
  const pad = (hi - lo) * 0.06 || analysis.price * 0.01;
  const min = lo - pad;
  const span = hi + pad - min;
  const at = (v: number) => `${((v - min) / span) * 100}%`;
  return (
    <div className="wl-sz-ladder" aria-hidden="true">
      <div className="wl-sz-ladder__track">
        {zones.map((z) => (
          <span
            key={`${z.side}-${z.low}`}
            className={`wl-sz-ladder__zone wl-sz-ladder__zone--${z.side.toLowerCase()} wl-sz-ladder__zone--s${z.strength}`}
            style={{ left: at(z.low), width: `max(4px, calc(${at(z.high)} - ${at(z.low)}))` }}
            title={`${z.side} ${rs(z.low)}–${rs(z.high)}`}
          />
        ))}
        <span className="wl-sz-ladder__price" style={{ left: at(analysis.price) }}>
          <span className="wl-sz-ladder__price-label">{rs(analysis.price)}</span>
        </span>
      </div>
      <div className="wl-sz-ladder__legend">
        <span><i className="wl-sz-ladder__key wl-sz-ladder__key--support" />Support · buy zones</span>
        <span><i className="wl-sz-ladder__key wl-sz-ladder__key--resistance" />Resistance · exit zones</span>
      </div>
    </div>
  );
}

/** Stocks whose 1Y backtest ran since the page loaded. Rerunning would only re-add the same setups; in memory only. */
const backtestedTokens = new Set<number>();

const StockSetupsPanel: React.FC<StockSetupsPanelProps> = ({ instrumentToken, tradingsymbol, livePrice, onClose, onSetAlert }) => {
  const [data, setData] = useState<StockCandles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysisPrice, setAnalysisPrice] = useState<number | undefined>(livePrice);
  const [view, setView] = useState<StockSetupsViewId>(StockSetupsView.Details);
  const showGuide = view === StockSetupsView.Guide;
  // Read once for the ATM strike; ticks shouldn't refetch option quotes.
  const livePriceRef = useRef(livePrice);
  livePriceRef.current = livePrice;

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

  // The options' expected move, fetched once the candles give a price to pick the ATM strike.
  const [expectedMove, setExpectedMove] = useState<ExpectedMove | null>(null);
  useEffect(() => {
    setExpectedMove(null);
    const price = livePriceRef.current ?? data?.candles[data.candles.length - 1]?.close;
    if (!price) return;
    const controller = new AbortController();
    fetchExpectedMove(tradingsymbol, price, controller.signal)
      .then(setExpectedMove)
      .catch((err) => { if (!isAbortError(err)) console.warn('[StockSetups] Expected move unavailable:', err); });
    return () => controller.abort();
  }, [tradingsymbol, data]);

  const volatility = useMemo(() => {
    if (!data || !analysis) return null;
    const annual = realizedVol(data.candles.map((c) => c.close));
    if (annual === null) return null;
    return {
      annual,
      daily: analysis.price * annual / Math.sqrt(TRADING_DAYS),
      monthly: analysis.price * annual * Math.sqrt(REALIZED_WINDOW / TRADING_DAYS),
    };
  }, [data, analysis]);

  /**
   * The daily move the options price in, comparable with the usual daily move. A straddle
   * pays the average absolute move, √(2/π) ≈ 0.8 of a standard move, spread over √sessions.
   */
  const expectedDaily = useMemo(() => {
    if (!expectedMove) return null;
    const sessions = sessionsTo(expectedMove.expiry);
    return sessions > 0 ? expectedMove.straddle / Math.sqrt(2 / Math.PI) / Math.sqrt(sessions) : null;
  }, [expectedMove]);

  const [history, setHistory] = useState<{ running: boolean; message: string | null; error: boolean }>({ running: false, message: null, error: false });
  const [backtested, setBacktested] = useState(() => backtestedTokens.has(instrumentToken));
  useEffect(() => {
    setHistory({ running: false, message: null, error: false });
    setBacktested(backtestedTokens.has(instrumentToken));
    setView(StockSetupsView.Details);
  }, [instrumentToken]);

  const runSetupHistory = async () => {
    setHistory({ running: true, message: null, error: false });
    try {
      const counts = await backfillSetupHistory(instrumentToken);
      backtestedTokens.add(instrumentToken);
      setBacktested(true);
      setView(StockSetupsView.Scorecard);
      setHistory({
        running: false,
        error: false,
        message: counts.found > 0
          ? `Scorecard updated: ${counts.found} setup(s) in the past year — ${counts.target} target, ${counts.stop} stop, ${counts.expired} expired, ${counts.open} open.`
          : 'No setups in the past year.',
      });
    } catch (err) {
      setHistory({ running: false, error: true, message: err instanceof Error ? err.message : 'Setup history failed' });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const zoneRows = (zones: Zone[]) => zones.map((zone) => {
    const support = zone.side === LevelSide.Support;
    const inside = analysis !== null && zone.low <= analysis.price && analysis.price <= zone.high;
    return (
      <div key={`${zone.side}-${zone.low}`} className={`wl-sz-zone wl-sz-zone--${zone.side.toLowerCase()}`}>
        <div className="wl-sz-zone__main">
          <span className="wl-sz-zone__range">{rs(zone.low)} – {rs(zone.high)}</span>
          {inside ? <span className="wl-sz-tag">Price here</span> : <span className="wl-sz-zone__dist">{pct(zone.distancePct)}</span>}
          <Strength value={zone.strength} />
          {onSetAlert && (
            <button
              type="button"
              className="wl-alert-btn"
              onClick={() => onSetAlert(
                support ? PriceAlertCondition.Below : PriceAlertCondition.Above,
                Number((support ? zone.high : zone.low).toFixed(2)),
                `${support ? 'Support' : 'Resistance'} zone ${rs(zone.low)}–${rs(zone.high)} (${zone.reasons.join(', ')})`,
              )}
              title={support ? 'Alert when price falls into this zone' : 'Alert when price rises into this zone'}
              aria-label={`Set alert at ${support ? 'support' : 'resistance'} ${rs(zone.low)}–${rs(zone.high)}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                <path d="M12 4V2" />
              </svg>
            </button>
          )}
        </div>
        <div className="wl-sz-zone__meta">
          <span className="wl-sz-zone__history">{historyText(zone)}</span>
          <span className="wl-sz-zone__why">
            {zone.reasons.map((reason) => <span key={reason} className="wl-sz-reason">{reason}</span>)}
          </span>
        </div>
      </div>
    );
  });

  const lastDate = data?.candles[data.candles.length - 1]?.date;

  return (
    <div className="wl-alert-modal-overlay wl-sz-overlay" onMouseDown={onClose}>
      <div className="wl-sz" role="dialog" aria-modal="true" aria-labelledby="wl-sz-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wl-sz__header">
          <div className="wl-sz__title">
            <h3 id="wl-sz-title">{tradingsymbol}</h3>
            <TradingViewLink symbol={tradingsymbol} size={16} className="wl-sz__chart-link" />
            <button
              className={`wl-sz__icon-btn wl-sz__icon-btn--small ${view !== StockSetupsView.Details ? 'wl-sz__icon-btn--active' : ''}`}
              onClick={() => setView((v) => (v === StockSetupsView.Details ? StockSetupsView.Guide : StockSetupsView.Details))}
              aria-label={view !== StockSetupsView.Details ? 'Back to setup details' : 'How to read this panel'}
              title={view !== StockSetupsView.Details ? 'Back to setup details' : 'How to read this panel'}
            >
              {view !== StockSetupsView.Details ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9.5" />
                  <path d="M12 11v5.5" />
                  <path d="M12 7.5h.01" />
                </svg>
              )}
            </button>
            {backtested ? (
              // Already backtested: open the scorecard rather than replaying the same year again.
              <button
                className={`wl-sz__pill-btn${view === StockSetupsView.Scorecard ? ' wl-sz__pill-btn--active' : ''}`}
                onClick={() => setView(StockSetupsView.Scorecard)}
                aria-label={`Show the ${tradingsymbol} setup scorecard`}
                title="Show how each setup type has played out on this stock"
              >
                Scorecard
              </button>
            ) : (
              <button
                className={`wl-sz__pill-btn wl-sz__pill-btn--cta${!history.running && !history.error ? ' wl-sz__pill-btn--pulse' : ''}`}
                onClick={runSetupHistory}
                disabled={history.running}
                aria-label={`Backtest the past year of ${tradingsymbol} setups into the scorecard`}
                title="Replay the past year's sessions and add each setup, with how it turned out, to the scorecard"
              >
                {history.running ? 'Backtesting…' : 'Backtest 1Y'}
              </button>
            )}
          </div>
          {analysis && (
            <div className="wl-sz__quote">
              <span className="wl-sz__price">{rs(analysis.price)}</span>
              <span className="wl-sz__quote-meta">
                <span className={`wl-sz-state wl-sz-state--${analysis.state.toLowerCase()}`}>{analysis.state}</span>
                {livePrice === undefined && `Close ${formatNumericDate(analysis.date)}`}
              </span>
            </div>
          )}
        </div>

        {showGuide && (
          <div className="wl-sz__body">
            <StockSetupsGuide />
          </div>
        )}

        {view === StockSetupsView.Scorecard && (
          <div className="wl-sz__body">
            {history.message && <div className="wl-sz-message">{history.message}</div>}
            <SetupScorecard instrumentToken={instrumentToken} tradingsymbol={tradingsymbol} refreshKey={0} inSetupsPanel />
          </div>
        )}

        <div className="wl-sz__body" hidden={view !== StockSetupsView.Details}>
          {error &&<div className="wl-sz-message wl-sz-message--error">{error}</div>}
          {history.running && <div className="wl-sz-message">Backtesting the past year: replaying each session and adding its setups to the scorecard…</div>}
          {history.message && <div className={`wl-sz-message${history.error ? ' wl-sz-message--error' : ''}`}>{history.message}</div>}
          {!data && !error && (
            <div className="wl-sz-loading">
              <span className="wl-sz-loading__spinner" />
              Loading daily candles…
            </div>
          )}
          {data?.warning && <div className="wl-sz-message wl-sz-message--warn">Couldn&apos;t refresh from Kite ({data.warning}). Showing stored candles up to {lastDate && formatNumericDate(lastDate)}.</div>}
          {data && !analysis && <div className="wl-sz-message">Not enough history yet: zones need at least {MIN_CANDLES} trading days ({data.candles.length} stored).</div>}

          {analysis && (
            <>
              <section className="wl-sz-overview">
                <p className="wl-sz-overview__note">{analysis.stateNote}</p>
                {analysis.market && data?.marketLabel && (
                  <div className="wl-sz-market">
                    <div className="wl-sz-stat">
                      <span>{tradingsymbol} · 20d</span>
                      <strong className={`wl-sz-num--${tone(analysis.market.stockPct).toLowerCase()}`}>{pct(analysis.market.stockPct)}</strong>
                    </div>
                    <div className="wl-sz-stat">
                      <span>{data.marketLabel} · 20d</span>
                      <strong className={`wl-sz-num--${tone(analysis.market.marketPct).toLowerCase()}`}>{pct(analysis.market.marketPct)}</strong>
                    </div>
                    <div className={`wl-sz-stat wl-sz-stat--wide wl-sz-market--${analysis.market.relation.toLowerCase()}`}>
                      <span>{MARKET_LABEL[analysis.market.relation]}</span>
                      <em>{marketText(analysis.market.relation, data.marketLabel)}</em>
                    </div>
                  </div>
                )}
              </section>

              <PriceLadder analysis={analysis} />

              {analysis.setups.length > 0 ? (
                <section className="wl-sz-section">
                  <h4>Setups on {formatNumericDate(analysis.date)}</h4>
                  <div className="wl-sz-setups">
                    {analysis.setups.map((setup) => {
                      const buy = setup.direction === Side.BUY;
                      return (
                        <div key={setup.type} className={`wl-sz-setup wl-sz-setup--${setup.direction.toLowerCase()}`}>
                          <div className="wl-sz-setup__head">
                            <span className="wl-sz-setup__dir">{buy ? 'Buy' : 'Sell / exit'}</span>
                            <strong>{setup.label}</strong>
                            <span className="wl-sz-setup__rr" title="Reward ÷ risk">R:R {setup.rewardRisk.toFixed(1)}</span>
                          </div>
                          <div className="wl-sz-setup__levels">
                            <div className="wl-sz-level">
                              <span>Entry</span>
                              <b>{rs(setup.entry)}</b>
                            </div>
                            <div className="wl-sz-level wl-sz-level--stop">
                              <span>Stop</span>
                              <b>{rs(setup.stop)}</b>
                              <small>{pct((setup.stop / setup.entry - 1) * 100)}</small>
                            </div>
                            <div className="wl-sz-level wl-sz-level--target">
                              <span>Target</span>
                              <b>{rs(setup.target)}</b>
                              <small>{pct((setup.target / setup.entry - 1) * 100)}</small>
                            </div>
                          </div>
                          <p>{setup.note}</p>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : (
                <section className="wl-sz-plan">
                  <span className="wl-sz-plan__label">No setup today · Plan</span>
                  <p>{analysis.plan}</p>
                </section>
              )}

              <div className="wl-sz-columns">
                <section className="wl-sz-section">
                  <h4><i className="wl-sz-dot wl-sz-dot--support" />Support · buy zones</h4>
                  {analysis.supports.length
                    ? <div className="wl-sz-zones">{zoneRows(analysis.supports)}</div>
                    : <p className="wl-sz-empty">No support zone below the price in the stored history.</p>}
                </section>

                <section className="wl-sz-section">
                  <h4><i className="wl-sz-dot wl-sz-dot--resistance" />Resistance · exit zones</h4>
                  {analysis.resistances.length
                    ? <div className="wl-sz-zones">{zoneRows(analysis.resistances)}</div>
                    : <p className="wl-sz-empty">No resistance zone above: the price is at or near its highs.</p>}
                </section>
              </div>

              {(volatility || expectedMove) && (
                <section className="wl-sz-vol">
                  {volatility && (
                    <>
                      <div className="wl-sz-stat" title="How much the stock actually moved over the last 20 sessions, as a yearly rate">
                        <span>Realised volatility · 20d</span>
                        <strong>{(volatility.annual * 100).toFixed(1)}% <small>a year</small></strong>
                        <em>≈ {((volatility.annual / Math.sqrt(TRADING_DAYS)) * 100).toFixed(1)}% a day</em>
                      </div>
                      <div className="wl-sz-stat" title="From the last 20 sessions: about 2 months in 3 stay within this">
                        <span>Usual 20-day move</span>
                        <strong>±{rs(volatility.monthly)} <small>({((volatility.monthly / analysis.price) * 100).toFixed(1)}%)</small></strong>
                        <em>{band(analysis.price, volatility.monthly)}</em>
                        <em className="wl-sz-stat__daily">{perDay(analysis.price, volatility.daily)}</em>
                      </div>
                    </>
                  )}
                  {expectedMove && (
                    <div className="wl-sz-stat" title={`${expectedMove.strike} CE + PE: the move the options price in by expiry`}>
                      <span>Expected move · {shortDate(expectedMove.expiry)}</span>
                      <strong>±{rs(expectedMove.straddle)} <small>({((expectedMove.straddle / analysis.price) * 100).toFixed(1)}%)</small></strong>
                      <em>{band(analysis.price, expectedMove.straddle)}</em>
                      {expectedDaily !== null && (
                        <em className="wl-sz-stat__daily" title="The straddle prices the average move, about 0.8× a standard move, so it is scaled up to compare with the usual move">
                          {perDay(analysis.price, expectedDaily)} · {sessionsTo(expectedMove.expiry)}d
                        </em>
                      )}
                    </div>
                  )}
                </section>
              )}

              <section className="wl-sz-indicators">
                {([
                  ['20-day avg', analysis.indicators.sma20],
                  ['50-day avg', analysis.indicators.sma50],
                  ['200-day avg', analysis.indicators.sma200],
                  ['ATR (14)', analysis.indicators.atr],
                ] as const).map(([label, value]) => (
                  <div key={label} className="wl-sz-stat">
                    <span>{label}</span>
                    <strong>{value === null ? '—' : rs(value)}</strong>
                  </div>
                ))}
                <div className="wl-sz-stat">
                  <span>RSI (14)</span>
                  {analysis.indicators.rsi === null ? <strong>—</strong> : (
                    <strong className={`wl-sz-rsi--${rsiLabel(analysis.indicators.rsi).tone.toLowerCase()}`} title={`RSI ${analysis.indicators.rsi.toFixed(0)}`}>
                      {rsiLabel(analysis.indicators.rsi).text}
                    </strong>
                  )}
                </div>
              </section>
            </>
          )}
        </div>

        <div className="wl-sz__footer">
          Based on {data ? `${data.candles.length} trading days` : 'past prices'}{lastDate ? ` up to ${formatNumericDate(lastDate)}` : ''}. Zones improve the odds, not certainty; sell setups on cash stocks are exits, not shorts.
        </div>
      </div>
    </div>
  );
};

export default StockSetupsPanel;