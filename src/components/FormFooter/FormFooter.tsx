/**
 * FormFooter — the one Save / Cancel row for settings-style pages, so every
 * settings page saves and cancels the same way. The Save button itself says
 * where things stand: "Saving…" while a save is under way (both buttons
 * disabled), then "Saved" until something changes (the page stays open, e.g.
 * to change another tab). It keeps one width, so its label never shifts the
 * row. Why the last save failed shows beside the buttons.
 */
import React from 'react';
import './FormFooter.css';

export interface FormFooterProps {
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  /** Why the last save failed (the server's message). */
  error: string | null;
  /** The last save succeeded and nothing has changed since; Save reads "Saved" and is off. */
  saved?: boolean;
  /** Save can't be used yet, e.g. while the form is still loading. */
  saveDisabled?: boolean;
}

const saveLabel = (saving: boolean, saved: boolean) => {
  if (saving) return 'Saving…';
  return saved ? 'Saved' : 'Save';
};

const FormFooter: React.FC<FormFooterProps> = ({ onSave, onCancel, saving, error, saved = false, saveDisabled }) => {
  const savedNow = saved && !saving && !error;
  return (
    <div className="form-footer">
      {error && <span className="form-footer__error" role="alert">{error}</span>}
      <button type="button" className="app-btn" onClick={onCancel} disabled={saving}>Cancel</button>
      <button
        type="button"
        className="app-btn app-btn--primary form-footer__save"
        onClick={onSave}
        disabled={saving || saveDisabled || savedNow}
        aria-live="polite"
      >
        {saveLabel(saving, savedNow)}
      </button>
    </div>
  );
};

export default FormFooter;
