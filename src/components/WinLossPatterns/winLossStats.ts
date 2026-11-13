/**
 * Grouping and sums happen on the server (server/winLossResults.js); this file
 * only derives the ratios and labels from each group's totals.
 */
import { RESULTS_ENTRY_SLOT_MINUTES } from '../../../shared/automation.js';
import { ENGINE_EXITS, EXIT_RULES } from '../../../shared/exitRules/index.js';
import { sideLabel, strategyLabel } from '@/components/Automation/autoTradeView';
import type { StrategyInfo } from '@/services/strategies';
import type { ResultGroup } from '@/services/automation';
import { formatCalendarDate } from '@/utils/marketStatus';
import { type SideId } from '../../../shared/tradeEnums.js';
import { setupPatternLabel } from '../../../shared/analysisEnums.js';

export const winRate = (g: ResultGroup<unknown>): number | null => (g.trades > 0 ? (g.wins / g.trades) * 100 : null);

export const averagePnl = (g: ResultGroup<unknown>): number | null => (g.trades > 0 ? g.pnl / g.trades : null);

export const averageWin = (g: ResultGroup<unknown>): number | null => (g.wins > 0 ? g.grossProfit / g.wins : null);

/** As a negative amount. */
export const averageLoss = (g: ResultGroup<unknown>): number | null => (g.losses > 0 ? -g.grossLoss / g.losses : null);

/** Null when nothing was lost (it has no value then). */
export const profitFactor = (g: ResultGroup<unknown>): number | null => (g.grossLoss > 0 ? g.grossProfit / g.grossLoss : null);

/** A null id is a manual exit. */
export function exitRuleLabel(id: string | null): string {
  if (id === null) return 'Exited manually';
  return [...EXIT_RULES, ...ENGINE_EXITS].find((exit) => exit.id === id)?.label ?? id;
}

/** Trades recorded before strategies were stored have no id. */
export const strategyName = (id: string | null, strategies: StrategyInfo[]): string => (id === null ? 'Unknown' : strategyLabel(id, strategies) ?? id);

export const setupName = (setup: string | null): string => (setup === null ? 'Unknown' : setupPatternLabel(setup));

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** An entry slot (minutes after IST midnight) as its IST time span, e.g. "09:30–10:00". */
export const entrySlotLabel = (minutes: number): string => `${clock(minutes)}–${clock(minutes + RESULTS_ENTRY_SLOT_MINUTES)}`;

export const sideName = (side: SideId): string => sideLabel(side);

/** An IST day, e.g. "Mon, 9 Nov". */
export const dayLabel = (day: string): string => formatCalendarDate(day, { weekday: 'short', day: 'numeric', month: 'short' });

/** An IST day without its weekday, e.g. "9 Nov". */
export const shortDayLabel = (day: string): string => formatCalendarDate(day, { day: 'numeric', month: 'short' });

/** At most this many day labels under the daily bars, so they never crowd. */
const MAX_DAY_LABELS = 10;

/**
 * Each day as a bar from the zero line: its height as a % of the biggest day
 * (up or down), and whether to label it (every day up to MAX_DAY_LABELS
 * days, else every nth, always the last).
 */
export function dailyBars(days: ResultGroup<string>[]) {
  const biggest = Math.max(0, ...days.map((d) => Math.abs(d.pnl)));
  const every = Math.ceil(days.length / MAX_DAY_LABELS);
  return withRunningTotal(days).map((day, i) => ({
    ...day,
    height: biggest > 0 ? (Math.abs(day.pnl) / biggest) * 100 : 0,
    labelled: (days.length - 1 - i) % every === 0,
  }));
}

export function withRunningTotal(days: ResultGroup<string>[]): (ResultGroup<string> & { total: number })[] {
  let total = 0;
  return days.map((day) => {
    total += day.pnl;
    return { ...day, total };
  });
}
