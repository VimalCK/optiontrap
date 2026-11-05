/**
 * The automation configuration form: on/off, paper or live, intraday or
 * positional, and which trade types may buy or sell. Options that aren't
 * built yet are shown but can't be chosen. Names and rules:
 * shared/automation.js.
 */
import React from 'react';
import { EXECUTION_MODES, HORIZONS, TRADE_KINDS, TRADE_SIDES } from '../../../shared/automation.js';
import type { AutomationConfig, TradeKindId, TradeSide } from '@/services/automation';

export interface AutomationConfigFormProps {
  config: AutomationConfig;
  onChange: (config: AutomationConfig) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}

const sideLabel = (side: string) => (side === 'BUY' ? 'Buy' : 'Sell');

const AutomationConfigForm: React.FC<AutomationConfigFormProps> = ({ config, onChange, onSave, onCancel, saving, error }) => {
  const setSide = (kind: TradeKindId, side: TradeSide, on: boolean) =>
    onChange({ ...config, kinds: { ...config.kinds, [kind]: { ...config.kinds[kind], [side]: on } } });

  return (
    <section className="card automation-config" aria-label="Automation settings">
      <div className="automation-config__row">
        <span className="automation-config__label">Automation</span>
        <label className="automation-switch">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
          />
          <span>{config.enabled ? 'On' : 'Off'}</span>
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
            {TRADE_SIDES.map((side) => <th key={side}>{sideLabel(side)}</th>)}
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
                    aria-label={`${sideLabel(side)} ${kind.label}`}
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
        {error && <span className="automation-message automation-message--error">{error}</span>}
        <button type="button" className="app-btn" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="app-btn app-btn--primary" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
};

export default AutomationConfigForm;
