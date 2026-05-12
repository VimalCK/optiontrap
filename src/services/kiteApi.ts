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

// Holdings
export interface Holding {
  tradingsymbol: string;
  exchange: string;
  instrument_token: number;
  isin: string;
  product: string;
  quantity: number;
  t1_quantity: number;
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
