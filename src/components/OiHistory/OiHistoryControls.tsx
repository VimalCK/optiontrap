import React, { useCallback, useRef, useState } from 'react';
import AppSelect from '@/components/AppSelect/AppSelect';
import { useDismissOnOutside } from '@/hooks/useDismissOnOutside';
import type { FetchProgress } from './types';
import { STRIKE_RANGE } from './oiTable';

type Option = { value: string; label: string };

const STRIKE_RANGE_OPTIONS = [
  { value: 5, label: '5' },
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: STRIKE_RANGE.All, label: 'All' },
  { value: STRIKE_RANGE.Specific, label: 'Specific' },
];

export interface OiHistoryControlsProps {
  scrip: string;
  scripOptions: Option[];
  recentScripOptions: Option[];
  onScrip: (scrip: string) => void;
  expiryMonth: string;
  expiryMonthOptions: Option[];
  onExpiryMonth: (month: string) => void;
  strikeRange: number;
  onStrikeRange: (range: number) => void;
  specificStrike: string;
  onSpecificStrike: (strike: string) => void;
  fetchableMonths: string[];
  fetching: boolean;
  onFetch: () => void;
  /** Admins only: the history is shared by every user. */
  onDeleteAll?: () => void;
  progress: FetchProgress | null;
  status: string | null;
  error: string | null;
}

/** The Data menu: delete every stored month of the scrip. */
const DataMenu: React.FC<{ scrip: string; disabled: boolean; onDeleteAll: () => void; onOpenChange: (open: boolean) => void }> = ({ scrip, disabled, onDeleteAll, onOpenChange }) => {
  const [open, setOpenState] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const setOpen = useCallback((next: boolean) => { setOpenState(next); onOpenChange(next); }, [onOpenChange]);
  const close = useCallback(() => setOpen(false), [setOpen]);
  useDismissOnOutside(open, menuRef, close);

  return (
    <div className="oi-history__data-menu" ref={menuRef}>
      <button
        type="button"
        className="app-btn app-btn--secondary oi-history__data-menu-trigger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Manage stored OI history data"
      >
        Data
      </button>
      {open && (
        <div className="oi-history__data-menu-panel" role="menu">
          <button
            className="oi-history__data-menu-item oi-history__data-menu-item--danger"
            onClick={() => { close(); onDeleteAll(); }}
            disabled={disabled}
            role="menuitem"
            title={`Delete all OI history data for ${scrip}`}
          >
            <strong>Delete All</strong>
            <span>Remove all stored months for {scrip}</span>
          </button>
        </div>
      )}
    </div>
  );
};

const FetchProgressBar: React.FC<{ progress: FetchProgress }> = ({ progress }) => (
  <div className="oi-history__progress">
    <div className="oi-history__progress-header">
      <span className="oi-history__progress-step">{progress.step}</span>
      {progress.pct > 0 && <span className="oi-history__progress-pct">{progress.pct}%</span>}
    </div>
    <div className="oi-history__progress-track">
      <div className="oi-history__progress-fill" style={{ width: `${progress.pct}%` }} />
    </div>
    {progress.detail && <span className="oi-history__progress-detail">{progress.detail}</span>}
  </div>
);

/** The scrip, expiry month and strikes pickers, the Fetch button (and the admin Data menu), recent scrips and fetch progress. */
const OiHistoryControls: React.FC<OiHistoryControlsProps> = (props) => {
  const { scrip, fetching, progress, fetchableMonths } = props;
  // The card lifts above the page while the Data menu is open, so the menu isn't clipped.
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={`oi-history__controls card${menuOpen ? ' oi-history__controls--menu-open' : ''}`}>
      <div className="oi-history__control-row">
        <label className="oi-history__label">
          <span>Instrument</span>
          <AppSelect value={scrip} options={props.scripOptions} onChange={(v) => props.onScrip(String(v))} placeholder="Select instrument" searchable disabled={fetching} />
        </label>

        <label className="oi-history__label">
          <span>Expiry month</span>
          <AppSelect value={props.expiryMonth} options={props.expiryMonthOptions} onChange={(v) => props.onExpiryMonth(String(v))} disabled={fetching} />
        </label>

        <label className="oi-history__label">
          <span>Strikes</span>
          <AppSelect value={props.strikeRange} options={STRIKE_RANGE_OPTIONS} onChange={(v) => props.onStrikeRange(Number(v))} />
        </label>

        {props.strikeRange === STRIKE_RANGE.Specific && (
          <label className="oi-history__label">
            <input
              className="app-input oi-history__specific-strike"
              type="number"
              min="0"
              step="50"
              placeholder="Strike"
              value={props.specificStrike}
              onChange={(event) => props.onSpecificStrike(event.target.value)}
              disabled={fetching}
            />
          </label>
        )}

        <div className="oi-history__primary-actions">
          <button
            className="app-btn app-btn--primary"
            onClick={props.onFetch}
            disabled={fetching || !scrip}
            title={fetchableMonths.length > 0
              ? `Fetch ${scrip} data for ${fetchableMonths.length} current/future expiry month(s) (${fetchableMonths.join(', ')}) from Kite`
              : 'Historical expiry months are loaded from stored database data'}
          >
            {fetching ? 'Fetching...' : 'Fetch'}
          </button>
          {props.onDeleteAll && <DataMenu scrip={scrip} disabled={fetching || !scrip} onDeleteAll={props.onDeleteAll} onOpenChange={setMenuOpen} />}
        </div>
      </div>

      {props.recentScripOptions.length > 0 && (
        <div className="oi-history__recent-scrips" aria-label="Recently visited scripts">
          <span className="oi-history__recent-scrips-label">Recent</span>
          {props.recentScripOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className="oi-history__recent-scrip"
              onClick={() => props.onScrip(option.value)}
              disabled={fetching}
              title={`Switch to ${option.label}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {progress && <FetchProgressBar progress={progress} />}
      {props.status && !progress && <div className="oi-history__status">{props.status}</div>}
      {props.error && !progress && <div className="oi-history__status oi-history__status--error">{props.error}</div>}
    </div>
  );
};

export default OiHistoryControls;
