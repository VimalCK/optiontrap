/**
 * One rule list in the automation settings (the Entry rules and Exit rules
 * tabs): every rule in the list, each with an Active / Inactive toggle and
 * inputs for its values. Built entirely from the rule list it is given, so a
 * new rule shows up without changes to this file. Rules and settings logic:
 * shared/rules/ruleSettings.js.
 */
import React from 'react';
import { PARAM_TYPES } from '../../../shared/rules/paramTypes.js';
import Toggle from '@/components/Toggle/Toggle';
import type { ParamTypeId } from '../../../shared/rules/paramTypes.js';
import type { ParamValue, RuleInfo, RuleSetting, RuleSettings } from '../../../shared/rules/ruleSettings.js';

export interface RuleSettingsFormProps {
  /** The rule list, e.g. ENTRY_RULES. */
  rules: RuleInfo[];
  settings: RuleSettings;
  onChange: (settings: RuleSettings) => void;
  /** Names the group for screen readers, e.g. "Entry rules". */
  label: string;
  /** One line on how the list is used. */
  description: string;
  /** Shown instead of the list when it has no rules (e.g. no strategies yet). */
  emptyText?: string;
}

/** What an input's text means as a value: empty is "not set"; anything else stays as typed, for the server to check. */
export function paramValueFromInput(type: ParamTypeId, text: string): ParamValue {
  if (text === '') return null;
  return PARAM_TYPES[type].input === 'number' ? Number(text) : text;
}

const RuleRow: React.FC<{ rule: RuleInfo; setting: RuleSetting; onChange: (setting: RuleSetting) => void }> = ({ rule, setting, onChange }) => (
  <li className="automation-rule">
    <div className="automation-rule__text">
      <span className="automation-rule__label">{rule.label}</span>
      <span className="automation-rule__description">{rule.description}</span>
    </div>
    <div className="automation-rule__params">
      {rule.params.map((param) => {
        const type = PARAM_TYPES[param.type];
        return (
          <label key={param.key} className="automation-rule__param">
            {!param.hideLabel && param.label}
            <input
              type={type.input}
              aria-label={param.hideLabel ? param.label : undefined}
              step={type.step}
              className="app-input automation-rule__input"
              value={setting.params[param.key] ?? ''}
              onChange={(e) => onChange({ ...setting, params: { ...setting.params, [param.key]: paramValueFromInput(param.type, e.target.value) } })}
            />
          </label>
        );
      })}
    </div>
    <div className="automation-rule__toggle">
      <Toggle
        checked={setting.active}
        label={`${rule.label} active`}
        onText="Active"
        offText="Inactive"
        onChange={(active) => onChange({ ...setting, active })}
      />
    </div>
  </li>
);

const RuleSettingsForm: React.FC<RuleSettingsFormProps> = ({ rules, settings, onChange, label, description, emptyText }) => (
  <div role="group" aria-label={label}>
    <p className="card__description">{description}</p>
    {rules.length === 0 && emptyText && <p className="automation-rules__empty">{emptyText}</p>}
    <ul className="automation-rules">
      {rules.map((rule) => (
        <RuleRow key={rule.id} rule={rule} setting={settings[rule.id]} onChange={(setting) => onChange({ ...settings, [rule.id]: setting })} />
      ))}
    </ul>
  </div>
);

export default RuleSettingsForm;
