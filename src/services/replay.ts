/**
 * Replay API client: a past day's minute candles (fetched from Kite by the server when opened), the user's replay
 * sessions and trades, and the results of their first-playthrough trades.
 */
import { apiClient } from './apiClient';
import { ReplaySessionStatus, type ReplayExitReasonId, type ReplayReasonId, type ReplaySessionStatusId } from '../../shared/appEnums.js';
import type { OptionTypeId } from '../../shared/tradeEnums.js';

/** A contract's minute: [open, close, volume, oi]; null before its first trade. */
export type OptionMinute = [number, number, number, number] | null;
/** An index minute: [open, high, low, close]. */
export type IndexMinute = [number, number, number, number];

export interface ReplayDay {
  underlying: string;
  label: string;
  date: string;
  expiry: string;
  lotSize: number;
  prevClose: number | null;
  /** The previous session's high, low and close (for the CPR and pivot levels), when Kite had it. */
  prevDay: { high: number; low: number; close: number } | null;
  /** 'HH:MM' IST, one per minute the index traded. */
  times: string[];
  index: IndexMinute[];
  strikes: number[];
  calls: Record<string, OptionMinute[]>;
  puts: Record<string, OptionMinute[]>;
  symbols: Record<string, { CE: string; PE: string }>;
}

export interface ReplaySession {
  id: string;
  underlying: string;
  date: string;
  expiry: string;
  lotSize: number;
  attempt: number;
  status: ReplaySessionStatusId;
  startedAt: string;
  finishedAt: string | null;
  tradeCount: number;
  net: number;
}

/** What the browser sends for a closed trade; the server works out its quantity, points, charges and net. */
export interface ReplayTradeInput {
  optionType: OptionTypeId;
  strike: number;
  tradingsymbol: string;
  lots: number;
  clickTime: string;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  exitReason: ReplayExitReasonId;
  reasons: ReplayReasonId[];
  note: string | null;
  context: Record<string, unknown> | null;
}

export interface ReplayTrade extends Omit<ReplayTradeInput, 'context'> {
  id: string;
  sessionId: string;
  quantity: number;
  points: number;
  charges: number;
  net: number;
}

export interface ReplayGroup {
  /** The reason, hour ('09'…'15') or option type; null for trades without a reason. */
  key: string | null;
  trades: number;
  wins: number;
  net: number;
  averageNet: number;
}

export interface ReplayStats {
  trades: number;
  wins: number;
  net: number;
  averageNet: number;
  charges: number;
  sessions: number;
  averageHoldMinutes: number;
  byReason: ReplayGroup[];
  byHour: ReplayGroup[];
  byOptionType: ReplayGroup[];
}

export interface ReplayRange {
  from: string;
  to: string;
  /** One underlying, or every one when left out. */
  underlying?: string;
}

const rangeQuery = ({ from, to, underlying }: ReplayRange) =>
  new URLSearchParams({ from, to, ...(underlying ? { underlying } : {}) }).toString();

export async function fetchReplayDay(underlying: string, date: string, signal?: AbortSignal): Promise<ReplayDay> {
  return apiClient.get<ReplayDay>(`/api/replay-days/${date}?${new URLSearchParams({ underlying })}`, { signal });
}

export async function fetchReplaySessions(range: ReplayRange, signal?: AbortSignal): Promise<ReplaySession[]> {
  return apiClient.get<ReplaySession[]>(`/api/replay-sessions?${rangeQuery(range)}`, { signal });
}

export async function startReplaySession(day: ReplayDay): Promise<ReplaySession> {
  return apiClient.post<ReplaySession>('/api/replay-sessions', { underlying: day.underlying, date: day.date, expiry: day.expiry, lotSize: day.lotSize });
}

export async function finishReplaySession(id: string): Promise<ReplaySession> {
  return apiClient.patch<ReplaySession>(`/api/replay-sessions/${id}`, { status: ReplaySessionStatus.Finished });
}

export async function saveReplayTrade(sessionId: string, trade: ReplayTradeInput): Promise<ReplayTrade> {
  return apiClient.post<ReplayTrade>(`/api/replay-sessions/${sessionId}/trades`, trade);
}

export async function fetchReplayStats(range: ReplayRange, signal?: AbortSignal): Promise<ReplayStats> {
  return apiClient.get<ReplayStats>(`/api/replay-stats?${rangeQuery(range)}`, { signal });
}
