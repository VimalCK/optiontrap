export interface OptionInstrument {
  instrumentToken: number;
  exchangeToken: number;
  tradingsymbol: string;
  name: string;
  expiry: string;
  strike: number;
  instrumentType: 'CE' | 'PE';
  lotSize: number;
  lastPrice: number;
}

export interface OptionChainRow {
  strike: number;
  ce: OptionInstrument | null;
  pe: OptionInstrument | null;
}

/** In-memory cache of all instruments to avoid re-fetching */
let instrumentsCache: any[] | null = null;

/**
 * Fetch options for a given symbol from the server's shared instrument cache.
 * The server fetches from Kite once per day and caches in SQLite.
 */
export async function fetchOptions(symbol: string): Promise<OptionInstrument[]> {
  if (!instrumentsCache) {
    const response = await fetch('/instruments', {
      credentials: 'include',
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (response.status === 403 || text.toLowerCase().includes('api_key') || text.toLowerCase().includes('access_token')) {
        throw new Error('Session expired. Please login again from the Profile page.');
      }
      throw new Error('Failed to fetch instruments');
    }

    const json = await response.json();
    instrumentsCache = json.data || [];
  }

  // Filter for the given symbol's CE/PE options
  return instrumentsCache!
    .filter((i: any) => i.exchange === 'NFO' && i.name === symbol && (i.instrumentType === 'CE' || i.instrumentType === 'PE'))
    .map((i: any) => ({
      instrumentToken: i.instrumentToken,
      exchangeToken: i.exchangeToken,
      tradingsymbol: i.tradingsymbol,
      name: i.name,
      expiry: i.expiry,
      strike: i.strike,
      instrumentType: i.instrumentType as 'CE' | 'PE',
      lotSize: i.lotSize || 0,
      lastPrice: i.lastPrice || 0,
    }));
}

/**
 * Look up the spot token for a symbol from the instruments cache.
 * For indices, returns known tokens. For stocks, finds the NSE EQ instrument.
 */
export function getSpotToken(symbol: string): number | null {
  const INDEX_TOKENS: Record<string, number> = {
    NIFTY: 256265,
    BANKNIFTY: 260105,
  };

  if (INDEX_TOKENS[symbol]) return INDEX_TOKENS[symbol];

  if (!instrumentsCache) return null;
  const eq = instrumentsCache.find(
    (i: any) => i.exchange === 'NSE' && i.instrumentType === 'EQ' && i.tradingsymbol === symbol,
  );
  return eq ? eq.instrumentToken : null;
}

/**
 * Fetch the list of available F&O symbols.
 */
export async function fetchFnoSymbols(): Promise<string[]> {
  try {
    const res = await fetch('/api/fno-symbols', { credentials: 'include' });
    const json = await res.json();
    if (json.status === 'ok' && json.data?.length > 0) {
      return json.data;
    }
  } catch { /* fallback */ }
  return ['NIFTY', 'BANKNIFTY'];
}

/**
 * Get unique expiry dates sorted ascending
 */
export function getExpiries(options: OptionInstrument[]): string[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiries = [...new Set(options.map((o) => o.expiry))];
  return expiries
    .filter((exp) => new Date(exp).getTime() >= today.getTime())
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
}

/**
 * Build option chain rows for a given expiry
 */
export function buildOptionChain(options: OptionInstrument[], expiry: string): OptionChainRow[] {
  const filtered = options.filter((o) => o.expiry === expiry);
  const strikeMap = new Map<number, { ce: OptionInstrument | null; pe: OptionInstrument | null }>();

  for (const opt of filtered) {
    if (!strikeMap.has(opt.strike)) {
      strikeMap.set(opt.strike, { ce: null, pe: null });
    }
    const row = strikeMap.get(opt.strike)!;
    if (opt.instrumentType === 'CE') row.ce = opt;
    else row.pe = opt;
  }

  return Array.from(strikeMap.entries())
    .map(([strike, { ce, pe }]) => ({ strike, ce, pe }))
    .sort((a, b) => a.strike - b.strike);
}
