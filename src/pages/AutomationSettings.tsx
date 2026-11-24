/**
 * Trading Strategies (the Algo Trading settings): one tab per strategy, each with its own execution, trades and
 * entry / exit rules (the account's Algo Trading switch is on the Settings page). One Save / Cancel serves every tab: Save stores the whole configuration and
 * stays on the page ("Saved"); Cancel leaves unsaved.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AutomationConfigForm from '@/components/Automation/AutomationConfigForm';
import FormFooter from '@/components/FormFooter/FormFooter';
import TabBar from '@/components/TabBar/TabBar';
import { AutomationConfig, fetchAutomationConfig, saveAutomationConfig } from '@/services/automation';
import { isAbortError } from '@/services/apiClient';
import type { StrategyInfo } from '@/services/strategies';
import { useStrategies } from '@/hooks/useStrategies';
import { MessageTone } from '@/utils/uiEnums';
import Message from '@/components/Message/Message';
import '@/styles/analytics.css'; // reuse the shared tab-bar CSS
import Shimmer, { ShimmerGroup, shimmerKeys } from '@/components/Shimmer/Shimmer';
import { ShimmerShape } from '@/utils/uiEnums';
import '@/styles/automation.css';

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

const PLACEHOLDER_TILES = shimmerKeys(3);
const PLACEHOLDER_RULES = shimmerKeys(4);

/** Placeholders in the strategy's own layout while the configuration loads. */
const SettingsShimmer: React.FC = () => (
  <ShimmerGroup label="Loading Trading Strategies">
    <div className="automation-strategy">
      <div className="automation-strategy__text">
        <Shimmer width="12em" />
        <Shimmer width="30em" />
      </div>
    </div>
    <div className="automation-tiles">
      {PLACEHOLDER_TILES.map((tile) => <Shimmer key={tile} shape={ShimmerShape.Block} className="automation-tile automation-settings-shimmer__tile" />)}
    </div>
    <ul className="automation-rules">
      {PLACEHOLDER_RULES.map((rule) => <li key={rule} className="automation-rule"><Shimmer width="14em" /></li>)}
    </ul>
  </ShimmerGroup>
);

/** The strategy named in the URL, or the first one. */
export const strategyFromParams = (params: URLSearchParams, strategies: StrategyInfo[]): StrategyInfo | null =>
  strategies.find((s) => s.id === params.get('strategy')) ?? strategies[0] ?? null;

const AutomationSettings: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [config, setConfig] = useState<AutomationConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { strategies, error: strategiesError } = useStrategies();
  const error = loadError ?? strategiesError;
  const strategy = strategies ? strategyFromParams(searchParams, strategies) : null;

  useEffect(() => {
    const controller = new AbortController();
    fetchAutomationConfig(controller.signal)
      .then(setConfig)
      .catch((err) => { if (!isAbortError(err)) setLoadError(errorText(err, 'Could not load the settings')); });
    return () => controller.abort();
  }, []);

  const back = () => navigate('/automation');
  const change = (next: AutomationConfig) => { setConfig(next); setSaveError(null); setSaved(false); };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setSaveError(null);
    try {
      setConfig(await saveAutomationConfig(config));
      setSaved(true);
    } catch (err) {
      setSaveError(errorText(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="automation automation-settings">
      <header className="automation-header">
        <h1 className="automation-header__title">Trading Strategies</h1>
      </header>

      <section className="card automation-settings__card" aria-label="Trading Strategies">
        <div className="automation-settings__tabs">
          <TabBar
            items={(strategies ?? []).map(({ id, label }) => ({ id, label }))}
            activeId={strategy?.id ?? null}
            onChange={(id) => setSearchParams({ strategy: id }, { replace: true })}
            className="analytics-tabs"
            tabClassName="analytics-tab"
            ariaLabel="Strategies"
          />
        </div>
        <div className="automation-settings__body">
          {error && <Message tone={MessageTone.Error}>{error}</Message>}
          {(!config || !strategies) && !error && <SettingsShimmer />}
          {config && strategies && (strategy
            ? <AutomationConfigForm config={config} strategy={strategy} onChange={change} />
            : <Message tone={MessageTone.Info}>No strategies yet</Message>)}
        </div>
        <FormFooter onSave={save} onCancel={back} saving={saving} error={saveError} saved={saved} saveDisabled={!config} />
      </section>
    </div>
  );
};

export default AutomationSettings;
