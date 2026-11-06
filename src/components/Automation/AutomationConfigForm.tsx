/**
 * The automation configuration form, one section at a time (the settings
 * page's tabs pick which):
 *   general      on/off, paper or live, intraday or positional, lots per
 *                trade, and which trade types may buy or sell
 *   strategies   which strategies select trades
 *   entry-rules  the rules every trade must pass to be executed
 *   exit-rules   the rules that close an open automated position
 * (both lists shown by RuleSettingsForm)
 * Save and Cancel belong to the settings page, shared by every section.
 * Options that aren't built yet are shown but can't be chosen. Names and
 * rules: shared/automation.js.
 */
import React from 'react';
import { EXECUTION_MODES, HORIZONS, TRADE_KINDS, TRADE_SIDES } from '../../../shared/automation.js';
import type { AutomationConfig, TradeKindId, TradeSide } from '@/services/automation';
import Toggle from '@/components/Toggle/Toggle';
import { STRATEGIES } from '../../../shared/strategies/index.js';
import { ENTRY_RULES } from '../../../shared/entryRules/index.js';
import { EXIT_RULES } from '../../../shared/exitRules/index.js';
import RuleSettingsForm from './RuleSettingsForm';

export type AutomationSettingsSection = 'general' | 'strategies' | 'entry-rules' | 'exit-rules';

/** The settings sections, in tab order. */
export const AUTOMATION_SETTINGS_SECTIONS: { id: AutomationSettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'strategies', label: 'Strategies' },
  { id: 'entry-rules', label: 'Entry rules' },
  { id: 'exit-rules', label: 'Exit rules' },
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
        <span className="automation-config__label">Algo Trading</span>
        <Toggle checked={config.enabled} label="Algo Trading" onChange={(enabled) => onChange({ ...config, enabled })} />
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

const StrategySettings: React.FC<SectionProps> = ({ config, onChange }) => (
  <RuleSettingsForm
    rules={STRATEGIES}
    settings={config.strategies}
    onChange={(strategies) => onChange({ ...config, strategies })}
    label="Strategies"
    description="Active strategies run after each OI snapshot (every 10 minutes in market hours); each trade they pick goes through the entry rules."
    emptyText="No strategies yet · they come after the full-day OI snapshot study"
  />
);

const EntryRuleSettings: React.FC<SectionProps> = ({ config, onChange }) => (
  <RuleSettingsForm
    rules={ENTRY_RULES}
    settings={config.entryRules}
    onChange={(entryRules) => onChange({ ...config, entryRules })}
    label="Entry rules"
    description="Every trade is checked against the active rules before it is executed; the first rule that refuses it rejects it."
  />
);

const ExitRuleSettings: React.FC<SectionProps> = ({ config, onChange }) => (
  <RuleSettingsForm
    rules={EXIT_RULES}
    settings={config.exitRules}
    onChange={(exitRules) => onChange({ ...config, exitRules })}
    label="Exit rules"
    description="Open automated positions are watched against the active rules; the first rule that fires closes the position."
  />
);

const SECTION_VIEWS: Record<AutomationSettingsSection, React.FC<SectionProps>> = {
  general: GeneralSettings,
  strategies: StrategySettings,
  'entry-rules': EntryRuleSettings,
  'exit-rules': ExitRuleSettings,
};

const sectionLabel = (id: AutomationSettingsSection) => AUTOMATION_SETTINGS_SECTIONS.find((s) => s.id === id)?.label ?? id;

const AutomationConfigForm: React.FC<AutomationConfigFormProps> = ({ config, section, onChange }) => {
  const Section = SECTION_VIEWS[section];
  return (
    <div className="automation-config" role="group" aria-label={`Algo Trading settings · ${sectionLabel(section)}`}>
      <Section config={config} onChange={onChange} />
    </div>
  );
};

export default AutomationConfigForm;
