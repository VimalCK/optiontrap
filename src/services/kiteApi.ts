import { apiClient } from './apiClient';

export interface QuoteData {
  last_price: number; oi: number;
  ohlc: { open: number; high: number; low: number; close: number };
  volume: number; oi_day_high?: number; oi_day_low?: number;
}

export async function fetchQuotes(instruments: string[], signal?: AbortSignal): Promise<Map<string, QuoteData>> {
  const results = new Map<string, QuoteData>();
  for (let i = 0; i < instruments.length; i += 40) {
    const params = instruments.slice(i, i + 40).map((instrument) => `i=${encodeURIComponent(instrument)}`).join('&');
    try {
      const data = await apiClient.get<Record<string, QuoteData>>(`/api/quote?${params}`, { signal });
      for (const [key, value] of Object.entries(data || {})) {
        results.set(key, { ...value, last_price: value.last_price || 0, oi: value.oi || 0, volume: value.volume || 0, ohlc: value.ohlc || { open: 0, high: 0, low: 0, close: 0 } });
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(`[fetchQuotes] Batch ${i / 40 + 1} failed`, error);
    }
  }
  return results;
}

export interface Holding {
  tradingsymbol: string; exchange: string; instrument_token: number; isin: string; product: string;
  quantity: number; opening_quantity: number; t1_quantity: number; realised_quantity: number; used_quantity: number;
  average_price: number; last_price: number; close_price: number; pnl: number; day_change: number;
  day_change_percentage: number; collateral_quantity: number; collateral_type: string;
}
export function fetchHoldings(): Promise<Holding[]> { return apiClient.get('/api/portfolio/holdings'); }

export interface SegmentMargin {
  enabled: boolean; net: number;
  available: { cash: number; opening_balance: number; live_balance: number; collateral: number; intraday_payin: number; adhoc_margin: number };
  utilised: { debits: number; exposure: number; span: number; option_premium: number; holding_sales: number; m2m_realised: number; m2m_unrealised: number; delivery: number };
}
export interface Margins { equity: SegmentMargin; commodity: SegmentMargin }
export function fetchMargins(): Promise<Margins> { return apiClient.get('/api/user/margins'); }

export async function fetchPreviousDayOI(instrumentTokens: number[], onBatch?: (partial: Map<number, number>) => void, signal?: AbortSignal): Promise<Map<number, number>> {
  const results = new Map<number, number>();
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const today = new Date(ist.getFullYear(), ist.getMonth(), ist.getDate());
  const from = new Date(today); from.setDate(from.getDate() - 10);
  const date = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  for (let i = 0; i < instrumentTokens.length; i += 5) {
    if (signal?.aborted) break;
    await Promise.all(instrumentTokens.slice(i, i + 5).map(async (token) => {
      try {
        const result = await apiClient.get<{ candles?: unknown[][] }>(`/api/instruments/historical/${token}/day?from=${date(from)}&to=${date(today)}&oi=1`, { signal });
        const candles = result?.candles || [];
        const oi = candles.length >= 2 ? candles[candles.length - 2][6] : undefined;
        if (typeof oi === 'number' && oi > 0) results.set(token, oi);
      } catch (error) { if (!signal?.aborted) console.warn(`[fetchPreviousDayOI] Failed for ${token}`, error); }
    }));
    if (!signal?.aborted && onBatch && results.size > 0) onBatch(new Map(results));
    if (i + 5 < instrumentTokens.length) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return results;
}

export interface KitePosition {
  tradingsymbol: string; exchange: string; instrument_token: number; product: string; quantity: number; overnight_quantity: number;
  multiplier: number; average_price: number; close_price: number; last_price: number; value: number; pnl: number; m2m: number;
  unrealised: number; realised: number; buy_quantity: number; buy_price: number; buy_value: number; buy_m2m: number;
  sell_quantity: number; sell_price: number; sell_value: number; sell_m2m: number; day_buy_quantity: number; day_buy_price: number;
  day_buy_value: number; day_sell_quantity: number; day_sell_price: number; day_sell_value: number;
}
export interface KitePositions { net: KitePosition[]; day: KitePosition[] }
export function fetchPositions(): Promise<KitePositions> { return apiClient.get('/api/portfolio/positions'); }
