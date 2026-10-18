/**
 * Watchlist API Client
 *
 * Thin wrappers over the /watchlist REST endpoints. All calls include
 * credentials (session cookie) and return typed data.
 *
 * GET /watchlist returns metadata only (no items) for fast tab rendering.
 * GET /watchlist/:id returns a single list with items — called on tab switch.
 */
import { apiClient } from './apiClient';

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

const request = <T>(url: string, options?: Parameters<typeof apiClient.get>[1]) => apiClient.get<T>(url, options);

/** Fetch all watchlists (metadata only — id, name, itemCount) */
export async function fetchWatchlists(): Promise<WatchlistMeta[]> {
  return request<WatchlistMeta[]>('/api/watchlist');
}

/** Fetch a single watchlist with all its items */
export async function fetchWatchlistItems(id: string): Promise<WatchlistFull> {
  return request<WatchlistFull>(`/api/watchlist/${id}`);
}

export async function createWatchlist(name: string): Promise<WatchlistMeta> {
  return apiClient.post<WatchlistMeta>('/api/watchlist', { name });
}

export async function renameWatchlist(id: string, name: string): Promise<void> {
  await apiClient.put(`/api/watchlist/${id}`, { name });
}

export async function deleteWatchlist(id: string): Promise<void> {
  await apiClient.delete(`/api/watchlist/${id}`);
}

export async function addWatchlistItem(
  watchlistId: string,
  item: { instrumentToken: number; tradingsymbol: string; exchange: string },
): Promise<WatchlistItem> {
  return apiClient.post<WatchlistItem>(`/api/watchlist/${watchlistId}/items`, item);
}

export async function removeWatchlistItem(
  watchlistId: string,
  itemId: string,
): Promise<void> {
  await apiClient.delete(`/api/watchlist/${watchlistId}/items/${itemId}`);
}
