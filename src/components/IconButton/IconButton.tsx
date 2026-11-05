/**
 * IconButton — the one icon-only button used across the app (the settings
 * gear, the "explain this" info buttons, …), so every icon button looks and
 * behaves the same. Its label is both the tooltip and the accessible name.
 * Icons come from components/icons/Icons.tsx.
 */
import React from 'react';
import './IconButton.css';

export interface IconButtonProps {
  /** The icon to show, e.g. `<SettingsIcon size={18} />`. */
  icon: React.ReactNode;
  /** What the button does; shown as the tooltip and read by screen readers. */
  label: string;
  onClick: () => void;
  /** For a button that shows/hides a panel: whether the panel is open. */
  expanded?: boolean;
  disabled?: boolean;
  className?: string;
}

const IconButton: React.FC<IconButtonProps> = ({ icon, label, onClick, expanded, disabled, className }) => (
  <button
    type="button"
    className={['app-btn', 'app-btn--icon', 'icon-button', className].filter(Boolean).join(' ')}
    onClick={onClick}
    title={label}
    aria-label={label}
    aria-expanded={expanded}
    disabled={disabled}
  >
    {icon}
  </button>
);

export default IconButton;
