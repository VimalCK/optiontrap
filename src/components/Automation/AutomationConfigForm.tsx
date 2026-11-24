/**
 * One strategy's settings: whether it runs, how (paper or live), which trades (intraday or positional), the signals
 * it takes, and its own entry and exit rules, one tab each. Save and Cancel belong to the settings page. Options that
 * aren't built yet are shown but can't be chosen.
 */
import React, { useState } from 'react';
import { EXECUTION_MODES, HORIZONS } from '../../../shared/automation.js';
import type { AutomationConfig } from '@/services/automation';
import Toggle from '@/components/Toggle/Toggle';
import TabBar from '@/components/TabBar/TabBar';
import type { StrategyInfo } from '@/services/strategies';
import { ENTRY_RULES } from '../../../shared/entryRules/index.js';
import { EXIT_RULES } from '../../../shared/exitRules/index.js';
import RuleSettingsForm, { RuleParams } from './RuleSettingsForm';
import type { RuleSettings } from '../../../shared/rules/ruleSettings.js';
import { StrategyRulesTab, type StrategyRulesTabId } from '@/utils/uiEnums';

const NOT_AVAILABLE = 'not available yet';

export interface AutomationConfigFormProps {
  config: AutomationConfig;
  strategy: StrategyInfo;
  onChange: (config: AutomationConfig) => void;
  /** The rule tab shown first. */
  initialRulesTab?: StrategyRulesTabId;
}

interface SectionProps {
  config: AutomationConfig;
  onChange: (config: AutomationConfig) => void;
}

const activeCount = (settings: RuleSettings) => Object.values(settings).filter((s) => s.active).length;

/** "Live trading · not available yet", or nothing when every option is built. */
const unavailableHint = (options: { label: string; available: boolean }[]) => {
  const labels = options.filter((o) => !o.available).map((o) => o.label);
  return labels.length > 0 ? `${labels.join(', ')} · ${NOT_AVAILABLE}` : undefined;
};

const SettingTile: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <div className="automation-tile" role="group" aria-label={title}>
    <span className="automation-tile__title">{title}</span>
    <div className="automation-tile__control">{children}</div>
    {hint && <small className="automation-tile__hint">{hint}</small>}
  </div>
);

/** One switch per option, named by the option (e.g. Paper trading, Live trading); unbuilt ones can't be switched. */
const OptionToggles: React.FC<{
  options: { id: string; label: string; available: boolean }[];
  isOn: (id: string) => boolean;
  onToggle: (id: string, on: boolean) => void;
}> = ({ options, isOn, onToggle }) => (
  <div className="automation-tile__toggles">
    {options.map((o) => (
      <Toggle
        key={o.id}
        checked={isOn(o.id)}
        label={o.label}
        onText={o.label}
        offText={o.label}
        disabled={!o.available}
        onChange={(on) => onToggle(o.id, on)}
      />
    ))}
  </div>
);

// A strategy can run paper and live at once. The stored setting still holds one mode until the per-strategy
// settings are built, so the switches are a preview: Save stores the mode as before.
const ExecutionTile: React.FC<Pick<SectionProps, 'config'>> = ({ config }) => {
  const [running, setRunning] = useState<Record<string, boolean>>(() => ({ [config.mode]: true }));
  return (
    <SettingTile title="Execution" hint={unavailableHint(EXECUTION_MODES)}>
      <OptionToggles
        options={EXECUTION_MODES}
        isOn={(id) => running[id] ?? false}
        onToggle={(id, on) => setRunning((current) => ({ ...current, [id]: on }))}
      />
    </SettingTile>
  );
};

const TradesTile: React.FC<SectionProps> = ({ config, onChange }) => (
  <SettingTile title="Trades" hint={unavailableHint(HORIZONS)}>
    <OptionToggles
      options={HORIZONS}
      isOn={(id) => config.horizons[id as keyof AutomationConfig['horizons']]}
      onToggle={(id, on) => onChange({ ...config, horizons: { ...config.horizons, [id]: on } })}
    />
  </SettingTile>
);

const StrategyHeader: React.FC<SectionProps & { strategy: StrategyInfo }> = ({ strategy, config, onChange }) => {
  const setting = config.strategies[strategy.id];
  return (
    <header className="automation-strategy">
      <div className="automation-strategy__text">
        <h2 className="automation-strategy__name">{strategy.label}</h2>
        <p className="automation-strategy__description">{strategy.description}</p>
      </div>
      <Toggle
        checked={setting.active}
        label={`${strategy.label} active`}
        onText="Active"
        offText="Inactive"
        onChange={(active) => onChange({ ...config, strategies: { ...config.strategies, [strategy.id]: { ...setting, active } } })}
      />
    </header>
  );
};

const RulesTab: React.FC<SectionProps & { tab: StrategyRulesTabId; strategyLabel: string }> = ({ tab, strategyLabel, config, onChange }) =>
  tab === StrategyRulesTab.EntryRules
    ? (
      <RuleSettingsForm
        rules={ENTRY_RULES}
        settings={config.entryRules}
        onChange={(entryRules) => onChange({ ...config, entryRules })}
        label={`${strategyLabel} entry rules`}
        description="Every trade this strategy picks is checked against the active rules before it is executed; the first rule that refuses it rejects it."
      />
    )
    : (
      <RuleSettingsForm
        rules={EXIT_RULES}
        settings={config.exitRules}
        onChange={(exitRules) => onChange({ ...config, exitRules })}
        label={`${strategyLabel} exit rules`}
        description="This strategy's open positions are watched against the active rules; the first rule that fires closes the position."
      />
    );

const tabLabel = (text: string, count: number) => (
  <>
    <span className="tab-bar__text">{text}</span>
    <span className="automation-count" aria-label={`${count} active`}>{count}</span>
  </>
);

const AutomationConfigForm: React.FC<AutomationConfigFormProps> = ({ config, strategy, onChange, initialRulesTab = StrategyRulesTab.EntryRules }) => {
  const [rulesTab, setRulesTab] = useState<StrategyRulesTabId>(initialRulesTab);
  const setting = config.strategies[strategy.id];
  const rulesTabs = [
    { id: StrategyRulesTab.EntryRules, label: tabLabel('Entry rules', activeCount(config.entryRules)), title: 'Entry rules' },
    { id: StrategyRulesTab.ExitRules, label: tabLabel('Exit rules', activeCount(config.exitRules)), title: 'Exit rules' },
  ];

  return (
    <div className="automation-config" role="group" aria-label={`Trading Strategies · ${strategy.label}`}>
      <StrategyHeader strategy={strategy} config={config} onChange={onChange} />

      <div className="automation-tiles">
        <ExecutionTile config={config} />
        <TradesTile config={config} onChange={onChange} />
        {strategy.params.length > 0 && (
          <SettingTile title="Signal filters" hint="Only setups that reach every minimum are traded">
            <RuleParams
              rule={strategy}
              setting={setting}
              onChange={(next) => onChange({ ...config, strategies: { ...config.strategies, [strategy.id]: next } })}
            />
          </SettingTile>
        )}
      </div>

      <section className="automation-rules-panel" aria-label={`${strategy.label} rules`}>
        <TabBar
          items={rulesTabs}
          activeId={rulesTab}
          onChange={setRulesTab}
          className="analytics-tabs analytics-tabs--small"
          tabClassName="analytics-tab"
          ariaLabel={`${strategy.label} rules`}
        />
        <RulesTab tab={rulesTab} strategyLabel={strategy.label} config={config} onChange={onChange} />
      </section>
    </div>
  );
};

export default AutomationConfigForm;
