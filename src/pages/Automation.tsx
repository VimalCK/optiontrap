/**
 * Automation — automated intraday (and later positional) trades.
 *
 * Every trade the automation takes runs through the same lifecycle:
 * selected → validated (or rejected) → executed into paper trading → closed.
 * This page lists the trades (clicking one shows its lifecycle); the gear
 * opens the settings page (AutomationSettings). Trades are taken on the
 * server by the trade engine (active strategies) and closed by the trade
 * monitor (exit rules).
 *
 * Names and rules: shared/automation.js.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LIFECYCLE_STAGES, TRADE_KINDS } from '../../shared/automation.js';
import { STRATEGIES } from '../../shared/strategies/index.js';
import { marketDate } from '../../shared/marketTime.js';
import { rangeProblem } from '@/components/TradeJournal/journalRange';
import IconButton from '@/components/IconButton/IconButton';
import { SettingsIcon } from '@/components/icons/Icons';
import { AutomationConfig, AutoTrade, fetchAutomationConfig, fetchAutoTrades } from '@/services/automation';
import { isAbortError } from '@/services/apiClient';
import { formatAmount } from '@/utils/formatAmount';
import { formatCalendarDate, istTimeLabel } from '@/utils/marketStatus';
import '@/styles/automation.css';

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

const kindLabel = (id: string) => TRADE_KINDS.find((k) => k.id === id)?.label ?? id;
const stageLabel = (id: string) => LIFECYCLE_STAGES.find((s) => s.id === id)?.label ?? id;

// ── Trades ──

/** A fill price, or a dash before there is one. */
const price = (value: number | null) => (value == null ? '–' : formatAmount(value));

const eventTime = (at: string) => {
  const date = new Date(at);
  return `${formatCalendarDate(at.slice(0, 10), { day: 'numeric', month: 'short' })} ${istTimeLabel(date)}`;
};

/** Wait this long after the last range change before fetching. */
const FETCH_DELAY_MS = 400;

export interface TradeRange { from: string; to: string }

/** From / To dates for the trades list; To can't be before From. */
export const TradeRangePicker: React.FC<{ range: TradeRange; onChange: (range: TradeRange) => void }> = ({ range, onChange }) => (
  <div className="automation-range">
    <label className="automation-range__label">
      From
      <input type="date" className="app-date-input" value={range.from} max={range.to || undefined}
        onChange={(e) => onChange({ ...range, from: e.target.value })} />
    </label>
    <label className="automation-range__label">
      To
      <input type="date" className="app-date-input" value={range.to} min={range.from || undefined}
        onChange={(e) => onChange({ ...range, to: e.target.value })} />
    </label>
  </div>
);

export const AutoTradesTable: React.FC<{ trades: AutoTrade[]; loading?: boolean; error?: string | null; controls?: React.ReactNode }> = ({ trades, loading, error, controls }) => {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="card" aria-labelledby="automation-trades-title">
      <div className="automation-section__head">
        <h3 id="automation-trades-title" className="card__title">Automated trades</h3>
        {controls}
      </div>
      {error && <p className="automation-message automation-message--error">{error}</p>}
      {loading && <p className="card__description">Loading…</p>}
      {!loading && !error && trades.length === 0 && (
        <p className="card__description">No automated trades in this range. Each one will show here with every stage of its lifecycle.</p>
      )}
      {trades.length > 0 && (
        <table className="automation-table automation-trades">
          <thead>
            <tr>
              <th>Time</th>
              <th>Symbol</th>
              <th>Type</th>
              <th>Side</th>
              <th>Qty</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>Stage</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <React.Fragment key={t.id}>
                <tr className="automation-trades__row" onClick={() => setOpen(open === t.id ? null : t.id)}>
                  <td>{eventTime(t.createdAt)}</td>
                  <td>{t.tradingsymbol}</td>
                  <td>{kindLabel(t.kind)}</td>
                  <td>{t.side}</td>
                  <td>{t.quantity}</td>
                  <td>{price(t.entryPrice)}</td>
                  <td>{price(t.exitPrice)}</td>
                  <td><span className={`automation-stage automation-stage--${t.stage}`}>{stageLabel(t.stage)}</span></td>
                  <td>{t.reason ?? ''}</td>
                </tr>
                {open === t.id && (
                  <tr className="automation-trades__events">
                    <td colSpan={9}>
                      <ol>
                        {t.events.map((e, i) => (
                          <li key={i}>
                            <span className={`automation-stage automation-stage--${e.stage}`}>{stageLabel(e.stage)}</span>
                            {' '}{eventTime(e.at)}
                            {e.detail != null && <code>{JSON.stringify(e.detail)}</code>}
                          </li>
                        ))}
                      </ol>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};

// ── Page ──

/** "On" or "Off", and whether anything can trade: a strategy must exist and be active. */
export function automationStatus(config: AutomationConfig | null, strategies: { id: string }[] = STRATEGIES): string {
  if (!config) return 'Loading…';
  const onOff = config.enabled ? 'On' : 'Off';
  if (strategies.length === 0) return `${onOff} · no strategies yet, nothing trades`;
  const active = strategies.filter((s) => config.strategies[s.id]?.active).length;
  if (active === 0) return `${onOff} · no strategy active`;
  return `${onOff} · ${active} strateg${active === 1 ? 'y' : 'ies'} active`;
}

const Automation: React.FC = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<AutomationConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  // Opens on today's trades; From / To fetches any other range.
  const [range, setRange] = useState<TradeRange>(() => ({ from: marketDate(), to: marketDate() }));
  const [trades, setTrades] = useState<AutoTrade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [tradesError, setTradesError] = useState<string | null>(null);
  const problem = rangeProblem(range.from, range.to);

  useEffect(() => {
    const controller = new AbortController();
    fetchAutomationConfig(controller.signal)
      .then(setConfig)
      .catch((err) => { if (!isAbortError(err)) setConfigError(errorText(err, 'Could not load the settings')); });
    return () => controller.abort();
  }, []);

  // Fetch exactly the range picked, shortly after the last change to it.
  useEffect(() => {
    if (problem) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setTradesLoading(true);
      setTradesError(null);
      fetchAutoTrades(range, controller.signal)
        .then(setTrades)
        .catch((err) => { if (!isAbortError(err)) setTradesError(errorText(err, 'Could not load automated trades')); })
        .finally(() => { if (!controller.signal.aborted) setTradesLoading(false); });
    }, FETCH_DELAY_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [range, problem]);

  return (
    <div className="automation">
      <header className="automation-header">
        <h1 className="automation-header__title">Automation</h1>
        <span className="automation-header__status">{configError ? 'Settings could not be loaded' : automationStatus(config)}</span>
      </header>

      <AutoTradesTable
        trades={trades}
        loading={tradesLoading && !problem}
        error={problem ?? tradesError}
        controls={(
          <div className="automation-section__actions">
            <TradeRangePicker range={range} onChange={setRange} />
            <IconButton
              icon={<SettingsIcon size={18} />}
              label="Automation settings"
              onClick={() => navigate('/automation/settings')}
            />
          </div>
        )}
      />
    </div>
  );
};

export default Automation;
