/**
 * Automation — automated intraday (and later positional) trades.
 *
 * Every trade the automation takes runs through the same lifecycle:
 * selected → validated (or rejected) → executed into paper trading → closed.
 * This page shows each trade's lifecycle; the gear opens the settings page
 * (AutomationSettings). The engine that selects and executes trades is not
 * built yet, so nothing trades from here.
 *
 * Names and rules: shared/automation.js.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LIFECYCLE_STAGES, TRADE_KINDS } from '../../shared/automation.js';
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

/** What each lifecycle stage does, in order. */
export const LIFECYCLE_STEPS: { title: string; stages: string; text: string }[] = [
  { title: 'Selection', stages: 'selected', text: 'Intraday: a signal from the OI snapshots picks the trade. Positional (later): from OI history.' },
  { title: 'Validation', stages: 'validated / rejected', text: 'Every trade must pass all validation rules; one that fails is rejected, with the reason kept.' },
  { title: 'Execution', stages: 'executed', text: 'Sent straight to paper trading, so it shows in Positions like any paper trade.' },
  { title: 'Completion', stages: 'closed', text: 'The position is monitored until it is exited; the exit and its reason are recorded.' },
];

// ── Lifecycle ──

/** `action` sits at the card's top right (the settings gear). */
export const LifecycleSteps: React.FC<{ action?: React.ReactNode }> = ({ action }) => (
  <section className="card" aria-labelledby="automation-lifecycle-title">
    <div className="automation-section__head">
      <h3 id="automation-lifecycle-title" className="card__title">How a trade runs</h3>
      {action}
    </div>
    <ol className="automation-lifecycle">
      {LIFECYCLE_STEPS.map((step) => (
        <li key={step.title} className="automation-lifecycle__step">
          <strong>{step.title}</strong>
          <span className="automation-lifecycle__stages">{step.stages}</span>
          <p>{step.text}</p>
        </li>
      ))}
    </ol>
  </section>
);

// ── Trades ──

/** A fill price, or a dash before there is one. */
const price = (value: number | null) => (value == null ? '–' : formatAmount(value));

const eventTime = (at: string) => {
  const date = new Date(at);
  return `${formatCalendarDate(at.slice(0, 10), { day: 'numeric', month: 'short' })} ${istTimeLabel(date)}`;
};

export const AutoTradesTable: React.FC<{ trades: AutoTrade[]; loading?: boolean; error?: string | null }> = ({ trades, loading, error }) => {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="card" aria-labelledby="automation-trades-title">
      <h3 id="automation-trades-title" className="card__title">Automated trades</h3>
      {error && <p className="automation-message automation-message--error">{error}</p>}
      {loading && <p className="card__description">Loading…</p>}
      {!loading && !error && trades.length === 0 && (
        <p className="card__description">No automated trades yet. Each one will show here with every stage of its lifecycle.</p>
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

/** "On" or "Off", and what that means while the engine isn't built. */
export function automationStatus(config: AutomationConfig | null): string {
  if (!config) return 'Loading…';
  return `${config.enabled ? 'On' : 'Off'} · engine not built yet, nothing trades`;
}

const Automation: React.FC = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<AutomationConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [trades, setTrades] = useState<AutoTrade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [tradesError, setTradesError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchAutomationConfig(controller.signal)
      .then(setConfig)
      .catch((err) => { if (!isAbortError(err)) setConfigError(errorText(err, 'Could not load the settings')); });
    fetchAutoTrades(controller.signal)
      .then(setTrades)
      .catch((err) => { if (!isAbortError(err)) setTradesError(errorText(err, 'Could not load automated trades')); })
      .finally(() => { if (!controller.signal.aborted) setTradesLoading(false); });
    return () => controller.abort();
  }, []);

  return (
    <div className="automation">
      <header className="automation-header">
        <h1 className="automation-header__title">Automation</h1>
        <span className="automation-header__status">{configError ? 'Settings could not be loaded' : automationStatus(config)}</span>
      </header>

      <LifecycleSteps
        action={(
          <IconButton
            icon={<SettingsIcon size={18} />}
            label="Automation settings"
            onClick={() => navigate('/automation/settings')}
          />
        )}
      />
      <AutoTradesTable trades={trades} loading={tradesLoading} error={tradesError} />
    </div>
  );
};

export default Automation;
