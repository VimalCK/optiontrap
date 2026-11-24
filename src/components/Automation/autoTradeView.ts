import { LIFECYCLE_STAGES } from '../../../shared/automation.js';
import { tradePnl, tradePnlPercent } from '../../../shared/tradePnl.js';
import { Tone, type ToneId } from '@/utils/uiEnums';
import type { AutoTrade, AutoTradeEvent } from '@/services/automation';
import type { PaperOrder } from '@/services/orders';
import type { StrategyInfo } from '@/services/strategies';
import { formatAmount } from '@/utils/formatAmount';
import { groupByMarketDay } from '@/utils/groupByMarketDay';
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

/** P&L at the fills, before charges (the Journal shows them), once closed; null before that. */
export function closedPnl(trade: AutoTrade): number | null {
  if (trade.stage !== LifecycleStage.Closed || trade.entryPrice == null || trade.exitPrice == null) return null;
  return tradePnl({ side: trade.side, quantity: trade.quantity, entryPrice: trade.entryPrice }, trade.exitPrice);
}

export interface TradeDay {
  /** YYYY-MM-DD, IST. */
  day: string;
  trades: AutoTrade[];
  /** The day's closed trades' P&L before charges; null while none has closed. */
  pnl: number | null;
}

/** The open entry orders of automated trades waiting to execute, by trade id: the ones Algo Trading can modify. */
export function waitingOrdersByTrade(openOrders: PaperOrder[]): Map<string, PaperOrder> {
  return new Map(openOrders.flatMap((order) => (order.autoTradeId ? [[order.autoTradeId, order] as const] : [])));
}

/** Groups by the IST day created, keeping the server's order (newest first). */
export function tradesByDay(trades: AutoTrade[]): TradeDay[] {
  return groupByMarketDay(trades, (trade) => trade.createdAt).map(({ day, items }) => {
    const closed = items.map(closedPnl).filter((pnl): pnl is number => pnl !== null);
    return { day, trades: items, pnl: closed.length === 0 ? null : closed.reduce((sum, pnl) => sum + pnl, 0) };
  });
}

type Detail = Record<string, unknown>;

const detailOf = (event: AutoTradeEvent | undefined): Detail =>
  (event?.detail && typeof event.detail === 'object' ? event.detail as Detail : {});

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const amount = (value: unknown): string | null => (typeof value === 'number' ? `₹${formatAmount(value)}` : null);

export const strategyLabel = (id: unknown, strategies: StrategyInfo[]): string | null => strategies.find((s) => s.id === id)?.label ?? text(id);

/** P&L at the exit fill, which can be past the exit rule's trigger: the rule checks the last price, the exit fills at the bid / ask. */
function exitPnl(trade: AutoTrade, exitPrice: unknown): string | null {
  if (trade.entryPrice == null || typeof exitPrice !== 'number') return null;
  const entry = { side: trade.side, quantity: trade.quantity, entryPrice: trade.entryPrice };
  return `P&L ${amount(tradePnl(entry, exitPrice))} (${tradePnlPercent(entry, exitPrice).toFixed(2)}%)`;
}

export function eventSummary(event: AutoTradeEvent, trade: AutoTrade, strategies: StrategyInfo[]): string {
  const detail = detailOf(event);
  const joined = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ');
  switch (event.stage) {
    case LifecycleStage.Selected:
      return joined(strategyLabel(detail.strategyId, strategies), text(detail.reason)) || 'Selected';
    case LifecycleStage.Validated:
      return "Passed the strategy's settings and every active entry rule";
    case LifecycleStage.Rejected:
      return text(detail.reason) ?? 'Rejected';
    case LifecycleStage.Executed:
      return amount(detail.entryPrice) ? `Opened a paper position at ${amount(detail.entryPrice)}` : 'Opened a paper position';
    case LifecycleStage.Closed:
      return joined(amount(detail.exitPrice) ? `Closed at ${amount(detail.exitPrice)}` : 'Closed', exitPnl(trade, detail.exitPrice), text(detail.reason));
    default:
      return '';
  }
}
