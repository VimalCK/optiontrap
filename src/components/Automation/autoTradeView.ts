/**
 * How an automated trade reads on the Algo Trading page: its horizon, the badge
 * tone of its side and stage, its P&L once closed, and a plain sentence for each
 * lifecycle event (instead of the stored JSON), which also carries the reasons.
 * Pure functions, so the page only renders. Stages: shared/automation.js;
 * strategies: the trade engine's (GET /api/strategies, useStrategies).
 */
import { LIFECYCLE_STAGES } from '../../../shared/automation.js';
import { marketDate } from '../../../shared/marketTime.js';
import { paperPnl } from '../../../shared/paperPnl.js';
import type { BadgeTone } from '@/components/Badge/Badge';
import type { AutoTrade, AutoTradeEvent } from '@/services/automation';
import type { StrategyInfo } from '@/services/strategies';
import { formatAmount } from '@/utils/formatAmount';

type Stage = AutoTrade['stage'];

/** Each stage's badge tone: in-progress stages in the accent, a rejection red, a finished trade grey. */
const STAGE_TONES: Record<Stage, BadgeTone> = {
  selected: 'neutral',
  validated: 'accent',
  executed: 'accent',
  rejected: 'negative',
  closed: 'neutral',
};

export const stageTone = (stage: Stage): BadgeTone => STAGE_TONES[stage];

/** A lifecycle step's tone in the timeline: every step green, a rejection red. */
export const stepTone = (stage: Stage): BadgeTone => (stage === 'rejected' ? 'negative' : 'positive');

/** An open position (executed, not yet closed) shows a live dot. */
export const stageIsLive = (stage: Stage): boolean => stage === 'executed';

export const stageLabel = (stage: string): string => LIFECYCLE_STAGES.find((s) => s.id === stage)?.label ?? stage;

/** How long the trade is meant to be held, e.g. "Intraday" (shared/horizons.js). */
export { horizonLabel } from '../../../shared/horizons.js';

export const sideTone = (side: AutoTrade['side']): BadgeTone => (side === 'BUY' ? 'positive' : 'negative');

export const sideLabel = (side: AutoTrade['side']): string => (side === 'BUY' ? 'Buy' : 'Sell');

/** The trade's own P&L once closed (its entry to its exit), after its charges; null before that. */
export function closedPnl(trade: AutoTrade): number | null {
  if (trade.stage !== 'closed' || trade.entryPrice == null || trade.exitPrice == null) return null;
  return paperPnl({ side: trade.side, quantity: trade.quantity, entryPrice: trade.entryPrice }, trade.exitPrice) - (trade.charges ?? 0);
}

/** One IST day's automated trades, for the grid's day groups. */
export interface TradeDay {
  /** YYYY-MM-DD, IST. */
  day: string;
  trades: AutoTrade[];
  /** The day's closed trades' P&L after charges; null while none has closed. */
  pnl: number | null;
}

/** The trades grouped by the IST day they were created, keeping their order (newest first from the server). */
export function tradesByDay(trades: AutoTrade[]): TradeDay[] {
  const days: TradeDay[] = [];
  for (const trade of trades) {
    const day = marketDate(new Date(trade.createdAt));
    let group = days.find((d) => d.day === day);
    if (!group) {
      group = { day, trades: [], pnl: null };
      days.push(group);
    }
    group.trades.push(trade);
    const pnl = closedPnl(trade);
    if (pnl !== null) group.pnl = (group.pnl ?? 0) + pnl;
  }
  return days;
}

type Detail = Record<string, unknown>;

const detailOf = (event: AutoTradeEvent | undefined): Detail =>
  (event?.detail && typeof event.detail === 'object' ? event.detail as Detail : {});

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const amount = (value: unknown): string | null => (typeof value === 'number' ? `₹${formatAmount(value)}` : null);

/** A strategy's name from its id, e.g. "Option Analyzer setups"; the id itself for one not in the list. */
export const strategyLabel = (id: unknown, strategies: StrategyInfo[]): string | null => strategies.find((s) => s.id === id)?.label ?? text(id);

/** One lifecycle event as a plain sentence, naming the strategy from `strategies`. */
export function eventSummary(event: AutoTradeEvent, strategies: StrategyInfo[]): string {
  const detail = detailOf(event);
  const joined = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ');
  switch (event.stage) {
    case 'selected':
      return joined(strategyLabel(detail.strategyId, strategies), text(detail.reason)) || 'Selected';
    case 'validated':
      return 'Passed the General settings and every active entry rule';
    case 'rejected':
      return text(detail.reason) ?? 'Rejected';
    case 'executed':
      return amount(detail.entryPrice) ? `Opened a paper position at ${amount(detail.entryPrice)}` : 'Opened a paper position';
    case 'closed':
      // An exit rule's reason already names it ("Stop-loss hit: …").
      return joined(amount(detail.exitPrice) ? `Closed at ${amount(detail.exitPrice)}` : 'Closed', text(detail.reason));
    default:
      return '';
  }
}
