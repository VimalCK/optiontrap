/**
 * The replay's rules as pure functions over a ReplayDay: which minute is shown, the ATM strike, the OI readings, and
 * how orders fill. An order placed during a minute fills at the next minute's open (shared/replay.js prices it);
 * an open position is closed at REPLAY_SQUARE_OFF_MINUTES's close, which ends the session.
 */
import { REPLAY_SQUARE_OFF_MINUTES, minutesOf, replayFillPrice, replayTradeResult } from '../../../shared/replay.js';
import { ReplayExitReason, type ReplayExitReasonId } from '../../../shared/appEnums.js';
import { OptionType, Side, type OptionTypeId } from '../../../shared/tradeEnums.js';
import { ReplayOrderKind } from '@/utils/uiEnums';
import type { OptionMinute, ReplayDay, ReplayTradeInput } from '@/services/replay';

/** Minutes the OI flow looks back over, and strikes each side of ATM it counts. */
export const OI_FLOW_MINUTES = 5;
export const OI_FLOW_STRIKES = 3;
const LAKH = 100_000;

export interface ReplayPosition {
  optionType: OptionTypeId;
  strike: number;
  tradingsymbol: string;
  lots: number;
  clickTime: string;
  entryTime: string;
  entryMinute: number;
  entryPrice: number;
  context: Record<string, unknown>;
}

interface PendingEntry {
  kind: typeof ReplayOrderKind.Entry;
  optionType: OptionTypeId;
  strike: number;
  lots: number;
  clickTime: string;
  clickMinute: number;
}

interface PendingExit {
  kind: typeof ReplayOrderKind.Exit;
}

export type PendingOrder = PendingEntry | PendingExit;

/** A closed trade, as sent to the server with the tags and note the player gave it. */
export type ClosedTrade = Omit<ReplayTradeInput, 'reasons' | 'note'>;

export interface ReplayState {
  /** The last minute shown; nothing after it is. */
  minute: number;
  position: ReplayPosition | null;
  pending: PendingOrder | null;
  /** Trades closed so far, in order. */
  closed: ClosedTrade[];
  finished: boolean;
}

/** The lots typed in the ticket as a whole number of 1 or more, or null when the entry isn't one. */
export function parseLots(text: string): number | null {
  const lots = Number(text);
  return text.trim() !== '' && Number.isInteger(lots) && lots >= 1 ? lots : null;
}

export const startState = (): ReplayState => ({ minute: 0, position: null, pending: null, closed: [], finished: false });

export const optionSeries = (day: ReplayDay, optionType: OptionTypeId, strike: number): OptionMinute[] | undefined =>
  (optionType === OptionType.CE ? day.calls : day.puts)[strike];

/** The strike nearest the index's close at `minute`. */
export function atmStrike(day: ReplayDay, minute: number): number {
  const price = day.index[minute][3];
  return day.strikes.reduce((best, strike) => (Math.abs(strike - price) < Math.abs(best - price) ? strike : best), day.strikes[0]);
}

/** ATM at `minute` and OI_FLOW_STRIKES strikes each side of it. */
function nearStrikes(day: ReplayDay, minute: number, width = OI_FLOW_STRIKES): number[] {
  const k = day.strikes.indexOf(atmStrike(day, minute));
  return day.strikes.slice(Math.max(0, k - width), k + width + 1);
}

const oiAt = (series: OptionMinute[] | undefined, minute: number) => series?.[minute]?.[3] ?? null;

/**
 * Put OI added minus call OI added near the money over the last OI_FLOW_MINUTES, as % of their OI: above 0 when
 * writers are selling puts (or calls are being bought back), below 0 the other way. Null before there is a window.
 */
export function oiFlow(day: ReplayDay, minute: number): number | null {
  if (minute < OI_FLOW_MINUTES) return null;
  let calls = 0, puts = 0, total = 0;
  for (const strike of nearStrikes(day, minute)) {
    for (const optionType of [OptionType.CE, OptionType.PE]) {
      const series = optionSeries(day, optionType, strike);
      const now = oiAt(series, minute), before = oiAt(series, minute - OI_FLOW_MINUTES);
      if (now == null || before == null) continue;
      if (optionType === OptionType.CE) calls += now - before; else puts += now - before;
      total += now;
    }
  }
  return total ? ((puts - calls) / total) * 100 : null;
}

/** Put OI minus call OI added near the money since each contract's first minute of the day, in lakh. */
export function oiSinceOpen(day: ReplayDay, minute: number): number {
  let net = 0;
  for (const strike of nearStrikes(day, minute)) {
    for (const optionType of [OptionType.CE, OptionType.PE]) {
      const series = optionSeries(day, optionType, strike);
      const now = oiAt(series, minute);
      const first = series?.find((m) => m)?.[3] ?? null;
      if (now == null || first == null) continue;
      net += (optionType === OptionType.PE ? 1 : -1) * (now - first);
    }
  }
  return net / LAKH;
}

