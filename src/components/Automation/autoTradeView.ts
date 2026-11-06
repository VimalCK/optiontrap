/**
 * How an automated trade reads on the Automation page: the badge tone of its
 * side and stage, its P&L once closed, the one-line reason for the row, and a
 * plain sentence for each lifecycle event (instead of the stored JSON).
 * Pure functions, so the page only renders. Stages: shared/automation.js;
 * strategies and rules: shared/strategies, shared/entryRules, shared/exitRules.
 */
import { LIFECYCLE_STAGES } from '../../../shared/automation.js';
import { STRATEGIES } from '../../../shared/strategies/index.js';
import { ENTRY_RULES } from '../../../shared/entryRules/index.js';
import { EXIT_RULES } from '../../../shared/exitRules/index.js';
import { paperPnl } from '../../../shared/paperPnl.js';
import type { BadgeTone } from '@/components/Badge/Badge';
import type { AutoTrade, AutoTradeEvent } from '@/services/automation';
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

/** An open position (executed, not yet closed) shows a live dot. */
export const stageIsLive = (stage: Stage): boolean => stage === 'executed';

export const stageLabel = (stage: string): string => LIFECYCLE_STAGES.find((s) => s.id === stage)?.label ?? stage;

export const sideTone = (side: AutoTrade['side']): BadgeTone => (side === 'BUY' ? 'positive' : 'negative');

export const sideLabel = (side: AutoTrade['side']): string => (side === 'BUY' ? 'Buy' : 'Sell');

/** The trade's own P&L once closed (its entry to its exit); null before that. */
export function closedPnl(trade: AutoTrade): number | null {
  if (trade.stage !== 'closed' || trade.entryPrice == null || trade.exitPrice == null) return null;
  return paperPnl({ side: trade.side, quantity: trade.quantity, entryPrice: trade.entryPrice }, trade.exitPrice);
}

type Detail = Record<string, unknown>;

const detailOf = (event: AutoTradeEvent | undefined): Detail =>
  (event?.detail && typeof event.detail === 'object' ? event.detail as Detail : {});

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const amount = (value: unknown): string | null => (typeof value === 'number' ? `₹${formatAmount(value)}` : null);

const strategyLabel = (id: unknown): string | null => STRATEGIES.find((s) => s.id === id)?.label ?? text(id);
const ruleLabel = (id: unknown): string | null => [...ENTRY_RULES, ...EXIT_RULES].find((r) => r.id === id)?.label ?? null;

/** The strategy that selected the trade, if recorded. */
export function tradeStrategy(trade: AutoTrade): string | null {
  return strategyLabel(detailOf(trade.events.find((e) => e.stage === 'selected')).strategyId);
}

/** The row's one-line reason: why it was rejected or closed, else why the strategy picked it. */
export function tradeReason(trade: AutoTrade): string {
  return trade.reason ?? text(detailOf(trade.events.find((e) => e.stage === 'selected')).reason) ?? '';
}

/** One lifecycle event as a plain sentence. */
export function eventSummary(event: AutoTradeEvent): string {
  const detail = detailOf(event);
  const joined = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ');
  switch (event.stage) {
    case 'selected':
      return joined(strategyLabel(detail.strategyId), text(detail.reason)) || 'Selected';
    case 'validated':
      return 'Passed the General settings and every active entry rule';
    case 'rejected':
      return joined(ruleLabel(detail.ruleId), text(detail.reason)) || 'Rejected';
    case 'executed':
      return amount(detail.entryPrice) ? `Opened a paper position at ${amount(detail.entryPrice)}` : 'Opened a paper position';
    case 'closed':
      // An exit rule's reason already names it ("Stop-loss hit: …").
      return joined(amount(detail.exitPrice) ? `Closed at ${amount(detail.exitPrice)}` : 'Closed', text(detail.reason));
    default:
      return '';
  }
}
