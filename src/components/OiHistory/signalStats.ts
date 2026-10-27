import type { SignalBreakdownRow, SignalVerdict, TradeSignalRow } from './types';

/** Fewer scored signals than this and a slice gets no verdict. */
export const MIN_SCORED_FOR_VERDICT = 5;

const isScored = (signal: TradeSignalRow) => signal.outcome_status === 'Profit' || signal.outcome_status === 'Loss';

const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

function dteBucket(days: number | null | undefined): string | null {
  if (days === null || days === undefined || !Number.isFinite(days)) return null;
  if (days <= 2) return '0–2 days';
  if (days <= 7) return '3–7 days';
  return '8+ days';
}

/**
 * How each slice is labelled. A signal with no value for a slice (e.g. an
 * older signal logged before OI patterns were recorded) is left out of it.
 * `order` fixes the row order; labels not listed sort by sample size.
 */
const SLICES: { group: string; label: (signal: TradeSignalRow) => string | null | undefined; order?: string[] }[] = [
  { group: 'Action', label: (s) => s.action, order: ['BUY', 'SELL'] },
  { group: 'Setup', label: (s) => `${s.action} ${s.option_type}`, order: ['BUY CE', 'BUY PE', 'SELL CE', 'SELL PE'] },
  { group: 'Strength', label: (s) => s.status, order: ['Confirmed', 'Watch'] },
  { group: 'OI pattern', label: (s) => s.details?.strikePattern },
  { group: 'IV flow', label: (s) => s.details?.ivFlow, order: ['Buyers Adding', 'Writers Adding', 'Buyers Exiting', 'Writers Covering', 'Unclear', 'Stable'] },
  { group: 'Option flow', label: (s) => s.details?.flowBias, order: ['Upward', 'Neutral', 'Downward'] },
  { group: 'Price trend', label: (s) => s.details?.priceTrend?.direction, order: ['Upward', 'Sideways', 'Downward', 'Unknown'] },
  { group: 'Days to expiry', label: (s) => dteBucket(s.details?.decay?.daysToExpiry), order: ['0–2 days', '3–7 days', '8+ days'] },
];

export function signalVerdict(scored: number, winRate: number | null, averageReturn: number | null): SignalVerdict {
  if (scored < MIN_SCORED_FOR_VERDICT || winRate === null || averageReturn === null) return 'Too few';
  if (averageReturn < 0 && winRate < 50) return 'Losing';
  if (averageReturn > 0 && winRate >= 50) return 'Working';
  return 'Mixed';
}

/** Win rate, average return and average worst move for each slice of the logged signals. */
export function summarizeSignalBreakdown(signals: TradeSignalRow[]): SignalBreakdownRow[] {
  const result: SignalBreakdownRow[] = [];

  for (const slice of SLICES) {
    const byLabel = new Map<string, TradeSignalRow[]>();
    for (const signal of signals) {
      const label = slice.label(signal);
      if (!label) continue;
      const list = byLabel.get(label);
      if (list) list.push(signal);
      else byLabel.set(label, [signal]);
    }

    const rows = [...byLabel].map(([label, list]): SignalBreakdownRow => {
      const scored = list.filter(isScored);
      const returns = scored.map((signal) => Number(signal.outcome_return ?? 0));
      const adverse = scored
        .map((signal) => signal.max_adverse_return)
        .filter((value): value is number => value !== null && Number.isFinite(Number(value)))
        .map(Number);
      const winRate = scored.length ? (scored.filter((signal) => signal.outcome_status === 'Profit').length / scored.length) * 100 : null;
      const averageReturn = average(returns);
      return {
        group: slice.group,
        label,
        total: list.length,
        scored: scored.length,
        winRate,
        averageReturn,
        averageMaxAdverse: average(adverse),
        verdict: signalVerdict(scored.length, winRate, averageReturn),
      };
    });

    const rank = (label: string) => {
      const index = slice.order?.indexOf(label) ?? -1;
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    rows.sort((a, b) => rank(a.label) - rank(b.label) || b.scored - a.scored || a.label.localeCompare(b.label));
    result.push(...rows);
  }

  return result;
}
