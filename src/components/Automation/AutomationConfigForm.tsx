/**
 * One strategy's settings: whether it runs, how (paper, live or both at once), which trades (intraday or
 * positional), the signals it takes, and its own entry and exit rules, one tab each. Save and Cancel belong to the
 * settings page. Options that aren't built yet are shown but can't be chosen.
 */
import React, { useState } from 'react';
import { EXECUTION_MODES, HORIZONS } from '../../../shared/automation.js';
import type { StrategySettings } from '@/services/automation';
import Toggle from '@/components/Toggle/Toggle';
import TabBar from '@/components/TabBar/TabBar';
import Badge from '@/components/Badge/Badge';
import LockedFields from './LockedFields';
import type { StrategyInfo } from '@/services/strategies';
import { ENTRY_RULES } from '../../../shared/entryRules/index.js';
import { EXIT_RULES } from '../../../shared/exitRules/index.js';
import RuleSettingsForm, { RuleParams } from './RuleSettingsForm';
import type { RuleSettings } from '../../../shared/rules/ruleSettings.js';
import { StrategyRulesTab, Tone, type StrategyRulesTabId } from '@/utils/uiEnums';

const NOT_AVAILABLE = 'not available yet';

export interface AutomationConfigFormProps {
  strategy: StrategyInfo;
  /** The user's settings for this strategy. */
  settings: StrategySettings;
  onChange: (settings: StrategySettings) => void;
  /** The account's Algo Trading switch: the strategy places trades only while it and the strategy are on, and its
   * settings can be changed only then. */
  algoTradingOn: boolean;
  /** The rule tab shown first. */
  initialRulesTab?: StrategyRulesTabId;
}

interface SectionProps {
  settings: StrategySettings;
  onChange: (settings: StrategySettings) => void;
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

/** Paper and live are separate switches: a strategy with both on places each signal in both. */
const ExecutionTile: React.FC<SectionProps> = ({ settings, onChange }) => (
  <SettingTile title="Execution" hint={unavailableHint(EXECUTION_MODES)}>
    <OptionToggles
      options={EXECUTION_MODES}
      isOn={(id) => settings.execution[id as keyof StrategySettings['execution']]}
      onToggle={(id, on) => onChange({ ...settings, execution: { ...settings.execution, [id]: on } })}
    />
  </SettingTile>
);

const TradesTile: React.FC<SectionProps> = ({ settings, onChange }) => (
  <SettingTile title="Trades" hint={unavailableHint(HORIZONS)}>
    <OptionToggles
      options={HORIZONS}
      isOn={(id) => settings.horizons[id as keyof StrategySettings['horizons']]}
      onToggle={(id, on) => onChange({ ...settings, horizons: { ...settings.horizons, [id]: on } })}
    />
  </SettingTile>
);

/** Whether the strategy places trades, and if not, what to switch on (both switches are on the Settings page). */
export function strategyState(algoTradingOn: boolean, active: boolean): { on: boolean; reason: string | null } {
  if (!algoTradingOn) return { on: false, reason: 'Algo Trading is off in Settings' };
  if (!active) return { on: false, reason: 'Switch it on in Settings' };
  return { on: true, reason: null };
}

const StrategyHeader: React.FC<{ strategy: StrategyInfo; active: boolean; algoTradingOn: boolean }> = ({ strategy, active, algoTradingOn }) => {
  const state = strategyState(algoTradingOn, active);
  return (
    <header className="automation-strategy">
      <div className="automation-strategy__text">
        <div className="automation-strategy__title-row">
          <h2 className="automation-strategy__name">{strategy.label}</h2>
          <Badge tone={state.on ? Tone.Positive : Tone.Neutral} dot={state.on} label={`${strategy.label} ${state.on ? 'on' : 'off'}`}>
            {state.on ? 'On' : 'Off'}
          </Badge>
          {state.reason && <span className="automation-strategy__state-reason">{state.reason}</span>}
        </div>
        <p className="automation-strategy__description">{strategy.description}</p>
      </div>
    </header>
  );
};

const RulesTab: React.FC<SectionProps & { tab: StrategyRulesTabId; strategyLabel: string }> = ({ tab, strategyLabel, settings, onChange }) =>
  tab === StrategyRulesTab.EntryRules
    ? (
      <RuleSettingsForm
        rules={ENTRY_RULES}
        settings={settings.entryRules}
        onChange={(entryRules) => onChange({ ...settings, entryRules })}
        label={`${strategyLabel} entry rules`}
        description="Every trade this strategy picks is checked against the active rules before it is executed; the first rule that refuses it rejects it."
      />
    )
    : (
      <RuleSettingsForm
        rules={EXIT_RULES}
        settings={settings.exitRules}
        onChange={(exitRules) => onChange({ ...settings, exitRules })}
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

const AutomationConfigForm: React.FC<AutomationConfigFormProps> = ({ strategy, settings, onChange, algoTradingOn, initialRulesTab = StrategyRulesTab.EntryRules }) => {
  const [rulesTab, setRulesTab] = useState<StrategyRulesTabId>(initialRulesTab);
  const locked = !strategyState(algoTradingOn, settings.active).on;
  const rulesTabs = [
    { id: StrategyRulesTab.EntryRules, label: tabLabel('Entry rules', activeCount(settings.entryRules)), title: 'Entry rules' },
    { id: StrategyRulesTab.ExitRules, label: tabLabel('Exit rules', activeCount(settings.exitRules)), title: 'Exit rules' },
  ];

  return (
    <div className="automation-config" role="group" aria-label={`Trading Strategies · ${strategy.label}`}>
      <StrategyHeader strategy={strategy} active={settings.active} algoTradingOn={algoTradingOn} />

      <LockedFields locked={locked}>
        <div className="automation-tiles">
          <ExecutionTile settings={settings} onChange={onChange} />
          <TradesTile settings={settings} onChange={onChange} />
          {strategy.params.length > 0 && (
            <SettingTile title="Signal filters" hint="Only setups that reach every minimum are traded">
              <RuleParams rule={strategy} setting={settings} onChange={(own) => onChange({ ...settings, ...own })} />
            </SettingTile>
          )}
        </div>
      </LockedFields>

      <section className="automation-rules-panel" aria-label={`${strategy.label} rules`}>
        <TabBar
          items={rulesTabs}
          activeId={rulesTab}
          onChange={setRulesTab}
          className="analytics-tabs analytics-tabs--small"
          tabClassName="analytics-tab"
          ariaLabel={`${strategy.label} rules`}
        />
        <LockedFields locked={locked}>
          <RulesTab tab={rulesTab} strategyLabel={strategy.label} settings={settings} onChange={onChange} />
        </LockedFields>
      </section>
    </div>
  );
};

export default AutomationConfigForm;
