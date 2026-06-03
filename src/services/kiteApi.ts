import { getAuthHeader } from './kiteAuth';

const API_BASE = '/api';

interface RequestOptions {
  method?: string;
  body?: Record<string, string>;
}

async function kiteRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const authHeader = getAuthHeader();
  if (!authHeader) {
    throw new Error('Not authenticated. Please login first.');
  }

  const headers: Record<string, string> = {
    'X-Kite-Version': '3',
    'Authorization': authHeader,
  };

  const fetchOptions: RequestInit = {
    method: options.method || 'GET',
    headers,
  };

  if (options.body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    fetchOptions.body = new URLSearchParams(options.body);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, fetchOptions);

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const rawMessage = errorBody?.message || `API request failed (${response.status})`;

    // Translate auth errors to user-friendly messages
    if (response.status === 403 || rawMessage.toLowerCase().includes('api_key') || rawMessage.toLowerCase().includes('access_token')) {
      throw new Error('Session expired. Please login again from the Profile page.');
    }

    throw new Error(rawMessage);
  }

  const result = await response.json();
  return result.data;
}

/**
 * Fetch full quotes for multiple instruments (max 500 per call)
 * Returns a map of instrument identifier to quote data
 */
export interface QuoteData {
  last_price: number;
  oi: number;
  ohlc: { open: number; high: number; low: number; close: number };
  volume: number;
  oi_day_high?: number;
  oi_day_low?: number;
}

export async function fetchQuotes(instruments: string[]): Promise<Map<string, QuoteData>> {
  const authHeader = getAuthHeader();
  if (!authHeader) throw new Error('Not authenticated');

  const results = new Map<string, QuoteData>();

  // Kite /quote API accepts max 500 instruments, but URL length is the real
  // constraint. Each instrument like "NFO:NIFTY2560524500CE" is ~22 chars,
  // URL-encoded with "i=" prefix and "&" separator ≈ 30 chars each.
  // Keep batches small enough so the full URL stays well under 2048 chars.
  const batchSize = 40;

  for (let i = 0; i < instruments.length; i += batchSize) {
    const batch = instruments.slice(i, i + batchSize);
    const params = batch.map((inst) => `i=${encodeURIComponent(inst)}`).join('&');

    try {
      const response = await fetch(`/api/quote?${params}`, {
        headers: {
          'X-Kite-Version': '3',
          'Authorization': authHeader,
        },
      });

      if (!response.ok) {
        console.warn(`[fetchQuotes] Batch ${i / batchSize + 1} failed with status ${response.status}`);
        continue;
      }

      const result = await response.json();
      const data = result.data;
      if (data) {
        for (const [key, value] of Object.entries(data)) {
          const v = value as { last_price: number; oi: number; ohlc: { open: number; high: number; low: number; close: number }; volume: number; oi_day_high?: number; oi_day_low?: number };
          results.set(key, {
            last_price: v.last_price || 0,
            oi: v.oi || 0,
            ohlc: v.ohlc || { open: 0, high: 0, low: 0, close: 0 },
            volume: v.volume || 0,
            oi_day_high: v.oi_day_high,
            oi_day_low: v.oi_day_low,
          });
        }
      }
    } catch (err) {
      console.warn(`[fetchQuotes] Batch ${i / batchSize + 1} error:`, err);
    }
  }

  return results;
}

// Holdings
export interface Holding {
  tradingsymbol: string;
  exchange: string;
  instrument_token: number;
  isin: string;
  product: string;
  quantity: number;
  opening_quantity: number;
  t1_quantity: number;
  realised_quantity: number;
  used_quantity: number;
  average_price: number;
  last_price: number;
  close_price: number;
  pnl: number;
  day_change: number;
  day_change_percentage: number;
  collateral_quantity: number;
  collateral_type: string;
}

export function fetchHoldings(): Promise<Holding[]> {
  return kiteRequest<Holding[]>('/portfolio/holdings');
}

// Margins
export interface SegmentMargin {
  enabled: boolean;
  net: number;
  available: {
    cash: number;
    opening_balance: number;
    live_balance: number;
    collateral: number;
    intraday_payin: number;
    adhoc_margin: number;
  };
  utilised: {
    debits: number;
    exposure: number;
    span: number;
    option_premium: number;
    holding_sales: number;
    m2m_realised: number;
    m2m_unrealised: number;
    delivery: number;
  };
}

export interface Margins {
  equity: SegmentMargin;
  commodity: SegmentMargin;
}

export function fetchMargins(): Promise<Margins> {
  return kiteRequest<Margins>('/user/margins');
}

/**
 * Fetch previous trading day's closing OI for multiple instrument tokens
 * using the Historical Data API (day candle with oi=1).
 *
 * Returns a Map of instrumentToken -> previous day's closing OI.
 * We fetch day candles up to today and pick the SECOND-TO-LAST candle,
 * which represents the previous trading day's close OI.
 * (The last candle is today/most recent day — same as what /quote shows as current.)
 */
export async function fetchPreviousDayOI(instrumentTokens: number[]): Promise<Map<number, number>> {
  const authHeader = getAuthHeader();
  if (!authHeader) throw new Error('Not authenticated');

  const results = new Map<number, number>();

  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const today = new Date(ist.getFullYear(), ist.getMonth(), ist.getDate());

  // Fetch candles from 10 days back to today to ensure we get at least 2 trading days
  const from = new Date(today);
  from.setDate(from.getDate() - 10);

  const formatDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const fromStr = formatDate(from);
  const toStr = formatDate(today);

  // Fetch in parallel batches of 5 with delays to avoid rate limiting
  const batchSize = 5;
  for (let i = 0; i < instrumentTokens.length; i += batchSize) {
    const batch = instrumentTokens.slice(i, i + batchSize);
    const promises = batch.map(async (token) => {
      try {
        const url = `/api/instruments/historical/${token}/day?from=${fromStr}&to=${toStr}&oi=1`;
        const response = await fetch(url, {
          headers: {
            'X-Kite-Version': '3',
            'Authorization': authHeader,
          },
        });
        if (!response.ok) return;

        const result = await response.json();
        const candles = result?.data?.candles;
        if (candles && candles.length >= 2) {
          // Second-to-last candle = previous trading day's close OI
          const prevDayCandle = candles[candles.length - 2];
          const oi = prevDayCandle[6];
          if (oi !== undefined && oi > 0) {
            results.set(token, oi);
          }
        }
      } catch {
        // Skip failed fetches silently
      }
    });

    await Promise.all(promises);

    // Small delay between batches to avoid hitting rate limits
    if (i + batchSize < instrumentTokens.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return results;
}

// ── Positions ────────────────────────────────────────────────────────────────

export interface KitePosition {
  tradingsymbol: string;
  exchange: string;
  instrument_token: number;
  product: string;
  quantity: number;
  overnight_quantity: number;
  multiplier: number;
  average_price: number;
  close_price: number;
  last_price: number;
  value: number;
  pnl: number;
  m2m: number;
  unrealised: number;
  realised: number;
  buy_quantity: number;
  buy_price: number;
  buy_value: number;
  buy_m2m: number;
  sell_quantity: number;
  sell_price: number;
  sell_value: number;
  sell_m2m: number;
  day_buy_quantity: number;
  day_buy_price: number;
  day_buy_value: number;
  day_sell_quantity: number;
  day_sell_price: number;
  day_sell_value: number;
}

export interface KitePositions {
  net: KitePosition[];
  day: KitePosition[];
}

export function fetchPositions(): Promise<KitePositions> {
  return kiteRequest<KitePositions>('/portfolio/positions');
}
