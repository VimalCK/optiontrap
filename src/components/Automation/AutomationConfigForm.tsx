/**
 * The automation configuration form, one section at a time (the settings
 * page's tabs pick which):
 *   general      on/off, paper or live, intraday or positional, and which
 *                trade types may buy or sell
 *   validations  the validation rules (AutomationRulesForm)
 * Save and Cancel belong to the settings page, shared by every section.
 * Options that aren't built yet are shown but can't be chosen. Names and
 * rules: shared/automation.js.
 */
import React from 'react';
import { EXECUTION_MODES, HORIZONS, TRADE_KINDS, TRADE_SIDES } from '../../../shared/automation.js';
import type { AutomationConfig, TradeKindId, TradeSide } from '@/services/automation';
import Toggle from '@/components/Toggle/Toggle';
import AutomationRulesForm from './AutomationRulesForm';

export type AutomationSettingsSection = 'general' | 'validations';

/** The settings sections, in tab order. */
export const AUTOMATION_SETTINGS_SECTIONS: { id: AutomationSettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'validations', label: 'Validations' },
];

export interface AutomationConfigFormProps {
  config: AutomationConfig;
  section: AutomationSettingsSection;
  onChange: (config: AutomationConfig) => void;
}

interface SectionProps {
  config: AutomationConfig;
  onChange: (config: AutomationConfig) => void;
}

const sideLabel = (side: string) => (side === 'BUY' ? 'Buy' : 'Sell');

const GeneralSettings: React.FC<SectionProps> = ({ config, onChange }) => {
  const setSide = (kind: TradeKindId, side: TradeSide, on: boolean) =>
    onChange({ ...config, kinds: { ...config.kinds, [kind]: { ...config.kinds[kind], [side]: on } } });

  return (
    <>
      <div className="automation-config__row">
        <span className="automation-config__label">Automation</span>
        <Toggle checked={config.enabled} label="Automation" onChange={(enabled) => onChange({ ...config, enabled })} />
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
            <span key={h.id} className={`automation-option ${h.available ? '' : 'automation-option--unavailable'}`}>
              <Toggle
                checked={config.horizons[h.id as keyof AutomationConfig['horizons']]}
                label={h.label}
                onText={h.label}
                offText={h.label}
                disabled={!h.available}
                onChange={(on) => onChange({ ...config, horizons: { ...config.horizons, [h.id]: on } })}
              />
              <small>{h.id === 'intraday' ? ' · from OI snapshots' : ' · later, from OI history'}</small>
            </span>
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
                  <Toggle
                    checked={config.kinds[kind.id as TradeKindId][side as TradeSide]}
                    label={`${sideLabel(side)} ${kind.label}`}
                    onText=""
                    offText=""
                    onChange={(on) => setSide(kind.id as TradeKindId, side as TradeSide, on)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};

const ValidationSettings: React.FC<SectionProps> = ({ config, onChange }) => (
  <AutomationRulesForm rules={config.rules} onChange={(rules) => onChange({ ...config, rules })} />
);

const SECTION_VIEWS: Record<AutomationSettingsSection, React.FC<SectionProps>> = {
  general: GeneralSettings,
  validations: ValidationSettings,
};

const sectionLabel = (id: AutomationSettingsSection) => AUTOMATION_SETTINGS_SECTIONS.find((s) => s.id === id)?.label ?? id;

const AutomationConfigForm: React.FC<AutomationConfigFormProps> = ({ config, section, onChange }) => {
  const Section = SECTION_VIEWS[section];
  return (
    <div className="automation-config" role="group" aria-label={`Automation settings · ${sectionLabel(section)}`}>
      <Section config={config} onChange={onChange} />
    </div>
  );
};

export default AutomationConfigForm;
