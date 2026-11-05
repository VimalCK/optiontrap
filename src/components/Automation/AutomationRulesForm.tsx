/**
 * The Validations tab of the automation settings: every rule in
 * shared/automationRules/, each with an Active / Inactive switch and inputs
 * for its values. Built entirely from the rule list, so a new rule shows up
 * here without changes to this file.
 */
import React from 'react';
import { AUTOMATION_RULES } from '../../../shared/automationRules/index.js';
import { PARAM_TYPES } from '../../../shared/automationRules/paramTypes.js';
import Toggle from '@/components/Toggle/Toggle';
import type { AutomationRule, ParamValue, RuleSetting, RuleSettings } from '../../../shared/automationRules/index.js';

export interface AutomationRulesFormProps {
  rules: RuleSettings;
  onChange: (rules: RuleSettings) => void;
}

/** What an input's text means as a value: empty is "not set"; anything else stays as typed, for the server to check. */
export const paramValueFromInput = (text: string): ParamValue => (text === '' ? null : Number(text));

const RuleRow: React.FC<{ rule: AutomationRule; setting: RuleSetting; onChange: (setting: RuleSetting) => void }> = ({ rule, setting, onChange }) => (
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
            {param.label}
            <input
              type="number"
              step={type.step}
              className="app-input automation-rule__input"
              value={setting.params[param.key] ?? ''}
              onChange={(e) => onChange({ ...setting, params: { ...setting.params, [param.key]: paramValueFromInput(e.target.value) } })}
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

const AutomationRulesForm: React.FC<AutomationRulesFormProps> = ({ rules, onChange }) => (
  <div role="group" aria-label="Validation rules">
    <p className="card__description">Every trade is checked against the active rules before it is executed; the first rule that refuses it rejects it.</p>
    <ul className="automation-rules">
      {AUTOMATION_RULES.map((rule) => (
        <RuleRow key={rule.id} rule={rule} setting={rules[rule.id]} onChange={(setting) => onChange({ ...rules, [rule.id]: setting })} />
      ))}
    </ul>
  </div>
);

export default AutomationRulesForm;
