import React from 'react';
import './LoadingState.css';

export interface LoadingStateProps {
  /** What is loading, e.g. "Loading holdings…". */
  label?: string;
  /** Sits in a row of controls or a table cell, without the block's padding. */
  inline?: boolean;
  className?: string;
}

const LoadingState: React.FC<LoadingStateProps> = ({ label = 'Loading…', inline = false, className }) => (
  <div className={['loading-state', inline && 'loading-state--inline', className].filter(Boolean).join(' ')} role="status">
    <span className="loading-state__spinner" aria-hidden="true" />
    <span className="loading-state__label">{label}</span>
  </div>
);

export default LoadingState;
