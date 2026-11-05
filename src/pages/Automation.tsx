/**
 * Automation — automated intraday (and later positional) trades.
 *
 * Every trade the automation takes runs through the same lifecycle:
 * selected → validated (or rejected) → executed into paper trading → closed.
 * This page holds the configuration and shows each trade's lifecycle. The
 * engine that selects and executes trades is not built yet, so nothing
 * trades from here.
 *
 * Names and rules: shared/automation.js.
 */
import React, { useEffect, useState } from 'react';
import { EXECUTION_MODES, HORIZONS, LIFECYCLE_STAGES, TRADE_KINDS, TRADE_SIDES } from '../../shared/automation.js';
import {
  AutomationConfig,
  AutoTrade,
  fetchAutomationConfig,
  fetchAutoTrades,
  saveAutomationConfig,
  TradeKindId,
  TradeSide,
} from '@/services/automation';
import { isAbortError } from '@/services/apiClient';
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

// ── Configuration ──

interface ConfigFormProps {
  config: AutomationConfig;
  onChange: (config: AutomationConfig) => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
  message: { tone: 'ok' | 'error'; text: string } | null;
}

export const AutomationConfigForm: React.FC<ConfigFormProps> = ({ config, onChange, onSave, saving, dirty, message }) => {
  const setSide = (kind: TradeKindId, side: TradeSide, on: boolean) =>
    onChange({ ...config, kinds: { ...config.kinds, [kind]: { ...config.kinds[kind], [side]: on } } });

  return (
    <section className="card automation-config" aria-labelledby="automation-config-title">
      <div className="automation-section__head">
        <h3 id="automation-config-title" className="card__title">Configuration</h3>
        <label className="automation-switch">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
          />
          <span>{config.enabled ? 'Automation on' : 'Automation off'}</span>
        </label>
      </div>

      <div className="automation-config__row">
        <span className="automation-config__label">Execution</span>
        <div className="automation-config__options">
          {EXECUTION_MODES.map((m) => (
            <label key={m.id} className={`automation-option ${m.available ? '' : 'automation-option--unavailable'}`}>
              <input
                type="radio"
                name="automation-mode"
                value={m.id}
                checked={config.mode === m.id}
                disabled={!m.available}
                onChange={() => onChange({ ...config, mode: m.id as AutomationConfig['mode'] })}
              />
              {m.label}
              {!m.available && <small> · not available yet</small>}
            </label>
          ))}
        </div>
      </div>

      <div className="automation-config__row">
        <span className="automation-config__label">Trades</span>
        <div className="automation-config__options">
          {HORIZONS.map((h) => (
            <label key={h.id} className={`automation-option ${h.available ? '' : 'automation-option--unavailable'}`}>
              <input
                type="checkbox"
                checked={config.horizons[h.id as keyof AutomationConfig['horizons']]}
                disabled={!h.available}
                onChange={(e) => onChange({ ...config, horizons: { ...config.horizons, [h.id]: e.target.checked } })}
              />
              {h.label}
              <small>{h.id === 'intraday' ? ' · from OI snapshots' : ' · later, from OI history'}</small>
            </label>
          ))}
        </div>
      </div>

      <table className="automation-table automation-kinds">
        <thead>
          <tr>
            <th>Trade type</th>
            {TRADE_SIDES.map((side) => <th key={side}>{side === 'BUY' ? 'Buy' : 'Sell'}</th>)}
          </tr>
        </thead>
        <tbody>
          {TRADE_KINDS.map((kind) => (
            <tr key={kind.id}>
              <td>{kind.label}</td>
              {TRADE_SIDES.map((side) => (
                <td key={side}>
                  <input
                    type="checkbox"
                    aria-label={`${side === 'BUY' ? 'Buy' : 'Sell'} ${kind.label}`}
                    checked={config.kinds[kind.id as TradeKindId][side as TradeSide]}
                    onChange={(e) => setSide(kind.id as TradeKindId, side as TradeSide, e.target.checked)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="automation-config__footer">
        {message && <span className={`automation-message automation-message--${message.tone}`}>{message.text}</span>}
        <button className="app-btn app-btn--primary" onClick={onSave} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
};

// ── Lifecycle ──

export const LifecycleSteps: React.FC = () => (
  <section className="card" aria-labelledby="automation-lifecycle-title">
    <h3 id="automation-lifecycle-title" className="card__title">How a trade runs</h3>
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
                  <td><span className={`automation-stage automation-stage--${t.stage}`}>{stageLabel(t.stage)}</span></td>
                  <td>{t.reason ?? ''}</td>
                </tr>
                {open === t.id && (
                  <tr className="automation-trades__events">
                    <td colSpan={7}>
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

const Automation: React.FC = () => {
  const [saved, setSaved] = useState<AutomationConfig | null>(null);
  const [config, setConfig] = useState<AutomationConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<ConfigFormProps['message']>(null);
  const [trades, setTrades] = useState<AutoTrade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [tradesError, setTradesError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchAutomationConfig(controller.signal)
      .then((c) => { setSaved(c); setConfig(c); })
      .catch((err) => { if (!isAbortError(err)) setConfigError(errorText(err, 'Could not load the configuration')); });
    fetchAutoTrades(controller.signal)
      .then(setTrades)
      .catch((err) => { if (!isAbortError(err)) setTradesError(errorText(err, 'Could not load automated trades')); })
      .finally(() => { if (!controller.signal.aborted) setTradesLoading(false); });
    return () => controller.abort();
  }, []);

  const dirty = config !== null && JSON.stringify(config) !== JSON.stringify(saved);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setMessage(null);
    try {
      const stored = await saveAutomationConfig(config);
      setSaved(stored);
      setConfig(stored);
      setMessage({ tone: 'ok', text: 'Saved' });
    } catch (err) {
      setMessage({ tone: 'error', text: errorText(err, 'Could not save') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="automation">
      <header className="automation-header">
        <h1 className="automation-header__title">Automation</h1>
        <span className="automation-header__status">
          {saved?.enabled ? 'On' : 'Off'} · engine not built yet, nothing trades
        </span>
      </header>

      {configError && <div className="card automation-message automation-message--error">{configError}</div>}
      {config && (
        <AutomationConfigForm
          config={config}
          onChange={(next) => { setConfig(next); setMessage(null); }}
          onSave={save}
          saving={saving}
          dirty={dirty}
          message={message}
        />
      )}
      <LifecycleSteps />
      <AutoTradesTable trades={trades} loading={tradesLoading} error={tradesError} />
    </div>
  );
};

export default Automation;
