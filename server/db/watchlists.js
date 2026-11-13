import crypto from 'crypto';
import { Exchange } from '../../shared/tradeEnums.js';
import { firstRow, query, rows } from './pool.js';

export async function createWatchlist(userId, name) {
  const id = crypto.randomUUID();

  const maxRow = await firstRow(
    'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM watchlists WHERE user_id = $1',
    [userId],
  );
  const sortOrder = (maxRow?.max_order ?? -1) + 1;

  await query(
    'INSERT INTO watchlists (id, user_id, name, sort_order) VALUES ($1, $2, $3, $4)',
    [id, userId, name.trim(), sortOrder],
  );

  return { id, name: name.trim(), sortOrder, itemCount: 0 };
}

export async function getWatchlists(userId) {
  const result = await rows(
    `SELECT w.id, w.name, w.sort_order,
            (SELECT COUNT(*) FROM watchlist_items wi WHERE wi.watchlist_id = w.id) AS item_count
     FROM watchlists w
     WHERE w.user_id = $1
     ORDER BY w.sort_order`,
    [userId],
  );

  return result.map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: Number(row.sort_order),
    itemCount: Number(row.item_count),
  }));
}

export async function getWatchlistItems(id, userId) {
  const listRow = await firstRow(
    'SELECT id, name, sort_order FROM watchlists WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  if (!listRow) return null;

  const items = await rows(
    `SELECT id, instrument_token, tradingsymbol, exchange, sort_order
     FROM watchlist_items
     WHERE watchlist_id = $1
     ORDER BY sort_order`,
    [id],
  );

  return {
    id: listRow.id,
    name: listRow.name,
    sortOrder: Number(listRow.sort_order),
    items: items.map((row) => ({
      id: row.id,
      instrumentToken: Number(row.instrument_token),
      tradingsymbol: row.tradingsymbol,
      exchange: row.exchange,
      sortOrder: Number(row.sort_order),
    })),
  };
}

export async function renameWatchlist(id, userId, name) {
  const res = await query(
    'UPDATE watchlists SET name = $1 WHERE id = $2 AND user_id = $3',
    [name.trim(), id, userId],
  );
  return res.rowCount > 0;
}

export async function deleteWatchlist(id, userId) {
  const owner = await firstRow('SELECT id FROM watchlists WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!owner) return false;

  await query('DELETE FROM watchlist_items WHERE watchlist_id = $1', [id]);
  await query('DELETE FROM watchlists WHERE id = $1', [id]);
  return true;
}

export async function addWatchlistItem(watchlistId, userId, { instrumentToken, tradingsymbol, exchange }) {
  const owner = await firstRow('SELECT id FROM watchlists WHERE id = $1 AND user_id = $2', [watchlistId, userId]);
  if (!owner) return null;

  const countRow = await firstRow('SELECT COUNT(*) AS c FROM watchlist_items WHERE watchlist_id = $1', [watchlistId]);
  const count = Number(countRow?.c ?? 0);
  if (count >= 100) return null;

  const dup = await firstRow(
    'SELECT id FROM watchlist_items WHERE watchlist_id = $1 AND instrument_token = $2',
    [watchlistId, instrumentToken],
  );
  if (dup) return null;

  const id = crypto.randomUUID();
  // After the last item; the count can collide with an existing position once items are removed or moved.
  const lastRow = await firstRow('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM watchlist_items WHERE watchlist_id = $1', [watchlistId]);
  const sortOrder = Number(lastRow.max_order) + 1;

  await query(
    `INSERT INTO watchlist_items (id, watchlist_id, instrument_token, tradingsymbol, exchange, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, watchlistId, instrumentToken, tradingsymbol, exchange || Exchange.NSE, sortOrder],
  );

  return { id, instrumentToken, tradingsymbol, exchange: exchange || Exchange.NSE, sortOrder };
}

/** `itemIds` must list every item exactly once; false otherwise, or when the list isn't the user's. */
export async function reorderWatchlistItems(watchlistId, userId, itemIds) {
  const owner = await firstRow('SELECT id FROM watchlists WHERE id = $1 AND user_id = $2', [watchlistId, userId]);
  if (!owner) return false;

  const current = await rows('SELECT id FROM watchlist_items WHERE watchlist_id = $1', [watchlistId]);
  const ids = new Set(current.map((r) => r.id));
  if (itemIds.length !== ids.size || new Set(itemIds).size !== ids.size || !itemIds.every((id) => ids.has(id))) return false;

  await query(
    `UPDATE watchlist_items wi SET sort_order = o.position - 1
     FROM unnest($2::text[]) WITH ORDINALITY AS o(id, position)
     WHERE wi.id = o.id AND wi.watchlist_id = $1`,
    [watchlistId, itemIds],
  );
  return true;
}

export async function removeWatchlistItem(itemId, userId) {
  const exists = await firstRow(
    `SELECT wi.id FROM watchlist_items wi
     JOIN watchlists w ON wi.watchlist_id = w.id
     WHERE wi.id = $1 AND w.user_id = $2`,
    [itemId, userId],
  );
  if (!exists) return false;

  await query('DELETE FROM watchlist_items WHERE id = $1', [itemId]);
  return true;
}
