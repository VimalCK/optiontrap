import React, { useEffect, useState } from 'react';
import { useTheme, ACCENT_THEMES } from '@/context/ThemeContext';
import { SettingsIcon } from '@/components/icons/Icons';
import AppSelect from '@/components/AppSelect/AppSelect';
import { useAbortSignal } from '@/hooks/useAbortSignal';
import { useKiteSession } from '@/hooks/useKiteSession';
import { fetchUnderlyings, setAlwaysSnapshot, type Underlying } from '@/services/underlyings';
import '@/styles/settings.css';

const TRADING_MODE_KEY = 'optiontrap_order_mode';

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

  return (
    <div className="settings-section">
      <h2 className="settings-section__title">Always Snapshot</h2>
      <p className="settings-section__description">
        Symbols whose option chain OI is snapshotted every trading day, whether or not anyone opens them
        in the Option Analyzer. Other symbols are snapshotted only on the day someone picks them.
      </p>
      <AppSelect
        selectedValues={underlyings.filter((u) => u.alwaysSnapshot).map((u) => u.name)}
        options={underlyings.map((u) => ({ value: u.name, label: u.label }))}
        onChange={toggle}
        placeholder="None"
        searchable
        className="settings-always-snapshot"
      />
      {error && <p className="settings-section__error">{error}</p>}
    </div>
  );
};

const Settings: React.FC = () => {
  const { session } = useKiteSession();
  const { accent, setAccent } = useTheme();
  const [tradingMode, setTradingMode] = useState<'paper' | 'live'>(() =>
    (localStorage.getItem(TRADING_MODE_KEY) as 'paper' | 'live') || 'paper'
  );

  const handleTradingModeChange = (mode: 'paper' | 'live') => {
    setTradingMode(mode);
    localStorage.setItem(TRADING_MODE_KEY, mode);
  };

  return (
    <div>
      <div className="settings-section">
        <h2 className="settings-section__title">Trading Mode</h2>
        <p className="settings-section__description">
          Choose whether orders are placed as paper trades or sent live to Kite
        </p>
        <div className="settings-mode-toggle">
          <button
            className={`settings-mode-btn ${tradingMode === 'paper' ? 'settings-mode-btn--active settings-mode-btn--paper' : ''}`}
            onClick={() => handleTradingModeChange('paper')}
          >
            <span className="settings-mode-btn__dot" />
            Paper
          </button>
          <button
            className={`settings-mode-btn ${tradingMode === 'live' ? 'settings-mode-btn--active settings-mode-btn--live' : ''}`}
            onClick={() => handleTradingModeChange('live')}
          >
            <span className="settings-mode-btn__dot" />
            Live
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h2 className="settings-section__title">Accent Color</h2>
        <p className="settings-section__description">
          Choose your accent color for the app
        </p>
        <div className="settings-accent-picker">
          {ACCENT_THEMES.map((t) => (
            <button
              key={t.id}
              className={`settings-accent-btn ${accent === t.id ? 'settings-accent-btn--active' : ''}`}
              style={{ '--swatch-color': t.color } as React.CSSProperties}
              onClick={() => setAccent(t.id)}
              title={t.label}
            >
              <span className="settings-accent-btn__swatch" />
              <span className="settings-accent-btn__label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {session?.isAdmin === true && <AlwaysSnapshotSetting />}

      <div className="settings-section">
        <h2 className="settings-section__title">Notifications</h2>
        <p className="settings-section__description">
          Configure email, push, and in-app notification preferences
        </p>
        <div className="card-grid">
          <div className="card">
            <div className="card__icon">
              <SettingsIcon />
            </div>
            <h3 className="card__title">Email Alerts</h3>
            <p className="card__description">
              Receive trade confirmations and price alerts via email.
            </p>
          </div>
          <div className="card">
            <div className="card__icon">
              <SettingsIcon />
            </div>
            <h3 className="card__title">Push Notifications</h3>
            <p className="card__description">
              Get real-time push notifications for market events.
            </p>
          </div>
        </div>
      </div>

    </div>
  );
};

export default Settings;
