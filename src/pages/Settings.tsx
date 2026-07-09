import React, { useState } from 'react';
import { useTheme, ACCENT_THEMES, AccentTheme } from '@/context/ThemeContext';
import AppSelect from '@/components/AppSelect/AppSelect';
import { SettingsIcon } from '@/components/icons/Icons';
import '@/styles/settings.css';

const TRADING_MODE_KEY = 'optiontrap_order_mode';

const Settings: React.FC = () => {
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

      <div className="settings-section">
        <h2 className="settings-section__title">Data & Privacy</h2>
        <p className="settings-section__description">
          Manage data exports, privacy settings, and account deletion
        </p>
        <div className="card-grid">
          <div className="card">
            <div className="card__icon">
              <SettingsIcon />
            </div>
            <h3 className="card__title">Export Data</h3>
            <p className="card__description">
              Download all your trading data and account information.
            </p>
          </div>
          <div className="card">
            <div className="card__icon">
              <SettingsIcon />
            </div>
            <h3 className="card__title">Privacy Controls</h3>
            <p className="card__description">
              Manage visibility, data sharing, and tracking preferences.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
