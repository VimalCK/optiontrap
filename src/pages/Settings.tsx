import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import { SettingsIcon } from '@/components/icons/Icons';
import '@/styles/settings.css';

const Settings: React.FC = () => {
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <div className="page-header">
        <h1 className="page-header__title">Settings</h1>
        <p className="page-header__subtitle">
          Configure application preferences and notifications
        </p>
      </div>

      <div className="settings-section">
        <h2 className="settings-section__title">Appearance</h2>
        <p className="settings-section__description">
          Choose your preferred color theme
        </p>

        <div className="theme-switcher">
          <button
            className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
            onClick={() => setTheme('dark')}
            aria-pressed={theme === 'dark'}
          >
            <div className="theme-option__preview theme-option__preview--dark">
              <div className="theme-preview__sidebar" />
              <div className="theme-preview__content">
                <div className="theme-preview__line" />
                <div className="theme-preview__line theme-preview__line--short" />
              </div>
            </div>
            <span className="theme-option__label">Dark</span>
          </button>

          <button
            className={`theme-option ${theme === 'light' ? 'active' : ''}`}
            onClick={() => setTheme('light')}
            aria-pressed={theme === 'light'}
          >
            <div className="theme-option__preview theme-option__preview--light">
              <div className="theme-preview__sidebar" />
              <div className="theme-preview__content">
                <div className="theme-preview__line" />
                <div className="theme-preview__line theme-preview__line--short" />
              </div>
            </div>
            <span className="theme-option__label">Light</span>
          </button>
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
