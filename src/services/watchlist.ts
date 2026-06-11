/**
 * Watchlist API Client
 *
 * Thin wrappers over the /watchlist REST endpoints. All calls include
 * credentials (session cookie) and return typed data.
 */

export interface WatchlistItem {
  id: string;
  instrumentToken: number;
  tradingsymbol: string;
  exchange: string;
  sortOrder: number;
}

export interface Watchlist {
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

export async function fetchWatchlists(): Promise<Watchlist[]> {
  return request<Watchlist[]>('/watchlist');
}

export async function createWatchlist(name: string): Promise<Watchlist> {
  return request<Watchlist>('/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function renameWatchlist(id: string, name: string): Promise<void> {
  await request<void>(`/watchlist/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function deleteWatchlist(id: string): Promise<void> {
  await request<void>(`/watchlist/${id}`, { method: 'DELETE' });
}

export async function addWatchlistItem(
  watchlistId: string,
  item: { instrumentToken: number; tradingsymbol: string; exchange: string },
): Promise<WatchlistItem> {
  return request<WatchlistItem>(`/watchlist/${watchlistId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
}

export async function removeWatchlistItem(
  watchlistId: string,
  itemId: string,
): Promise<void> {
  await request<void>(`/watchlist/${watchlistId}/items/${itemId}`, {
    method: 'DELETE',
  });
}
