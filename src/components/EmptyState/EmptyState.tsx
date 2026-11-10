/**
 * EmptyState — the one "nothing here yet" panel for cards and lists, so an
 * empty area shows a friendly picture and a line of text instead of blank
 * space, and looks the same on every screen. The icon (from
 * components/icons/Icons.tsx) floats gently inside an accent glow, over a
 * shadow; the motion stops for users who ask for reduced motion.
 */
import React from 'react';
import './EmptyState.css';

export interface EmptyStateProps {
  /** The picture, e.g. `<AutomationIcon size={64} />`. */
  icon: React.ReactNode;
  title: string;
  description?: string;
  className?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, className }) => (
  <div className={['empty-state', className].filter(Boolean).join(' ')}>
    <div className="empty-state__art" aria-hidden="true">
      <span className="empty-state__halo" />
      <span className="empty-state__icon">{icon}</span>
      <span className="empty-state__shadow" />
    </div>
    <p className="empty-state__title">{title}</p>
    {description && <p className="empty-state__description">{description}</p>}
  </div>
);

export default EmptyState;
