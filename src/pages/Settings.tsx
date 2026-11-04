import React, { useEffect, useState } from 'react';
import { useTheme, ACCENT_THEMES } from '@/context/ThemeContext';
import AppSelect from '@/components/AppSelect/AppSelect';
import { useAbortSignal } from '@/hooks/useAbortSignal';
import { useKiteSession } from '@/hooks/useKiteSession';
import { fetchUnderlyings, setAlwaysSnapshot, type Underlying } from '@/services/underlyings';
import '@/styles/settings.css';

const TRADING_MODE_KEY = 'optiontrap_order_mode';

type TradingMode = 'paper' | 'live';

const TRADING_MODES: { id: TradingMode; label: string; hint: string }[] = [
  { id: 'paper', label: 'Paper', hint: 'Orders are simulated: nothing is sent to Kite and no money is used.' },
  { id: 'live', label: 'Live', hint: 'Orders are sent to Kite and placed with real money.' },
];

/** One setting: a card with a small label, a title, a line on what it does, then its control. */
const SettingCard: React.FC<{
  eyebrow: string;
  title: string;
  description: string;
  badge?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}> = ({ eyebrow, title, description, badge, wide, children }) => (
  <section className={`settings-card${wide ? ' settings-card--wide' : ''}`}>
    <header className="settings-card__header">
      <span className="settings-card__eyebrow">{eyebrow}</span>
      <div className="settings-card__title-row">
        <h2 className="settings-card__title">{title}</h2>
        {badge}
      </div>
      <p className="settings-card__description">{description}</p>
    </header>
    <div className="settings-card__body">{children}</div>
  </section>
);

/**
 * Admin: which Option Analyzer symbols get an OI snapshot every trading day.
 * Each tick or untick is saved straight away (instruments.always_snapshot).
 */
const AlwaysSnapshotSetting: React.FC = () => {
  const signal = useAbortSignal();
  const [underlyings, setUnderlyings] = useState<Underlying[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUnderlyings(signal)
      .then((list) => setUnderlyings(list.filter((u) => u.instrumentToken !== null)))
      .catch((err) => { if (!signal.aborted) setError(err.message); });
  }, []);

  const toggle = async (name: string | number) => {
    const current = underlyings.find((u) => u.name === name);
    if (!current) return;
    const next = !current.alwaysSnapshot;
    const apply = (value: boolean) => setUnderlyings((list) => list.map((u) => (u.name === name ? { ...u, alwaysSnapshot: value } : u)));
    apply(next);
    setError(null);
    try {
      await setAlwaysSnapshot(current.name, next);
    } catch (err) {
      apply(!next);
      setError(`Could not update ${current.label}: ${(err as Error).message}`);
    }
  };

  const selected = underlyings.filter((u) => u.alwaysSnapshot);

  return (
    <SettingCard
      eyebrow="Data collection"
      title="Always Snapshot"
      description="Symbols whose option chain OI is snapshotted every trading day, whether or not anyone opens them in the Option Analyzer. Other symbols are snapshotted only on the day someone picks them."
      badge={<span className="settings-badge settings-badge--admin">Admin</span>}
      wide
    >
      <div className="settings-snapshot">
        <AppSelect
          selectedValues={selected.map((u) => u.name)}
          options={underlyings.map((u) => ({ value: u.name, label: u.label }))}
          onChange={toggle}
          placeholder="Choose symbols"
          searchable
          className="settings-always-snapshot"
        />
        <span className="settings-snapshot__count">
          {selected.length === 1 ? '1 symbol' : `${selected.length} symbols`}
        </span>
      </div>
      {selected.length > 0 && (
        <div className="settings-chips">
          {selected.map((u) => (
            <span key={u.name} className="settings-chip">
              {u.label}
              <button
                type="button"
                className="settings-chip__remove"
                onClick={() => toggle(u.name)}
                title={`Stop snapshotting ${u.label} every day`}
                aria-label={`Remove ${u.label}`}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
      {error && <p className="settings-error">{error}</p>}
    </SettingCard>
  );
};

const Settings: React.FC = () => {
  const { session } = useKiteSession();
  const { accent, setAccent } = useTheme();
  const [tradingMode, setTradingMode] = useState<TradingMode>(() =>
    (localStorage.getItem(TRADING_MODE_KEY) as TradingMode) || 'paper'
  );

  const handleTradingModeChange = (mode: TradingMode) => {
    setTradingMode(mode);
    localStorage.setItem(TRADING_MODE_KEY, mode);
  };

  const modeHint = TRADING_MODES.find((m) => m.id === tradingMode)?.hint;

  return (
    <div className="settings">
      <header className="settings-header">
        <h1 className="settings-header__title">Settings</h1>
      </header>

      <div className="settings-grid">
        <SettingCard
          eyebrow="Orders"
          title="Trading Mode"
          description="Choose whether orders are placed as paper trades or sent live to Kite."
        >
          <div className="settings-toggle" role="radiogroup" aria-label="Trading mode">
            {TRADING_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={tradingMode === m.id}
                className={`settings-toggle__option settings-toggle__option--${m.id}${tradingMode === m.id ? ' settings-toggle__option--active' : ''}`}
                onClick={() => handleTradingModeChange(m.id)}
              >
                <span className="settings-toggle__dot" />
                {m.label}
              </button>
            ))}
          </div>
          <p className={`settings-hint settings-hint--${tradingMode}`}>{modeHint}</p>
        </SettingCard>

        <SettingCard
          eyebrow="Appearance"
          title="Accent Color"
          description="The colour used for highlights, active tabs and buttons across the app."
        >
          <div className="settings-swatches" role="radiogroup" aria-label="Accent color">
            {ACCENT_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={accent === t.id}
                className={`settings-swatch${accent === t.id ? ' settings-swatch--active' : ''}`}
                style={{ '--swatch-color': t.color } as React.CSSProperties}
                onClick={() => setAccent(t.id)}
                title={t.label}
              >
                <span className="settings-swatch__dot" />
                <span className="settings-swatch__label">{t.label}</span>
              </button>
            ))}
          </div>
        </SettingCard>

        {session?.isAdmin === true && <AlwaysSnapshotSetting />}

        <SettingCard
          eyebrow="Alerts"
          title="Notifications"
          description="How you hear about trades and price alerts."
          wide
        >
          <ul className="settings-rows">
            <li className="settings-row">
              <div>
                <span className="settings-row__title">Email alerts</span>
                <span className="settings-row__detail">Trade confirmations and price alerts by email.</span>
              </div>
              <span className="settings-badge">Coming soon</span>
            </li>
            <li className="settings-row">
              <div>
                <span className="settings-row__title">Push notifications</span>
                <span className="settings-row__detail">Real-time notifications for market events.</span>
              </div>
              <span className="settings-badge">Coming soon</span>
            </li>
          </ul>
        </SettingCard>
      </div>
    </div>
  );
};

export default Settings;
