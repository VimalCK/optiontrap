/**
 * Automation settings — the full configuration page, opened from the gear on
 * the Automation screen. Its tabs (General, Strategies, Entry rules, Exit rules; ?tab= in the URL)
 * show one section at a time in a card that fills the page's height. One
 * Save / Cancel at the bottom of the card serves every tab: Save stores the
 * whole configuration and stays on the page ("Saved"), so other tabs can be
 * changed next; Cancel goes back to Automation without saving. If saving
 * fails, the reason shows beside the buttons.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AutomationConfigForm, {
  AUTOMATION_SETTINGS_SECTIONS,
  type AutomationSettingsSection,
} from '@/components/Automation/AutomationConfigForm';
import FormFooter from '@/components/FormFooter/FormFooter';
import TabBar from '@/components/TabBar/TabBar';
import { AutomationConfig, fetchAutomationConfig, saveAutomationConfig } from '@/services/automation';
import { isAbortError } from '@/services/apiClient';
import '@/styles/analytics.css'; // reuse the shared tab-bar CSS
import '@/styles/automation.css';

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** The tab named in the URL, or General. */
export const sectionFromParams = (params: URLSearchParams): AutomationSettingsSection =>
  AUTOMATION_SETTINGS_SECTIONS.find((s) => s.id === params.get('tab'))?.id ?? 'general';

const AutomationSettings: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = sectionFromParams(searchParams);
  const [config, setConfig] = useState<AutomationConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
          {loadError && <p className="automation-message automation-message--error">{loadError}</p>}
          {!config && !loadError && <p className="card__description">Loading…</p>}
          {config && (
            <AutomationConfigForm
              config={config}
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
