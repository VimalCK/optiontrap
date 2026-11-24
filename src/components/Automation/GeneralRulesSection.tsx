import React from 'react';
import { GENERAL_RULES } from '../../../shared/generalRules/index.js';
import type { RuleSettings } from '../../../shared/rules/ruleSettings.js';
import RuleSettingsForm from './RuleSettingsForm';

export interface GeneralRulesSectionProps {
  settings: RuleSettings;
  onChange: (settings: RuleSettings) => void;
}

/** The account's rules over every strategy: Maximum open positions and Max loss per day. */
const GeneralRulesSection: React.FC<GeneralRulesSectionProps> = ({ settings, onChange }) => (
  <section className="automation-general" aria-labelledby="automation-general-title">
    <h2 id="automation-general-title" className="automation-general__title">All strategies</h2>
    <RuleSettingsForm
      rules={GENERAL_RULES}
      settings={settings}
      onChange={onChange}
      label="Rules for all strategies"
      description="These rules count every strategy's trades together. A trade any strategy picks is checked against them first; max loss per day also closes every automated position once hit."
    />
  </section>
);

export default GeneralRulesSection;
