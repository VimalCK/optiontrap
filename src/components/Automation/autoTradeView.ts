import { LIFECYCLE_STAGES } from '../../../shared/automation.js';
import { marketDate } from '../../../shared/marketTime.js';
import { tradePnl } from '../../../shared/tradePnl.js';
import { Tone, type ToneId } from '@/utils/uiEnums';
import type { AutoTrade, AutoTradeEvent } from '@/services/automation';
import type { StrategyInfo } from '@/services/strategies';
import { formatAmount } from '@/utils/formatAmount';
import { LifecycleStage, Side } from '../../../shared/tradeEnums.js';

type Stage = AutoTrade['stage'];

const STAGE_TONES: Record<Stage, ToneId> = {
  [LifecycleStage.Selected]: Tone.Neutral,
  [LifecycleStage.Validated]: Tone.Accent,
  [LifecycleStage.Executed]: Tone.Accent,
  [LifecycleStage.Rejected]: Tone.Negative,
  [LifecycleStage.Closed]: Tone.Neutral,
};

export const stageTone = (stage: Stage): ToneId => STAGE_TONES[stage];

export const stepTone = (stage: Stage): ToneId => (stage === LifecycleStage.Rejected ? Tone.Negative : Tone.Positive);

/** An open position (executed, not yet closed) shows a live dot. */
export const stageIsLive = (stage: Stage): boolean => stage === LifecycleStage.Executed;

export const stageLabel = (stage: string): string => LIFECYCLE_STAGES.find((s) => s.id === stage)?.label ?? stage;

export { horizonLabel } from '../../../shared/tradeEnums.js';

export const sideTone = (side: AutoTrade['side']): ToneId => (side === Side.BUY ? Tone.Positive : Tone.Negative);

export { sideLabel } from '../../../shared/tradeEnums.js';

/** P&L after charges, once closed; null before that. */
export function closedPnl(trade: AutoTrade): number | null {
  if (trade.stage !== LifecycleStage.Closed || trade.entryPrice == null || trade.exitPrice == null) return null;
  return tradePnl({ side: trade.side, quantity: trade.quantity, entryPrice: trade.entryPrice }, trade.exitPrice) - (trade.charges ?? 0);
}

export interface TradeDay {
  /** YYYY-MM-DD, IST. */
  day: string;
  trades: AutoTrade[];
  /** The day's closed trades' P&L after charges; null while none has closed. */
  pnl: number | null;
}

/** Groups by the IST day created, keeping the server's order (newest first). */
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

export const strategyLabel = (id: unknown, strategies: StrategyInfo[]): string | null => strategies.find((s) => s.id === id)?.label ?? text(id);

export function eventSummary(event: AutoTradeEvent, strategies: StrategyInfo[]): string {
  const detail = detailOf(event);
  const joined = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ');
  switch (event.stage) {
    case LifecycleStage.Selected:
      return joined(strategyLabel(detail.strategyId, strategies), text(detail.reason)) || 'Selected';
    case LifecycleStage.Validated:
      return 'Passed the General settings and every active entry rule';
    case LifecycleStage.Rejected:
      return text(detail.reason) ?? 'Rejected';
    case LifecycleStage.Executed:
      return amount(detail.entryPrice) ? `Opened a paper position at ${amount(detail.entryPrice)}` : 'Opened a paper position';
    case LifecycleStage.Closed:
      // An exit rule's reason already names it ("Stop-loss hit: …").
      return joined(amount(detail.exitPrice) ? `Closed at ${amount(detail.exitPrice)}` : 'Closed', text(detail.reason));
    default:
      return '';
  }
}
