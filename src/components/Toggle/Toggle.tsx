/**
 * Toggle — the one on/off switch used across the app (automation on/off, each
 * entry rule's Active/Inactive, …), so every switch looks and behaves the
 * same. It is a button with role="switch": a sliding knob, then the text for
 * the current state (left out when that text is empty, e.g. a toggle in a
 * table cell under a column heading). `label` is the accessible name and tooltip.
 */
import React from 'react';
import './Toggle.css';

export interface ToggleProps {
  /** Whether it is on. */
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** What it switches, e.g. "Max lots per trade"; read by screen readers and shown on hover. */
  label: string;
  /** Text shown next to the switch for each state; '' shows none. */
  onText?: string;
  offText?: string;
  disabled?: boolean;
}

const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label, onText = 'On', offText = 'Off', disabled }) => {
  const text = checked ? onText : offText;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className={`toggle${checked ? ' toggle--on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__track" aria-hidden="true"><span className="toggle__knob" /></span>
      {text && <span className="toggle__text">{text}</span>}
    </button>
  );
};

export default Toggle;
