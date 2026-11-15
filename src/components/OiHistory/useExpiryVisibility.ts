import { useCallback, useMemo, useState } from 'react';

/** Which of the selected date's expiries the table and chart hide. */
export function useExpiryVisibility(tableExpiries: string[]) {
  const [hiddenExpiries, setHiddenExpiries] = useState<Set<string>>(() => new Set());
  const visibleTableExpiries = useMemo(() => tableExpiries.filter((exp) => !hiddenExpiries.has(exp)), [tableExpiries, hiddenExpiries]);

  /** Hide or show an expiry in the table and chart; the last one shown stays. */
  const toggleExpiryVisibility = (expiry: string) => {
    setHiddenExpiries((prev) => {
      const isHidden = prev.has(expiry);
      if (!isHidden && tableExpiries.filter((exp) => !prev.has(exp)).length <= 1) return prev;
      const next = new Set(prev);
      if (isHidden) next.delete(expiry);
      else next.add(expiry);
      return next;
    });
  };

  const showExpiry = useCallback((expiry: string) => {
    setHiddenExpiries((prev) => {
      if (!prev.has(expiry)) return prev;
      const next = new Set(prev);
      next.delete(expiry);
      return next;
    });
  }, []);

  return { hiddenExpiries, visibleTableExpiries, toggleExpiryVisibility, showExpiry };
}
