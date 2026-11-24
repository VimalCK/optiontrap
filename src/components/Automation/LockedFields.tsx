import React from 'react';

/** Settings that can't be changed while `locked`: the browser disables every control inside, and they're dimmed. */
const LockedFields: React.FC<{ locked: boolean; children: React.ReactNode }> = ({ locked, children }) => (
  <fieldset className={`automation-fields${locked ? ' automation-fields--locked' : ''}`} disabled={locked}>
    {children}
  </fieldset>
);

export default LockedFields;
