import { useMemo, useState } from 'react';
import { computeFairValues, realizedVol, volVerdict, type FairValueResult } from '@/services/fairValue';
import type { OiHistoryRow } from './types';
import { fairInputs } from './oiTable';
import type { FairSummary } from './StrikeHistoryCard';

interface FairValueViewInputs {
  visibleTableExpiries: string[];
  filterDate: string;
  filteredRows: OiHistoryRow[];
  availableDates: string[];
  rowsByDate: Map<string, OiHistoryRow[]>;
  /** Fair value for every option on the selected date. */
  fairToday: FairValueResult;
  /** Shows an expiry the user had hidden, when the legend picks it. */
  showExpiry: (expiry: string) => void;
}

/** The strike chart's fair-value view: on or off, the one expiry it draws, and its fair values and summary. */
export function useFairValueView({ visibleTableExpiries, filterDate, filteredRows, availableDates, rowsByDate, fairToday, showExpiry }: FairValueViewInputs) {
  const [showFairValue, setShowFairValue] = useState(false);
  const [fairExpiry, setFairExpiry] = useState<string | null>(null);

  /**
   * Expiry the fair-value chart shows: the picked one if still visible, else the nearest
   * one still running after the selected date. An expiry ending that day has no time
   * value left, so its IV is undefined and its straddle near zero.
   */
  const chartFairExpiry = useMemo(() => {
    if (!showFairValue) return null;
    if (fairExpiry && visibleTableExpiries.includes(fairExpiry)) return fairExpiry;
    return visibleTableExpiries.find((exp) => exp.slice(0, 10) > filterDate) ?? visibleTableExpiries[0] ?? null;
  }, [showFairValue, fairExpiry, visibleTableExpiries, filterDate]);

  const chartExpiries = useMemo(() => (chartFairExpiry ? [chartFairExpiry] : visibleTableExpiries), [chartFairExpiry, visibleTableExpiries]);

  /** Fair values of the chart's expiry on every date; only computed while the fair-value view is on. */
  const fairByDate = useMemo(() => {
    const map = new Map<string, FairValueResult>();
    if (!chartFairExpiry) return map;
    for (const [date, rows] of rowsByDate) map.set(date, computeFairValues(fairInputs(rows, date, chartFairExpiry)));
    return map;
  }, [rowsByDate, chartFairExpiry]);

  const fairSummary = useMemo((): FairSummary | null => {
    if (!chartFairExpiry || !filterDate) return null;
    const stats = fairToday.byExpiry.get(chartFairExpiry) ?? null;
    const spotCloses = availableDates
      .filter((date) => date <= filterDate)
      .map((date) => rowsByDate.get(date)?.find((r) => r.spotClose > 0)?.spotClose ?? 0);
    const realized = realizedVol(spotCloses);
    const spot = filteredRows.find((r) => r.spotClose > 0)?.spotClose ?? null;
    return { stats, realized, verdict: volVerdict(stats?.atmIv ?? null, realized), spot };
  }, [chartFairExpiry, filterDate, fairToday, availableDates, rowsByDate, filteredRows]);

  /** In the fair-value view the legend picks the one expiry the chart shows. */
  const selectFairExpiry = (expiry: string) => {
    setFairExpiry(expiry);
    showExpiry(expiry);
  };

  return { showFairValue, setShowFairValue, chartFairExpiry, chartExpiries, fairByDate, fairSummary, selectFairExpiry };
}
