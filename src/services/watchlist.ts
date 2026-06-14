/**
 * Watchlist API Client
 *
 * Thin wrappers over the /watchlist REST endpoints. All calls include
 * credentials (session cookie) and return typed data.
 *
 * GET /watchlist returns metadata only (no items) for fast tab rendering.
 * GET /watchlist/:id returns a single list with items — called on tab switch.
 */

export interface WatchlistItem {
  id: string;
  instrumentToken: number;
  tradingsymbol: string;
  exchange: string;
  sortOrder: number;
}

/** Metadata returned by GET /watchlist (no items) */
export interface WatchlistMeta {
  id: string;
  name: string;
  sortOrder: number;
  itemCount: number;
}

/** Full watchlist with items, returned by GET /watchlist/:id */
export interface WatchlistFull {
  id: string;
  name: string;
  sortOrder: number;
  items: WatchlistItem[];
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...options });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `Request failed (${res.status})`);
  }

  const json = await res.json();
  return json.data as T;
}

/** Fetch all watchlists (metadata only — id, name, itemCount) */
export async function fetchWatchlists(): Promise<WatchlistMeta[]> {
  return request<WatchlistMeta[]>('/api/watchlist');
}

/** Fetch a single watchlist with all its items */
export async function fetchWatchlistItems(id: string): Promise<WatchlistFull> {
  return request<WatchlistFull>(`/api/watchlist/${id}`);
}

export async function createWatchlist(name: string): Promise<WatchlistMeta> {
  return request<WatchlistMeta>('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function renameWatchlist(id: string, name: string): Promise<void> {
  await request<void>(`/api/watchlist/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function deleteWatchlist(id: string): Promise<void> {
  await request<void>(`/api/watchlist/${id}`, { method: 'DELETE' });
}

export async function addWatchlistItem(
  watchlistId: string,
  item: { instrumentToken: number; tradingsymbol: string; exchange: string },
): Promise<WatchlistItem> {
  return request<WatchlistItem>(`/api/watchlist/${watchlistId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
}

export async function removeWatchlistItem(
  watchlistId: string,
  itemId: string,
): Promise<void> {
  await request<void>(`/api/watchlist/${watchlistId}/items/${itemId}`, {
    method: 'DELETE',
  });
}