/** What the market looked like at a minute, saved with a trade so its entries can be studied later. */
export function marketContext(day: ReplayDay, minute: number): Record<string, unknown> {
  const shown = day.index.slice(0, minute + 1);
  return {
    time: day.times[minute],
    index: day.index[minute][3],
    dayOpen: day.index[0][0],
    dayHigh: Math.max(...shown.map((m) => m[1])),
    dayLow: Math.min(...shown.map((m) => m[2])),
    prevClose: day.prevClose,
    oiFlow: oiFlow(day, minute),
    oiSinceOpen: oiSinceOpen(day, minute),
  };
}

/** Whether a new position can be bought now: the session runs, nothing is held or waiting, and the minute has a price. */
export function canBuy(day: ReplayDay, state: ReplayState, optionType: OptionTypeId): boolean {
  if (state.finished || state.position || state.pending || state.minute + 1 >= day.times.length) return false;
  return Boolean(optionSeries(day, optionType, atmStrike(day, state.minute))?.[state.minute]);
}

/** Places a buy of the ATM option; it fills at the next minute's open when the replay advances. */
export function placeEntry(day: ReplayDay, state: ReplayState, optionType: OptionTypeId, lots: number): ReplayState {
  if (!canBuy(day, state, optionType)) return state;
  const pending: PendingEntry = {
    kind: ReplayOrderKind.Entry, optionType, strike: atmStrike(day, state.minute), lots, clickTime: day.times[state.minute], clickMinute: state.minute,
  };
  return { ...state, pending };
}

/** Places a sell of the position held; it fills at the next minute's open when the replay advances. */
export function placeExit(state: ReplayState): ReplayState {
  if (!state.position || state.pending || state.finished) return state;
  return { ...state, pending: { kind: ReplayOrderKind.Exit } };
}

function closedTrade(day: ReplayDay, position: ReplayPosition, minute: number, price: number, exitReason: ReplayExitReasonId): ClosedTrade {
  return {
    optionType: position.optionType,
    strike: position.strike,
    tradingsymbol: position.tradingsymbol,
    lots: position.lots,
    clickTime: position.clickTime,
    entryTime: position.entryTime,
    exitTime: day.times[minute],
    entryPrice: position.entryPrice,
    exitPrice: replayFillPrice(price, Side.SELL),
    exitReason,
    context: position.context,
  };
}

function fillPending(day: ReplayDay, state: ReplayState): ReplayState {
  const { pending, minute } = state;
  if (!pending) return state;
  if (pending.kind === ReplayOrderKind.Exit && state.position) {
    const open = optionSeries(day, state.position.optionType, state.position.strike)?.[minute]?.[0];
    if (open == null) return state;
    return { ...state, pending: null, position: null, closed: [...state.closed, closedTrade(day, state.position, minute, open, ReplayExitReason.Manual)] };
  }
  if (pending.kind !== ReplayOrderKind.Entry) return { ...state, pending: null };
  const open = optionSeries(day, pending.optionType, pending.strike)?.[minute]?.[0];
  if (open == null) return { ...state, pending: null };
  const position: ReplayPosition = {
    optionType: pending.optionType,
    strike: pending.strike,
    tradingsymbol: day.symbols[pending.strike][pending.optionType],
    lots: pending.lots,
    clickTime: pending.clickTime,
    entryTime: day.times[minute],
    entryMinute: minute,
    entryPrice: replayFillPrice(open, Side.BUY),
    context: marketContext(day, pending.clickMinute),
  };
  return { ...state, pending: null, position };
}

/**
 * Shows the next minute: fills a waiting order at its open, then at the square-off minute closes the position at its
 * close and ends the session. The session also ends after the day's last minute.
 */
export function advance(day: ReplayDay, state: ReplayState): ReplayState {
  if (state.finished) return state;
  // Kite's candles can end before the square-off time (a stock's on some days stop at 15:14): the session ends there.
  if (state.minute + 1 >= day.times.length) return endSession(day, state);
  const next = fillPending(day, { ...state, minute: state.minute + 1 });
  if (minutesOf(day.times[next.minute]) < REPLAY_SQUARE_OFF_MINUTES) return next;
  return endSession(day, next);
}

/** The session over at the shown minute: an open position squared off at its close. */
function endSession(day: ReplayDay, state: ReplayState): ReplayState {
  if (!state.position) return { ...state, pending: null, finished: true };
  const close = optionSeries(day, state.position.optionType, state.position.strike)?.[state.minute]?.[1] ?? state.position.entryPrice;
  return {
    ...state, pending: null, position: null, finished: true,
    closed: [...state.closed, closedTrade(day, state.position, state.minute, close, ReplayExitReason.SquareOff)],
  };
}

/** The held position at the shown minute: its last price, and what selling it now would make after charges. */
export function positionValue(day: ReplayDay, position: ReplayPosition, minute: number) {
  const last = optionSeries(day, position.optionType, position.strike)?.[minute]?.[1] ?? position.entryPrice;
  const exitPrice = replayFillPrice(last, Side.SELL);
  const result = replayTradeResult({
    date: day.date, entryTime: position.entryTime, exitTime: day.times[minute], entryPrice: position.entryPrice, exitPrice,
    quantity: position.lots * day.lotSize,
  });
  return { last, ...result, heldMinutes: minute - position.entryMinute };
}

