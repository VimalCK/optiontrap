/**
 * Thin wrappers over /api/watchlists. GET /api/watchlists returns metadata only
 * (no items) so tabs render fast; a tab's items come from GET /api/watchlists/:id on switch.
 */
import { apiClient } from './apiClient';

export interface WatchlistItem {
  id: string;
  instrumentToken: number;
  tradingsymbol: string;
  exchange: string;
  sortOrder: number;
}

/** Metadata returned by GET /api/watchlists (no items) */
export interface WatchlistMeta {
  id: string;
  name: string;
  sortOrder: number;
  itemCount: number;
}

/** Full watchlist with items, returned by GET /api/watchlists/:id */
export interface WatchlistFull {
  id: string;
  name: string;
  sortOrder: number;
  items: WatchlistItem[];
}

const request = <T>(url: string, options?: Parameters<typeof apiClient.get>[1]) => apiClient.get<T>(url, options);

export async function fetchWatchlists(): Promise<WatchlistMeta[]> {
  return request<WatchlistMeta[]>('/api/watchlists');
}

export async function fetchWatchlistItems(id: string): Promise<WatchlistFull> {
  return request<WatchlistFull>(`/api/watchlists/${id}`);
}

export async function createWatchlist(name: string): Promise<WatchlistMeta> {
  return apiClient.post<WatchlistMeta>('/api/watchlists', { name });
}

export async function renameWatchlist(id: string, name: string): Promise<void> {
  await apiClient.patch(`/api/watchlists/${id}`, { name });
}

export async function deleteWatchlist(id: string): Promise<void> {
  await apiClient.delete(`/api/watchlists/${id}`);
}

export async function addWatchlistItem(
  watchlistId: string,
  item: { instrumentToken: number; tradingsymbol: string; exchange: string },
): Promise<WatchlistItem> {
  return apiClient.post<WatchlistItem>(`/api/watchlists/${watchlistId}/items`, item);
}

/** Save the order of a watchlist's items: every item id, top to bottom. */
export async function reorderWatchlistItems(watchlistId: string, itemIds: string[]): Promise<void> {
  await apiClient.put(`/api/watchlists/${watchlistId}/items/order`, { itemIds });
}

export async function removeWatchlistItem(
  watchlistId: string,
  itemId: string,
): Promise<void> {
  await apiClient.delete(`/api/watchlists/${watchlistId}/items/${itemId}`);
}
