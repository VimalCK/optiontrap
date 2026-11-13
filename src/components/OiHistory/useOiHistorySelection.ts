import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, isAbortError } from '@/services/apiClient';
import type { Underlying } from '@/services/underlyings';
import { MAX_RECENT_SCRIPS, addMonths, currentMonthIST, formatMonthLabel, loadRecentScrips, saveRecentScrips } from './helpers';
import { DEFAULT_STRIKE_RANGE, STRIKE_RANGE_CHOICES } from './oiTable';

const STRIKE_RANGE_KEY = 'optiontrap_strike_range';
const SPECIFIC_STRIKE_KEY = 'optiontrap_specific_strike';
/** On the first login of the day the server may still be building its instruments cache. */
const EXPIRY_MONTHS_RETRY_MS = 3000;

type Option = { value: string; label: string };

/**
 * The scrip shown (the last one opened; none until the user picks one) and the recently opened ones. Once the
 * underlyings are known, recent scrips the list no longer has (e.g. saved under an old alias) are dropped, so the
 * page doesn't open an empty scrip.
 */
export function useScripChoice(underlyings: Underlying[]) {
  const [scrip, setScrip] = useState(() => loadRecentScrips()[0] ?? '');
  const [recentScrips, setRecentScrips] = useState<string[]>(() => loadRecentScrips());
  const scripOptions = useMemo(() => underlyings.map((u) => ({ value: u.name, label: u.label })), [underlyings]);

  useEffect(() => {
    if (underlyings.length === 0) return;
    const known = new Set(underlyings.map((u) => u.name));
    const kept = loadRecentScrips().filter((value) => known.has(value));
    setRecentScrips(kept);
    saveRecentScrips(kept);
    setScrip((current) => (current && !known.has(current) ? kept[0] ?? '' : current));
  }, [underlyings]);

  const selectScrip = useCallback((nextScrip: string) => {
    setScrip(nextScrip);
    setRecentScrips((prev) => {
      const next = [nextScrip, ...prev.filter((value) => value !== nextScrip)].slice(0, MAX_RECENT_SCRIPS);
      saveRecentScrips(next);
      return next;
    });
  }, []);

  const recentScripOptions = useMemo(() => {
    const labels = new Map(scripOptions.map((option) => [option.value, option.label]));
    return recentScrips.filter((value) => value !== scrip).map((value) => ({ value, label: labels.get(value) || value }));
  }, [recentScrips, scrip, scripOptions]);

  return { scrip, selectScrip, scripOptions, recentScripOptions };
}

/** The Strikes choice and the specific strike typed for it, both remembered in this browser. */
export function useStrikeChoice() {
  const [strikeRange, setStrikeRangeState] = useState<number>(() => {
    const stored = localStorage.getItem(STRIKE_RANGE_KEY);
    const value = stored ? parseInt(stored, 10) : DEFAULT_STRIKE_RANGE;
    return STRIKE_RANGE_CHOICES.includes(value) ? value : DEFAULT_STRIKE_RANGE;
  });
  const [specificStrike, setSpecificStrikeState] = useState<string>(() => localStorage.getItem(SPECIFIC_STRIKE_KEY) || '');
  const specificStrikeValue = useMemo(() => {
    const value = Number(specificStrike);
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [specificStrike]);

  const setStrikeRange = (value: number) => {
    setStrikeRangeState(value);
    localStorage.setItem(STRIKE_RANGE_KEY, String(value));
  };
  const setSpecificStrike = (value: string) => {
    setSpecificStrikeState(value);
    localStorage.setItem(SPECIFIC_STRIKE_KEY, value);
  };

  return { strikeRange, setStrikeRange, specificStrike, setSpecificStrike, specificStrikeValue };
}

const currentMonthOnly = (): Option[] => [{ value: currentMonthIST(), label: formatMonthLabel(currentMonthIST()) }];

/**
 * The scrip's expiry months and the one picked. The request is retried once, since a transient failure would
 * otherwise leave only the current month. `onError` gets null when loading starts and the message if it fails.
 */
export function useExpiryMonths(scrip: string, signal: AbortSignal, onError: (message: string | null) => void) {
  const [selectedExpiryMonth, setSelectedExpiryMonth] = useState(currentMonthIST());
  const [expiryMonthOptions, setExpiryMonthOptions] = useState<Option[]>(currentMonthOnly);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!scrip) return;
    const current = currentMonthIST();
    let stale = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    onErrorRef.current(null);
    const requestMonths = () => apiClient.get<string[]>(`/api/oi-history/expiry-months?scrip=${scrip}`, { signal });
    const showCurrentMonthOnly = () => {
      setExpiryMonthOptions(currentMonthOnly());
      setSelectedExpiryMonth(current);
    };

    requestMonths()
      .catch((err) => {
        if (isAbortError(err) || stale) throw err;
        return new Promise<void>((resolve) => { retryTimer = setTimeout(resolve, EXPIRY_MONTHS_RETRY_MS); })
          .then(() => {
            if (stale) throw new DOMException('Superseded', 'AbortError');
            return requestMonths();
          });
      })
      .then((fetchedMonths) => {
        if (stale) return;
        const months: string[] = fetchedMonths || [];
        if (months.length === 0) {
          showCurrentMonthOnly();
          return;
        }
        const selectable = months.filter((month) => month >= current);
        const choices = selectable.length > 0 ? selectable : [current];
        setExpiryMonthOptions(months.map((m) => ({ value: m, label: formatMonthLabel(m) })));
        setSelectedExpiryMonth((prev) => (choices.includes(prev) ? prev : choices[0]));
      })
      .catch((err) => {
        if (isAbortError(err) || stale) return;
        showCurrentMonthOnly();
        onErrorRef.current(err instanceof Error ? err.message : 'Failed to load expiry months');
      });
    return () => {
      // A newer scrip's request supersedes this one.
      stale = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // The page's signal only aborts on leaving the page; a new scrip is what restarts this.
  }, [scrip]);

  const selectableExpiryMonthOptions = useMemo(() => {
    const options = expiryMonthOptions.filter((option) => option.value >= currentMonthIST());
    return options.length > 0 ? options : currentMonthOnly();
  }, [expiryMonthOptions]);

  /** Expiry months to include: only M-1 from history, then the current month through the selected one. */
  const includedExpiryMonths = useMemo(() => {
    const current = currentMonthIST();
    const previous = addMonths(current, -1);
    return expiryMonthOptions
      .map((o) => o.value)
      .filter((m) => m === previous || (m >= current && m <= selectedExpiryMonth))
      .sort();
  }, [expiryMonthOptions, selectedExpiryMonth]);

  /** Only current and future expiry months can be fetched from the current instruments cache. */
  const fetchableExpiryMonths = useMemo(() => includedExpiryMonths.filter((month) => month >= currentMonthIST()), [includedExpiryMonths]);

  return { selectedExpiryMonth, setSelectedExpiryMonth, selectableExpiryMonthOptions, includedExpiryMonths, fetchableExpiryMonths };
}
