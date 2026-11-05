/**
 * Automation settings — the full configuration page, opened from the gear on
 * the Automation screen. Save stores it and goes back to Automation; Cancel
 * goes back without saving. If saving fails, the page stays open with the
 * reason.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AutomationConfigForm from '@/components/Automation/AutomationConfigForm';
import { AutomationConfig, fetchAutomationConfig, saveAutomationConfig } from '@/services/automation';
import { isAbortError } from '@/services/apiClient';
import '@/styles/automation.css';

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

const AutomationSettings: React.FC = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<AutomationConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
      await saveAutomationConfig(config);
      back();
    } catch (err) {
      setSaveError(errorText(err, 'Could not save'));
      setSaving(false);
    }
  };

  return (
    <div className="automation">
      <header className="automation-header">
        <h1 className="automation-header__title">Automation settings</h1>
      </header>

      {loadError && (
        <div className="card">
          <p className="automation-message automation-message--error">{loadError}</p>
          <button type="button" className="app-btn" onClick={back}>Back to Automation</button>
        </div>
      )}
      {!config && !loadError && <div className="card"><p className="card__description">Loading…</p></div>}
      {config && (
        <AutomationConfigForm
          config={config}
          onChange={(next) => { setConfig(next); setSaveError(null); }}
          onSave={save}
          onCancel={back}
          saving={saving}
          error={saveError}
        />
      )}
    </div>
  );
};

export default AutomationSettings;
