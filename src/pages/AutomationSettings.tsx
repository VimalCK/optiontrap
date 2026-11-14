/**
 * Algo Trading settings. One Save / Cancel serves every tab: Save stores the
 * whole configuration and stays on the page ("Saved"); Cancel leaves unsaved.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AutomationConfigForm, {
  AUTOMATION_SETTINGS_SECTIONS,
} from '@/components/Automation/AutomationConfigForm';
import FormFooter from '@/components/FormFooter/FormFooter';
import TabBar from '@/components/TabBar/TabBar';
import { AutomationConfig, fetchAutomationConfig, saveAutomationConfig } from '@/services/automation';
import { isAbortError } from '@/services/apiClient';
import { useStrategies } from '@/hooks/useStrategies';
import { AutomationSettingsSection, type AutomationSettingsSectionId, enumFromParam, MessageTone } from '@/utils/uiEnums';
import Message from '@/components/Message/Message';
import '@/styles/analytics.css'; // reuse the shared tab-bar CSS
import Shimmer, { ShimmerGroup, shimmerKeys } from '@/components/Shimmer/Shimmer';
import { ShimmerShape } from '@/utils/uiEnums';
import '@/styles/automation.css';

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** Placeholder setting rows while the configuration loads. */
const PLACEHOLDER_SETTINGS = shimmerKeys(4);

const SettingsShimmer: React.FC = () => (
  <ShimmerGroup label="Loading Algo Trading settings">
    {PLACEHOLDER_SETTINGS.map((row) => (
      <div key={row} className="automation-config__row automation-settings-shimmer__row">
        <span className="automation-config__label"><Shimmer width="5em" /></span>
        <Shimmer shape={ShimmerShape.Block} className="automation-settings-shimmer__control" />
      </div>
    ))}
  </ShimmerGroup>
);

export const sectionFromParams = (params: URLSearchParams): AutomationSettingsSectionId =>
  enumFromParam(AutomationSettingsSection, params.get('tab'), AutomationSettingsSection.General);

const AutomationSettings: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = sectionFromParams(searchParams);
  const [config, setConfig] = useState<AutomationConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { strategies, error: strategiesError } = useStrategies();
  const error = loadError ?? strategiesError;

  useEffect(() => {
    const controller = new AbortController();
    fetchAutomationConfig(controller.signal)
      .then(setConfig)
      .catch((err) => { if (!isAbortError(err)) setLoadError(errorText(err, 'Could not load the settings')); });
    return () => controller.abort();
  }, []);

  const back = () => navigate('/automation');

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
      <TabBar
        items={AUTOMATION_SETTINGS_SECTIONS}
        activeId={section}
        onChange={(id) => setSearchParams({ tab: id }, { replace: true })}
        className="analytics-tabs"
        tabClassName="analytics-tab"
        ariaLabel="Algo Trading settings sections"
      />

      <section className="card automation-settings__card">
        <div className="automation-settings__body">
          {error && <Message tone={MessageTone.Error}>{error}</Message>}
          {(!config || !strategies) && !error && <SettingsShimmer />}
          {config && strategies && (
            <AutomationConfigForm
              config={config}
              strategies={strategies}
              section={section}
              onChange={(next) => { setConfig(next); setSaveError(null); setSaved(false); }}
            />
          )}
        </div>
        <FormFooter onSave={save} onCancel={back} saving={saving} error={saveError} saved={saved} saveDisabled={!config} />
      </section>
    </div>
  );
};

export default AutomationSettings;