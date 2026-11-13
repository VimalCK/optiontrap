import React from 'react';
import './Badge.css';
import type { ToneId } from '@/utils/uiEnums';

export interface BadgeProps {
  tone: ToneId;
  children: React.ReactNode;
  /** Show a leading dot (e.g. a state that is still in progress). */
  dot?: boolean;
  /** Read by screen readers instead of the text (e.g. "Side: Sell"). */
  label?: string;
  className?: string;
}

const Badge: React.FC<BadgeProps> = ({ tone, children, dot, label, className }) => (
  <span className={['badge', `badge--${tone.toLowerCase()}`, className].filter(Boolean).join(' ')} aria-label={label}>
    {dot && <span className="badge__dot" aria-hidden="true" />}
    {children}
  </span>
);

export default Badge;
