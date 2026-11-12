import type { SignalBreakdownRow, TradeSignalRow } from './types';
import { OptionType, Side } from '../../../shared/tradeEnums.js';
import { OiFlow, Richness, SignalVerdict, TradeSetupStatus, Trend, oiFlowLabel, rolloverPatternLabel, type SignalVerdictId } from '../../../shared/analysisEnums.js';
import { SignalOutcome } from '../../../shared/appEnums.js';

/** Fewer scored signals than this and a slice gets no verdict. */
export const MIN_SCORED_FOR_VERDICT = 5;

const isScored = (signal: TradeSignalRow) => signal.outcome_status === SignalOutcome.Profit || signal.outcome_status === SignalOutcome.Loss;

const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

function dteBucket(days: number | null | undefined): string | null {
  if (days === null || days === undefined || !Number.isFinite(days)) return null;
  if (days <= 2) return '0–2 days';
  if (days <= 7) return '3–7 days';
  return '8+ days';
}

/** A slice: the value it groups signals by, its row order, and the label shown for a value. */
interface Slice {
  group: string;
  value: (signal: TradeSignalRow) => string | null | undefined;
  order?: string[];
  label?: (value: string) => string;
}

/** A setup slice's value: the action and the option, e.g. "BUY CE". */
const setupOf = (action: string, optionType: string) => `${action} ${optionType}`;

/**
 * How each slice groups the signals. A signal with no value for a slice (e.g.
 * an older signal logged before OI patterns were recorded) is left out of it.
 * `order` fixes the row order; values not listed sort by sample size.
 */
const SLICES: Slice[] = [
  { group: 'Action', value: (s) => s.action, order: [Side.BUY, Side.SELL] },
  {
    group: 'Setup',
    value: (s) => setupOf(s.action, s.option_type),
    order: [setupOf(Side.BUY, OptionType.CE), setupOf(Side.BUY, OptionType.PE), setupOf(Side.SELL, OptionType.CE), setupOf(Side.SELL, OptionType.PE)],
  },
  { group: 'Strength', value: (s) => s.status, order: [TradeSetupStatus.Confirmed, TradeSetupStatus.Watch] },
  { group: 'OI pattern', value: (s) => s.details?.strikePattern, label: rolloverPatternLabel },
  {
    group: 'IV flow',
    value: (s) => s.details?.ivFlow,
    order: [OiFlow.BuyersAdding, OiFlow.WritersAdding, OiFlow.BuyersExiting, OiFlow.WritersCovering, OiFlow.Unclear, OiFlow.Stable],
    label: oiFlowLabel,
  },
  { group: 'Fair value', value: (s) => s.details?.fairValue, order: [Richness.Expensive, Richness.Fair, Richness.Cheap] },
  { group: 'Option flow', value: (s) => s.details?.flowBias, order: [Trend.Upward, Trend.Neutral, Trend.Downward] },
  { group: 'Price trend', value: (s) => s.details?.priceTrend?.direction, order: [Trend.Upward, Trend.Sideways, Trend.Downward, Trend.Unknown] },
  { group: 'Days to expiry', value: (s) => dteBucket(s.details?.decay?.daysToExpiry), order: ['0–2 days', '3–7 days', '8+ days'] },
];

export function signalVerdict(scored: number, winRate: number | null, averageReturn: number | null): SignalVerdictId {
  if (scored < MIN_SCORED_FOR_VERDICT || winRate === null || averageReturn === null) return SignalVerdict.TooFew;
  if (averageReturn < 0 && winRate < 50) return SignalVerdict.Losing;
  if (averageReturn > 0 && winRate >= 50) return SignalVerdict.Working;
  return SignalVerdict.Mixed;
}

/** Win rate, average return and average worst move for each slice of the logged signals. */
export function summarizeSignalBreakdown(signals: TradeSignalRow[]): SignalBreakdownRow[] {
  const result: SignalBreakdownRow[] = [];

  for (const slice of SLICES) {
    const byValue = new Map<string, TradeSignalRow[]>();
    for (const signal of signals) {
      const value = slice.value(signal);
      if (!value) continue;
      const list = byValue.get(value);
      if (list) list.push(signal);
      else byValue.set(value, [signal]);
    }

    const rows = [...byValue].map(([value, list]): SignalBreakdownRow & { value: string } => {
      const scored = list.filter(isScored);
      const returns = scored.map((signal) => Number(signal.outcome_return ?? 0));
      const adverse = scored
        .map((signal) => signal.max_adverse_return)
        .filter((value): value is number => value !== null && Number.isFinite(Number(value)))
        .map(Number);
      const winRate = scored.length ? (scored.filter((signal) => signal.outcome_status === SignalOutcome.Profit).length / scored.length) * 100 : null;
      const averageReturn = average(returns);
      return {
        group: slice.group,
        value,
        label: slice.label?.(value) ?? value,
        total: list.length,
        scored: scored.length,
        winRate,
        averageReturn,
        averageMaxAdverse: average(adverse),
        verdict: signalVerdict(scored.length, winRate, averageReturn),
      };
    });

    const rank = (value: string) => {
      const index = slice.order?.indexOf(value) ?? -1;
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    rows.sort((a, b) => rank(a.value) - rank(b.value) || b.scored - a.scored || a.label.localeCompare(b.label));
    result.push(...rows.map(({ value: _value, ...row }) => row));
  }

  return result;
}
