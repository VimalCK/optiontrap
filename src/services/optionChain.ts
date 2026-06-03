import { getAuthHeader } from './kiteAuth';

const DB_NAME = 'optiontrap_instruments';
const DB_VERSION = 1;
const STORE_NAME = 'nfo_data';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getCachedCSV(): Promise<{ csv: string; date: string } | null> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get('nfo_instruments');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function setCachedCSV(csv: string, date: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ csv, date }, 'nfo_instruments');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getTodayIST(): string {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const year = ist.getFullYear();
  const month = String(ist.getMonth() + 1).padStart(2, '0');
  const day = String(ist.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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

/**
 * Fetch NFO instruments CSV — cached daily in IndexedDB
 */
export async function fetchNiftyOptions(): Promise<OptionInstrument[]> {
  const today = getTodayIST();

  // Check cache first
  const cached = await getCachedCSV();
  if (cached && cached.date === today) {
    console.log('[OptionChain] Using cached instruments from', cached.date);
    return parseNiftyOptions(cached.csv);
  }

  // Fetch fresh data
  const authHeader = getAuthHeader();
  if (!authHeader) throw new Error('Not authenticated');

  console.log('[OptionChain] Fetching fresh instruments data...');
  const response = await fetch('/api/instruments/NFO', {
    headers: {
      'X-Kite-Version': '3',
      'Authorization': authHeader,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error('[OptionChain] Fetch failed:', response.status, text.slice(0, 200));
    if (response.status === 403 || text.toLowerCase().includes('api_key') || text.toLowerCase().includes('access_token')) {
      throw new Error('Session expired. Please login again from the Profile page.');
    }
    throw new Error('Failed to fetch instruments');
  }

  const csv = await response.text();
  console.log('[OptionChain] CSV fetched, storing in cache...');

  // Store in IndexedDB for today
  await setCachedCSV(csv, today);

  const firstLines = csv.split('\n').slice(0, 3);
  console.log('[OptionChain] CSV header:', firstLines[0]);
  const result = parseNiftyOptions(csv);
  console.log('[OptionChain] Parsed NIFTY options:', result.length);
  if (result.length > 0) {
    console.log('[OptionChain] Sample option:', result[0]);
  }
  return result;
}

function parseNiftyOptions(csv: string): OptionInstrument[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const tokenIdx = headers.indexOf('instrument_token');
  const exchangeTokenIdx = headers.indexOf('exchange_token');
  const symbolIdx = headers.indexOf('tradingsymbol');
  const nameIdx = headers.indexOf('name');
  const expiryIdx = headers.indexOf('expiry');
  const strikeIdx = headers.indexOf('strike');
  const typeIdx = headers.indexOf('instrument_type');
  const lotIdx = headers.indexOf('lot_size');
  const lastPriceIdx = headers.indexOf('last_price');

  const options: OptionInstrument[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < headers.length) continue;

    const name = cols[nameIdx];
    const instrumentType = cols[typeIdx];

    if (name !== 'NIFTY') continue;
    if (instrumentType !== 'CE' && instrumentType !== 'PE') continue;

    options.push({
      instrumentToken: parseInt(cols[tokenIdx], 10),
      exchangeToken: parseInt(cols[exchangeTokenIdx], 10),
      tradingsymbol: cols[symbolIdx],
      name,
      expiry: cols[expiryIdx],
      strike: parseFloat(cols[strikeIdx]),
      instrumentType: instrumentType as 'CE' | 'PE',
      lotSize: parseInt(cols[lotIdx], 10),
      lastPrice: parseFloat(cols[lastPriceIdx]) || 0,
    });
  }

  return options;
}

/**
 * Parse a CSV line handling quoted fields
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
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
