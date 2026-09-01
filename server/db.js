/**
 * SQLite Database Manager
 *
 * Manages persistent storage for OptionTrap using sql.js (pure-JS SQLite).
 * The database lives at server/data/optiontrap.db and is auto-created on
 * first run.
 *
 * Currently handles:
 *   - users: lightweight user registry (user_id + user_name from Kite OAuth)
 *   - sessions: express-session data persisted across server restarts
 *
 * Credentials (apiKey + apiSecret) are stored ONLY in the client browser's
 * localStorage. The server never persists them — they are sent per-request
 * during OAuth token exchange and immediately discarded.
 */

import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'optiontrap.db');

// ---------------------------------------------------------------------------
// Database lifecycle
// ---------------------------------------------------------------------------

/** @type {import('sql.js').Database | null} */
let db = null;

/**
 * Initialise the database. Must be called (and awaited) before any other
 * db.js export. Safe to call multiple times — returns immediately after
 * the first successful init.
 */
export async function initDb() {
  if (db) return;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id    TEXT PRIMARY KEY,
      user_name  TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migrate from old user_credentials table if it exists
  try {
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='user_credentials'");
    if (tables.length && tables[0].values.length) {
      // Copy user identity rows (skip credentials)
      db.run(`
        INSERT OR IGNORE INTO users (user_id, user_name, updated_at)
        SELECT user_id, user_name, updated_at FROM user_credentials WHERE user_id IS NOT NULL
      `);
      db.run('DROP TABLE user_credentials');
      console.log('[DB] Migrated user_credentials → users (credentials removed from server)');
    }
  } catch (err) {
    console.warn('[DB] user_credentials migration warning:', err.message);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid     TEXT PRIMARY KEY,
      data    TEXT NOT NULL,
      expires INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS watchlists (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS watchlist_items (
      id               TEXT PRIMARY KEY,
      watchlist_id     TEXT NOT NULL,
      instrument_token INTEGER NOT NULL,
      tradingsymbol    TEXT NOT NULL,
      exchange         TEXT NOT NULL DEFAULT 'NSE',
      sort_order       INTEGER NOT NULL DEFAULT 0,
      added_at         TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (watchlist_id) REFERENCES watchlists(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS instruments (
      instrument_token INTEGER PRIMARY KEY,
      exchange_token   INTEGER NOT NULL,
      tradingsymbol    TEXT NOT NULL,
      name             TEXT NOT NULL,
      exchange         TEXT NOT NULL DEFAULT 'NSE',
      instrument_type  TEXT NOT NULL DEFAULT 'EQ',
      strike           REAL,
      expiry           TEXT,
      lot_size         INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS instruments_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS positions (
      id                TEXT PRIMARY KEY,
      user_id           TEXT NOT NULL,
      mode              TEXT NOT NULL DEFAULT 'paper',
      tradingsymbol     TEXT NOT NULL,
      instrument_token  INTEGER NOT NULL,
      strike            REAL NOT NULL,
      option_type       TEXT NOT NULL,
      side              TEXT NOT NULL,
      quantity          INTEGER NOT NULL,
      entry_price       REAL NOT NULL,
      entry_time        TEXT NOT NULL,
      expiry            TEXT NOT NULL,
      exited            INTEGER NOT NULL DEFAULT 0,
      exit_price        REAL,
      exit_time         TEXT,
      note              TEXT,
      target_price      REAL,
      stop_loss_price   REAL,
      strategy_tag      TEXT,
      confidence        INTEGER
    )
  `);

  ensureColumn('positions', 'note', 'TEXT');
  ensureColumn('positions', 'target_price', 'REAL');
  ensureColumn('positions', 'stop_loss_price', 'REAL');
  ensureColumn('positions', 'strategy_tag', 'TEXT');
  ensureColumn('positions', 'confidence', 'INTEGER');

  db.run(`
    CREATE TABLE IF NOT EXISTS oi_snapshots (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp  INTEGER NOT NULL,
      time_label TEXT NOT NULL,
      data       TEXT NOT NULL,
      prices     TEXT,
      close      TEXT,
      spot       REAL,
      volumes    TEXT
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_oi_snapshots_timestamp ON oi_snapshots(timestamp)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS oi_history (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      scrip            TEXT NOT NULL,
      date             TEXT NOT NULL,
      instrument_token INTEGER NOT NULL,
      tradingsymbol    TEXT NOT NULL,
      strike           REAL,
      option_type      TEXT,
      expiry           TEXT,
      open             REAL,
      high             REAL,
      low              REAL,
      close            REAL,
      volume           INTEGER,
      oi               INTEGER,
      spot_close       REAL,
      UNIQUE(scrip, date, instrument_token)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_oi_history_scrip_date ON oi_history(scrip, date)`);

  // Clean expired sessions on startup
  db.run('DELETE FROM sessions WHERE expires < ?', [Date.now()]);

  persist();
  console.log('[DB] SQLite initialised at', DB_PATH);
}

/**
 * Flush the in-memory database to disk. Called after every write operation
 * so data survives crashes.
 */
function persist() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function ensureColumn(table, column, definition) {
  const result = db.exec(`PRAGMA table_info(${table})`);
  const hasColumn = result[0]?.values.some((row) => row[1] === column);
  if (!hasColumn) db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Close the database cleanly. Call on process exit.
 */
export function closeDb() {
  if (db) {
    persist();
    db.close();
    db = null;
  }
}

// ---------------------------------------------------------------------------
// User CRUD
// ---------------------------------------------------------------------------

/**
 * Upsert a user record. Called after successful Kite OAuth.
 * Only stores identity (user_id + user_name) — no credentials.
 */
export function upsertUser(userId, userName) {
  if (!db) throw new Error('Database not initialised');

  db.run(
    `INSERT INTO users (user_id, user_name, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       user_name  = COALESCE(excluded.user_name, users.user_name),
       updated_at = datetime('now')`,
    [userId, userName],
  );

  persist();
}

/**
 * Delete a user by ID.
 */
export function deleteUser(userId) {
  if (!db) throw new Error('Database not initialised');
  db.run('DELETE FROM users WHERE user_id = ?', [userId]);
  persist();
}

// ---------------------------------------------------------------------------
// Session CRUD (for express-session store)
// ---------------------------------------------------------------------------

/**
 * Retrieve a session by ID. Returns parsed session object or null.
 */
export function getSessionById(sid) {
  if (!db) throw new Error('Database not initialised');

  const stmt = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?');
  stmt.bind([sid]);

  if (!stmt.step()) {
    stmt.free();
    return null;
  }

  const row = stmt.getAsObject();
  stmt.free();

  // Expired — clean it up
  if (row.expires < Date.now()) {
    db.run('DELETE FROM sessions WHERE sid = ?', [sid]);
    persist();
    return null;
  }

  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

/**
 * Save or update a session. Computes expiry from cookie.maxAge or defaults
 * to 24 hours.
 */
export function setSessionData(sid, sessionData, maxAge) {
  if (!db) throw new Error('Database not initialised');

  const expires = Date.now() + (maxAge || 86400000);
  const data = JSON.stringify(sessionData);

  db.run(
    `INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?)
     ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires`,
    [sid, data, expires],
  );

  persist();
}

/**
 * Delete a session by ID.
 */
export function deleteSession(sid) {
  if (!db) throw new Error('Database not initialised');
  db.run('DELETE FROM sessions WHERE sid = ?', [sid]);
  persist();
}

/**
 * Update a session's expiry without changing its data (keep-alive).
 */
export function touchSession(sid, maxAge) {
  if (!db) throw new Error('Database not initialised');
  const expires = Date.now() + (maxAge || 86400000);
  db.run('UPDATE sessions SET expires = ? WHERE sid = ?', [expires, sid]);
  persist();
}

/**
 * Remove all expired sessions. Called periodically by the session store.
 */
export function cleanExpiredSessions() {
  if (!db) throw new Error('Database not initialised');
  const result = db.run('DELETE FROM sessions WHERE expires < ?', [Date.now()]);
  persist();
  return result;
}

// ---------------------------------------------------------------------------
// Watchlist CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new watchlist for a user. Returns the created watchlist object.
 */
export function createWatchlist(userId, name) {
  if (!db) throw new Error('Database not initialised');

  const id = crypto.randomUUID();

  // Next sort_order = max existing + 1
  const maxResult = db.exec(
    'SELECT COALESCE(MAX(sort_order), -1) FROM watchlists WHERE user_id = ?',
    [userId],
  );
  const sortOrder = (maxResult[0]?.values[0]?.[0] ?? -1) + 1;

  db.run(
    'INSERT INTO watchlists (id, user_id, name, sort_order) VALUES (?, ?, ?, ?)',
    [id, userId, name.trim(), sortOrder],
  );

  persist();
  return { id, name: name.trim(), sortOrder, itemCount: 0 };
}

/**
 * Get all watchlists for a user (metadata only — no items).
 * Returns id, name, sortOrder, and itemCount for tab rendering.
 */
export function getWatchlists(userId) {
  if (!db) throw new Error('Database not initialised');

  const stmt = db.prepare(
    `SELECT w.id, w.name, w.sort_order,
            (SELECT COUNT(*) FROM watchlist_items wi WHERE wi.watchlist_id = w.id) AS item_count
     FROM watchlists w
     WHERE w.user_id = ?
     ORDER BY w.sort_order`,
  );
  stmt.bind([userId]);

  const lists = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    lists.push({
      id: row.id,
      name: row.name,
      sortOrder: row.sort_order,
      itemCount: row.item_count,
    });
  }
  stmt.free();

  return lists;
}

/**
 * Get a single watchlist with all its items. Validates ownership.
 * Returns null if not found or wrong owner.
 */
export function getWatchlistItems(id, userId) {
  if (!db) throw new Error('Database not initialised');

  // Verify ownership + get metadata
  const listStmt = db.prepare('SELECT id, name, sort_order FROM watchlists WHERE id = ? AND user_id = ?');
  listStmt.bind([id, userId]);

  if (!listStmt.step()) {
    listStmt.free();
    return null;
  }

  const listRow = listStmt.getAsObject();
  listStmt.free();

  // Fetch items
  const itemStmt = db.prepare(
    `SELECT id, instrument_token, tradingsymbol, exchange, sort_order
     FROM watchlist_items
     WHERE watchlist_id = ?
     ORDER BY sort_order`,
  );
  itemStmt.bind([id]);

  const items = [];
  while (itemStmt.step()) {
    const row = itemStmt.getAsObject();
    items.push({
      id: row.id,
      instrumentToken: row.instrument_token,
      tradingsymbol: row.tradingsymbol,
      exchange: row.exchange,
      sortOrder: row.sort_order,
    });
  }
  itemStmt.free();

  return {
    id: listRow.id,
    name: listRow.name,
    sortOrder: listRow.sort_order,
    items,
  };
}

/**
 * Rename a watchlist. Returns true if updated, false if not found or wrong owner.
 */
export function renameWatchlist(id, userId, name) {
  if (!db) throw new Error('Database not initialised');

  db.run(
    'UPDATE watchlists SET name = ? WHERE id = ? AND user_id = ?',
    [name.trim(), id, userId],
  );

  const changes = db.getRowsModified();
  if (changes > 0) persist();
  return changes > 0;
}

/**
 * Delete a watchlist and all its items. Returns true if deleted.
 */
export function deleteWatchlist(id, userId) {
  if (!db) throw new Error('Database not initialised');

  // Verify ownership
  const checkStmt = db.prepare('SELECT id FROM watchlists WHERE id = ? AND user_id = ?');
  checkStmt.bind([id, userId]);
  const exists = checkStmt.step();
  checkStmt.free();

  if (!exists) return false;

  db.run('DELETE FROM watchlist_items WHERE watchlist_id = ?', [id]);
  db.run('DELETE FROM watchlists WHERE id = ?', [id]);
  persist();
  return true;
}

/**
 * Add an item to a watchlist. Enforces 100-item limit.
 * Returns the created item or null if limit reached / duplicate.
 */
export function addWatchlistItem(watchlistId, userId, { instrumentToken, tradingsymbol, exchange }) {
  if (!db) throw new Error('Database not initialised');

  // Verify watchlist ownership
  const ownerStmt = db.prepare('SELECT id FROM watchlists WHERE id = ? AND user_id = ?');
  ownerStmt.bind([watchlistId, userId]);
  const owned = ownerStmt.step();
  ownerStmt.free();
  if (!owned) return null;

  // Check item count
  const countResult = db.exec(
    'SELECT COUNT(*) FROM watchlist_items WHERE watchlist_id = ?',
    [watchlistId],
  );
  const count = countResult[0]?.values[0]?.[0] ?? 0;
  if (count >= 100) return null;

  // Check for duplicate instrument in same watchlist
  const dupStmt = db.prepare(
    'SELECT id FROM watchlist_items WHERE watchlist_id = ? AND instrument_token = ?',
  );
  dupStmt.bind([watchlistId, instrumentToken]);
  const isDuplicate = dupStmt.step();
  dupStmt.free();
  if (isDuplicate) return null;

  const id = crypto.randomUUID();
  const sortOrder = count; // append at end

  db.run(
    `INSERT INTO watchlist_items (id, watchlist_id, instrument_token, tradingsymbol, exchange, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, watchlistId, instrumentToken, tradingsymbol, exchange || 'NSE', sortOrder],
  );

  persist();
  return { id, instrumentToken, tradingsymbol, exchange: exchange || 'NSE', sortOrder };
}

/**
 * Remove an item from a watchlist. Validates ownership via join.
 */
export function removeWatchlistItem(itemId, userId) {
  if (!db) throw new Error('Database not initialised');

  // Verify ownership through watchlist join
  const checkStmt = db.prepare(
    `SELECT wi.id FROM watchlist_items wi
     JOIN watchlists w ON wi.watchlist_id = w.id
     WHERE wi.id = ? AND w.user_id = ?`,
  );
  checkStmt.bind([itemId, userId]);
  const exists = checkStmt.step();
  checkStmt.free();

  if (!exists) return false;

  db.run('DELETE FROM watchlist_items WHERE id = ?', [itemId]);
  persist();
  return true;
}

// ---------------------------------------------------------------------------
// Instruments (shared across all users)
// ---------------------------------------------------------------------------

/**
 * Get the date (IST YYYY-MM-DD) when instruments were last fetched.
 * Returns null if never fetched.
 */
export function getInstrumentsDate() {
  if (!db) throw new Error('Database not initialised');

  const stmt = db.prepare("SELECT value FROM instruments_meta WHERE key = 'last_fetched_date'");
  const hasRow = stmt.step();
  const date = hasRow ? stmt.get()[0] : null;
  stmt.free();
  return date;
}

/**
 * Get all cached instruments. Returns an empty array if none cached.
 */
export function getInstruments() {
  if (!db) throw new Error('Database not initialised');

  const results = db.exec(
    'SELECT instrument_token, exchange_token, tradingsymbol, name, exchange, instrument_type, strike, expiry, lot_size FROM instruments',
  );
  if (!results.length) return [];

  return results[0].values.map(([instrumentToken, exchangeToken, tradingsymbol, name, exchange, instrumentType, strike, expiry, lotSize]) => ({
    instrumentToken,
    exchangeToken,
    tradingsymbol,
    name,
    exchange,
    instrumentType,
    strike: strike || null,
    expiry: expiry || null,
    lotSize: lotSize || null,
  }));
}

/**
 * Replace all instruments with a fresh set and update the fetch date.
 * Runs inside a transaction for atomicity.
 */
export function saveInstruments(instruments, dateIST) {
  if (!db) throw new Error('Database not initialised');

  db.run('BEGIN TRANSACTION');
  try {
    db.run('DELETE FROM instruments');
    db.run("DELETE FROM instruments_meta WHERE key = 'last_fetched_date'");

    const stmt = db.prepare(
      'INSERT INTO instruments (instrument_token, exchange_token, tradingsymbol, name, exchange, instrument_type, strike, expiry, lot_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );

    for (const inst of instruments) {
      stmt.run([
        inst.instrumentToken,
        inst.exchangeToken,
        inst.tradingsymbol,
        inst.name,
        inst.exchange,
        inst.instrumentType || 'EQ',
        inst.strike || null,
        inst.expiry || null,
        inst.lotSize || null,
      ]);
    }
    stmt.free();

    db.run("INSERT INTO instruments_meta (key, value) VALUES ('last_fetched_date', ?)", [dateIST]);
    db.run('COMMIT');
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  }

  persist();
}

// ---------------------------------------------------------------------------
// Positions CRUD
// ---------------------------------------------------------------------------

/**
 * Get all positions for a user, optionally filtered by mode.
 */
export function getPositions(userId, mode = null) {
  if (!db) throw new Error('Database not initialised');

  const sql = mode
    ? 'SELECT * FROM positions WHERE user_id = ? AND mode = ? ORDER BY entry_time DESC'
    : 'SELECT * FROM positions WHERE user_id = ? ORDER BY entry_time DESC';
  const params = mode ? [userId, mode] : [userId];

  const results = db.exec(sql, params);
  if (!results.length) return [];

  const columns = results[0].columns;
  return results[0].values.map((row) => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return mapPositionRow(obj);
  });
}

/**
 * Map a raw DB row to a camelCase position object.
 */
function mapPositionRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    mode: row.mode,
    tradingsymbol: row.tradingsymbol,
    instrumentToken: row.instrument_token,
    strike: row.strike,
    optionType: row.option_type,
    side: row.side,
    quantity: row.quantity,
    entryPrice: row.entry_price,
    entryTime: row.entry_time,
    expiry: row.expiry,
    exited: row.exited === 1,
    exitPrice: row.exit_price,
    exitTime: row.exit_time,
    note: row.note || '',
    targetPrice: row.target_price,
    stopLossPrice: row.stop_loss_price,
    strategyTag: row.strategy_tag || '',
    confidence: row.confidence,
  };
}

function positionMetaValues(position) {
  return [
    position.note?.trim() || null,
    position.targetPrice === undefined || position.targetPrice === null || position.targetPrice === '' ? null : Number(position.targetPrice),
    position.stopLossPrice === undefined || position.stopLossPrice === null || position.stopLossPrice === '' ? null : Number(position.stopLossPrice),
    position.strategyTag?.trim() || null,
    position.confidence === undefined || position.confidence === null || position.confidence === '' ? null : Number(position.confidence),
  ];
}

/**
 * Add a position with full netting logic:
 *   - Same-side existing → average in
 *   - Opposite-side existing → net out (exact, partial, or over-close)
 *   - No existing → open fresh
 */
export function addPosition(userId, position) {
  if (!db) throw new Error('Database not initialised');

  const mode = position.mode || 'paper';
  const now = new Date().toISOString();

  // Look for open same-side position
  const sameSide = queryPosition(
    'SELECT * FROM positions WHERE user_id = ? AND mode = ? AND instrument_token = ? AND side = ? AND exited = 0',
    [userId, mode, position.instrumentToken, position.side],
  );

  if (sameSide) {
    const totalQty = sameSide.quantity + position.quantity;
    const avgPrice = (sameSide.entry_price * sameSide.quantity + position.entryPrice * position.quantity) / totalQty;

    db.run(
      `UPDATE positions SET
         quantity = ?, entry_price = ?, note = COALESCE(?, note), target_price = COALESCE(?, target_price),
         stop_loss_price = COALESCE(?, stop_loss_price), strategy_tag = COALESCE(?, strategy_tag), confidence = COALESCE(?, confidence)
       WHERE id = ?`,
      [totalQty, Number(avgPrice.toFixed(2)), ...positionMetaValues(position), sameSide.id],
    );
    persist();
    const [note, targetPrice, stopLossPrice, strategyTag, confidence] = positionMetaValues(position);
    return mapPositionRow({
      ...sameSide,
      quantity: totalQty,
      entry_price: Number(avgPrice.toFixed(2)),
      note: note ?? sameSide.note,
      target_price: targetPrice ?? sameSide.target_price,
      stop_loss_price: stopLossPrice ?? sameSide.stop_loss_price,
      strategy_tag: strategyTag ?? sameSide.strategy_tag,
      confidence: confidence ?? sameSide.confidence,
    });
  }

  // Look for open opposite-side position
  const oppSide = position.side === 'BUY' ? 'SELL' : 'BUY';
  const opposite = queryPosition(
    'SELECT * FROM positions WHERE user_id = ? AND mode = ? AND instrument_token = ? AND side = ? AND exited = 0',
    [userId, mode, position.instrumentToken, oppSide],
  );

  if (opposite) {
    if (position.quantity === opposite.quantity) {
      // Exact close
      db.run(
        'UPDATE positions SET exited = 1, exit_price = ?, exit_time = ? WHERE id = ?',
        [position.entryPrice, now, opposite.id],
      );
      persist();
      return mapPositionRow({ ...opposite, exited: 1, exit_price: position.entryPrice, exit_time: now });
    }

    if (position.quantity < opposite.quantity) {
      // Partial close — reduce existing qty
      db.run(
        'UPDATE positions SET quantity = ? WHERE id = ?',
        [opposite.quantity - position.quantity, opposite.id],
      );
      persist();
      return mapPositionRow({ ...opposite, quantity: opposite.quantity - position.quantity });
    }

    // Over-close — close existing, open remainder in new side
    db.run(
      'UPDATE positions SET exited = 1, exit_price = ?, exit_time = ? WHERE id = ?',
      [position.entryPrice, now, opposite.id],
    );

    const remainderId = crypto.randomUUID();
    db.run(
      `INSERT INTO positions (id, user_id, mode, tradingsymbol, instrument_token, strike, option_type, side, quantity, entry_price, entry_time, expiry, note, target_price, stop_loss_price, strategy_tag, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [remainderId, userId, mode, position.tradingsymbol, position.instrumentToken, position.strike,
       position.optionType, position.side, position.quantity - opposite.quantity, position.entryPrice, now, position.expiry,
       ...positionMetaValues(position)],
    );
    persist();
    return mapPositionRow({
      id: remainderId, user_id: userId, mode, tradingsymbol: position.tradingsymbol,
      instrument_token: position.instrumentToken, strike: position.strike, option_type: position.optionType,
      side: position.side, quantity: position.quantity - opposite.quantity, entry_price: position.entryPrice,
      entry_time: now, expiry: position.expiry, exited: 0, exit_price: null, exit_time: null,
      note: position.note || null, target_price: position.targetPrice ?? null, stop_loss_price: position.stopLossPrice ?? null,
      strategy_tag: position.strategyTag || null, confidence: position.confidence ?? null,
    });
  }

  // No existing — open fresh
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO positions (id, user_id, mode, tradingsymbol, instrument_token, strike, option_type, side, quantity, entry_price, entry_time, expiry, note, target_price, stop_loss_price, strategy_tag, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, mode, position.tradingsymbol, position.instrumentToken, position.strike,
     position.optionType, position.side, position.quantity, position.entryPrice, now, position.expiry,
     ...positionMetaValues(position)],
  );
  persist();
  return mapPositionRow({
    id, user_id: userId, mode, tradingsymbol: position.tradingsymbol,
    instrument_token: position.instrumentToken, strike: position.strike, option_type: position.optionType,
    side: position.side, quantity: position.quantity, entry_price: position.entryPrice,
    entry_time: now, expiry: position.expiry, exited: 0, exit_price: null, exit_time: null,
    note: position.note || null, target_price: position.targetPrice ?? null, stop_loss_price: position.stopLossPrice ?? null,
    strategy_tag: position.strategyTag || null, confidence: position.confidence ?? null,
  });
}

/**
 * Exit a position by ID. Validates ownership.
 */
export function exitPositionById(id, userId, exitPrice) {
  if (!db) throw new Error('Database not initialised');

  const now = new Date().toISOString();
  db.run(
    'UPDATE positions SET exited = 1, exit_price = ?, exit_time = ? WHERE id = ? AND user_id = ? AND exited = 0',
    [exitPrice, now, id, userId],
  );

  const changes = db.getRowsModified();
  if (changes > 0) persist();
  return changes > 0;
}

/**
 * Remove a position by ID. Validates ownership.
 */
export function removePositionById(id, userId) {
  if (!db) throw new Error('Database not initialised');

  db.run('DELETE FROM positions WHERE id = ? AND user_id = ?', [id, userId]);
  const changes = db.getRowsModified();
  if (changes > 0) persist();
  return changes > 0;
}

/**
 * Clear all positions for a user, optionally filtered by mode.
 */
export function clearPositions(userId, mode = null) {
  if (!db) throw new Error('Database not initialised');

  if (mode) {
    db.run('DELETE FROM positions WHERE user_id = ? AND mode = ?', [userId, mode]);
  } else {
    db.run('DELETE FROM positions WHERE user_id = ?', [userId]);
  }
  persist();
}

/**
 * Helper: query a single position row.
 */
function queryPosition(sql, params) {
  const results = db.exec(sql, params);
  if (!results.length || !results[0].values.length) return null;

  const columns = results[0].columns;
  const row = {};
  columns.forEach((col, i) => { row[col] = results[0].values[0][i]; });
  return row;
}

// ---------------------------------------------------------------------------
// OI Snapshots (shared across all users)
// ---------------------------------------------------------------------------

/**
 * Helper: get today's midnight timestamp (IST-based, since market is NSE).
 */
function getTodayMidnight() {
  const now = new Date();
  // IST = UTC+5:30. Compute IST midnight in UTC ms.
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = now.getTime() + istOffset;
  const istMidnight = Math.floor(istNow / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
  return istMidnight - istOffset; // convert back to UTC ms
}

/**
 * Round a timestamp down to the nearest 10-minute mark.
 */
function roundTo10Min(timestamp) {
  const TEN_MIN = 10 * 60 * 1000;
  return Math.floor(timestamp / TEN_MIN) * TEN_MIN;
}

/**
 * Save an OI snapshot (shared). Merges tokens into existing row if one exists
 * for the same 10-minute slot. Silently cleans old-day rows.
 */
export function saveOiSnapshot(snapshot) {
  if (!db) throw new Error('Database not initialised');

  const rounded = roundTo10Min(snapshot.timestamp);
  const timeLabel = snapshot.timeLabel;
  const newData = typeof snapshot.data === 'string' ? JSON.parse(snapshot.data) : snapshot.data;
  const newPrices = snapshot.prices
    ? (typeof snapshot.prices === 'string' ? JSON.parse(snapshot.prices) : snapshot.prices)
    : null;
  const newClose = snapshot.close
    ? (typeof snapshot.close === 'string' ? JSON.parse(snapshot.close) : snapshot.close)
    : null;
  const newSpot = snapshot.spot || null;
  const newVolumes = snapshot.volumes
    ? (typeof snapshot.volumes === 'string' ? JSON.parse(snapshot.volumes) : snapshot.volumes)
    : null;

  // Check if a row exists for this 10-min slot
  const results = db.exec('SELECT id, data, prices, close, spot, volumes FROM oi_snapshots WHERE timestamp = ?', [rounded]);

  if (results.length && results[0].values.length) {
    const columns = results[0].columns;
    const row = {};
    columns.forEach((col, i) => { row[col] = results[0].values[0][i]; });

    // Merge tokens into existing data
    const existingData = JSON.parse(row.data);
    Object.assign(existingData, newData);

    let mergedPrices = row.prices ? JSON.parse(row.prices) : {};
    if (newPrices) Object.assign(mergedPrices, newPrices);
    const pricesStr = Object.keys(mergedPrices).length > 0 ? JSON.stringify(mergedPrices) : null;

    let mergedClose = row.close ? JSON.parse(row.close) : {};
    if (newClose) Object.assign(mergedClose, newClose);
    const closeStr = Object.keys(mergedClose).length > 0 ? JSON.stringify(mergedClose) : null;

    let mergedVolumes = row.volumes ? JSON.parse(row.volumes) : {};
    if (newVolumes) Object.assign(mergedVolumes, newVolumes);
    const volumesStr = Object.keys(mergedVolumes).length > 0 ? JSON.stringify(mergedVolumes) : null;

    const spot = newSpot || row.spot || null;

    db.run(
      'UPDATE oi_snapshots SET data = ?, prices = ?, close = ?, spot = ?, volumes = ? WHERE id = ?',
      [JSON.stringify(existingData), pricesStr, closeStr, spot, volumesStr, row.id],
    );
  } else {
    db.run(
      'INSERT INTO oi_snapshots (timestamp, time_label, data, prices, close, spot, volumes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [rounded, timeLabel, JSON.stringify(newData), newPrices ? JSON.stringify(newPrices) : null, newClose ? JSON.stringify(newClose) : null, newSpot, newVolumes ? JSON.stringify(newVolumes) : null],
    );
  }

  // Silent cleanup: remove rows older than today
  const todayMidnight = getTodayMidnight();
  db.run('DELETE FROM oi_snapshots WHERE timestamp < ?', [todayMidnight]);

  persist();
}

/**
 * Get OI snapshots from the most recent date available, ordered by timestamp.
 * When market is closed, this returns yesterday's snapshots (until a new one is saved today).
 */
export function getTodayOiSnapshots() {
  if (!db) throw new Error('Database not initialised');

  // Find the most recent date's midnight boundary
  const maxResult = db.exec('SELECT MAX(timestamp) as maxTs FROM oi_snapshots');
  if (!maxResult.length || !maxResult[0].values[0][0]) return [];

  const maxTs = maxResult[0].values[0][0];
  // Get IST midnight of that date
  const maxDate = new Date(maxTs);
  const istDate = new Date(maxDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  istDate.setHours(0, 0, 0, 0);
  const midnightMs = istDate.getTime();

  const results = db.exec(
    'SELECT timestamp, time_label, data, prices, close, spot, volumes FROM oi_snapshots WHERE timestamp >= ? ORDER BY timestamp',
    [midnightMs],
  );

  if (!results.length) return [];

  const columns = results[0].columns;
  return results[0].values.map((row) => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return {
      timestamp: obj.timestamp,
      timeLabel: obj.time_label,
      data: JSON.parse(obj.data),
      prices: obj.prices ? JSON.parse(obj.prices) : undefined,
      close: obj.close ? JSON.parse(obj.close) : undefined,
      spot: obj.spot || undefined,
      volumes: obj.volumes ? JSON.parse(obj.volumes) : undefined,
    };
  });
}

/**
 * Clean OI snapshots older than today.
 */
export function cleanOldOiSnapshots() {
  if (!db) throw new Error('Database not initialised');

  const todayMidnight = getTodayMidnight();
  db.run('DELETE FROM oi_snapshots WHERE timestamp < ?', [todayMidnight]);
  const changes = db.getRowsModified();
  if (changes > 0) persist();
  return changes;
}

/**
 * Get the timestamp of the most recent OI snapshot, or null if none today.
 */
export function getLatestOiSnapshotTimestamp() {
  if (!db) throw new Error('Database not initialised');

  const todayMidnight = getTodayMidnight();
  const results = db.exec(
    'SELECT MAX(timestamp) as ts FROM oi_snapshots WHERE timestamp >= ?',
    [todayMidnight],
  );

  if (!results.length || !results[0].values.length) return null;
  return results[0].values[0][0] || null;
}

// ===========================================================================
// OI History — single unified table for historical daily OI data
// ===========================================================================

/**
 * Create the unified OI history table if it doesn't exist.
 */
export function createOiHistoryTable() {
  if (!db) throw new Error('Database not initialised');

  db.run(`
    CREATE TABLE IF NOT EXISTS oi_history (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      scrip            TEXT NOT NULL,
      date             TEXT NOT NULL,
      instrument_token INTEGER NOT NULL,
      tradingsymbol    TEXT NOT NULL,
      strike           REAL,
      option_type      TEXT,
      expiry           TEXT,
      open             REAL,
      high             REAL,
      low              REAL,
      close            REAL,
      volume           INTEGER,
      oi               INTEGER,
      spot_close       REAL,
      UNIQUE(scrip, date, instrument_token)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_oi_history_scrip_date ON oi_history(scrip, date)`);
  persist();
}

/**
 * Insert or update OI history rows in bulk.
 * Uses INSERT OR REPLACE for upsert.
 */
export function insertOiHistoryRows(scrip, rows) {
  if (!db) throw new Error('Database not initialised');
  if (!rows.length) return 0;

  db.run('BEGIN TRANSACTION');
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO oi_history
        (scrip, date, instrument_token, tradingsymbol, strike, option_type, expiry, open, high, low, close, volume, oi, spot_close)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const r of rows) {
      stmt.run([
        scrip, r.date, r.instrumentToken, r.tradingsymbol, r.strike || null,
        r.optionType || null, r.expiry || null,
        r.open, r.high, r.low, r.close, r.volume, r.oi, r.spotClose,
      ]);
    }
    stmt.free();
    db.run('COMMIT');
    persist();
    return rows.length;
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  }
}

/**
 * Get OI history data for a scrip, optionally filtered by date range.
 */
export function getOiHistoryData(scrip, fromDate, toDate) {
  if (!db) throw new Error('Database not initialised');

  let sql = `SELECT date, instrument_token, tradingsymbol, strike, option_type, expiry,
             open, high, low, close, volume, oi, spot_close
             FROM oi_history WHERE scrip = ?`;
  const params = [scrip];

  if (fromDate && toDate) {
    sql += ' AND date >= ? AND date <= ?';
    params.push(fromDate, toDate);
  } else if (fromDate) {
    sql += ' AND date >= ?';
    params.push(fromDate);
  } else if (toDate) {
    sql += ' AND date <= ?';
    params.push(toDate);
  }

  sql += ' ORDER BY date, strike, option_type';

  const results = db.exec(sql, params);
  if (!results.length) return [];

  const columns = results[0].columns;
  return results[0].values.map((row) => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return {
      date: obj.date,
      instrumentToken: obj.instrument_token,
      tradingsymbol: obj.tradingsymbol,
      strike: obj.strike,
      optionType: obj.option_type,
      expiry: obj.expiry,
      open: obj.open,
      high: obj.high,
      low: obj.low,
      close: obj.close,
      volume: obj.volume,
      oi: obj.oi,
      spotClose: obj.spot_close,
    };
  });
}

/**
 * Get OI history rows for a specific expiry month, optionally from a start date.
 * expiryMonth format: 'YYYY-MM'
 */
export function getOiHistoryDataByExpiryMonth(scrip, expiryMonth, fromDate = null) {
  if (!db) throw new Error('Database not initialised');

  let sql = `SELECT date, instrument_token, tradingsymbol, strike, option_type, expiry,
             open, high, low, close, volume, oi, spot_close
             FROM oi_history WHERE scrip = ? AND expiry LIKE ? || '%'`;
  const params = [scrip, expiryMonth];

  if (fromDate) {
    sql += ' AND date >= ?';
    params.push(fromDate);
  }

  sql += ' ORDER BY date, strike, option_type';

  const results = db.exec(sql, params);
  if (!results.length) return [];

  const columns = results[0].columns;
  return results[0].values.map((row) => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return {
      date: obj.date,
      instrumentToken: obj.instrument_token,
      tradingsymbol: obj.tradingsymbol,
      strike: obj.strike,
      optionType: obj.option_type,
      expiry: obj.expiry,
      open: obj.open,
      high: obj.high,
      low: obj.low,
      close: obj.close,
      volume: obj.volume,
      oi: obj.oi,
      spotClose: obj.spot_close,
    };
  });
}

/**
 * Get option instruments for a given scrip, ATM, and range from the instruments table.
 * When allExpiries is false (default), returns only the nearest expiry.
 * When allExpiries is true, returns all expiries within the selected month
 * (or all expiries if no targetMonth provided).
 * targetMonth format: 'YYYY-MM'
 *
 * @param {string} scripName - Instrument name in NFO (e.g. 'NIFTY', 'BANKNIFTY', 'RELIANCE')
 * @param {number} atmStrike - At-the-money strike price
 * @param {number} stepSize - Strike step size (50 for NIFTY, 100 for BANKNIFTY, varies for stocks)
 * @param {number} range - Number of strikes above/below ATM to include
 * @param {{ allExpiries?: boolean, targetMonth?: string }} options
 */
export function getOptionsForAtm(scripName, atmStrike, stepSize = 50, range = 15, { allExpiries = false, targetMonth = '' } = {}) {
  if (!db) throw new Error('Database not initialised');

  const lowerStrike = atmStrike - range * stepSize;
  const upperStrike = atmStrike + range * stepSize;

  const results = db.exec(
    `SELECT instrument_token, tradingsymbol, strike, instrument_type, expiry
     FROM instruments
     WHERE name = ?
       AND exchange = 'NFO'
       AND instrument_type IN ('CE', 'PE')
       AND strike >= ? AND strike <= ?
     ORDER BY expiry, strike, instrument_type`,
    [scripName, lowerStrike, upperStrike],
  );

  if (!results.length) return [];

  const all = results[0].values.map(([token, symbol, strike, type, expiry]) => ({
    instrumentToken: token,
    tradingsymbol: symbol,
    strike,
    optionType: type,
    expiry,
  }));

  if (allExpiries) {
    // Filter to expiries within the target month if provided
    if (targetMonth) {
      return all.filter((r) => r.expiry && r.expiry.startsWith(targetMonth));
    }
    return all;
  }

  // Default: nearest expiry only
  const expiries = [...new Set(all.map((r) => r.expiry))].sort();
  const targetExpiry = expiries[0];
  return all.filter((r) => r.expiry === targetExpiry);
}

/**
 * Get distinct dates already stored for a scrip (within an optional range).
 * When minExpiries > 0, only returns dates that have data for at least that many
 * distinct expiries (used to detect partially-fetched days).
 * Returns a Set of 'YYYY-MM-DD' strings.
 */
export function getOiHistoryDates(scrip, fromDate, toDate, minExpiries = 0) {
  if (!db) throw new Error('Database not initialised');

  let where = ' WHERE scrip = ?';
  const params = [scrip];

  if (fromDate && toDate) {
    where += ' AND date >= ? AND date <= ?';
    params.push(fromDate, toDate);
  } else if (fromDate) {
    where += ' AND date >= ?';
    params.push(fromDate);
  } else if (toDate) {
    where += ' AND date <= ?';
    params.push(toDate);
  }

  if (minExpiries > 0) {
    const sql = `SELECT date, COUNT(DISTINCT expiry) as ec FROM oi_history${where} GROUP BY date HAVING ec >= ?`;
    params.push(minExpiries);
    const results = db.exec(sql, params);
    if (!results.length) return new Set();
    return new Set(results[0].values.map(([d]) => d));
  }

  const sql = `SELECT DISTINCT date FROM oi_history${where}`;
  const results = db.exec(sql, params);
  if (!results.length) return new Set();
  return new Set(results[0].values.map(([d]) => d));
}

/**
 * Get distinct dates already stored for a scrip and expiry month.
 * Used to avoid skipping a day just because a different expiry month exists.
 */
export function getOiHistoryDatesForExpiryMonth(scrip, expiryMonth, fromDate, toDate, minExpiries = 0) {
  if (!db) throw new Error('Database not initialised');

  let where = " WHERE scrip = ? AND expiry LIKE ? || '%'";
  const params = [scrip, expiryMonth];

  if (fromDate && toDate) {
    where += ' AND date >= ? AND date <= ?';
    params.push(fromDate, toDate);
  } else if (fromDate) {
    where += ' AND date >= ?';
    params.push(fromDate);
  } else if (toDate) {
    where += ' AND date <= ?';
    params.push(toDate);
  }

  if (minExpiries > 0) {
    const sql = `SELECT date, COUNT(DISTINCT expiry) as ec FROM oi_history${where} GROUP BY date HAVING ec >= ?`;
    params.push(minExpiries);
    const results = db.exec(sql, params);
    if (!results.length) return new Set();
    return new Set(results[0].values.map(([d]) => d));
  }

  const sql = `SELECT DISTINCT date FROM oi_history${where}`;
  const results = db.exec(sql, params);
  if (!results.length) return new Set();
  return new Set(results[0].values.map(([d]) => d));
}

/**
 * Get distinct months that have data for a given scrip.
 * Returns sorted array of 'YYYY-MM' strings (newest first).
 */
export function getOiHistoryMonths(scrip) {
  if (!db) throw new Error('Database not initialised');

  const sql = `SELECT DISTINCT substr(date, 1, 7) as month FROM oi_history WHERE scrip = ? ORDER BY month DESC`;
  const results = db.exec(sql, [scrip]);
  if (!results.length) return [];
  return results[0].values.map(([m]) => m);
}

/**
 * Get distinct expiry months that already have stored OI history for a scrip.
 * Returns sorted array of 'YYYY-MM' strings.
 */
export function getStoredOiHistoryExpiryMonths(scrip) {
  if (!db) throw new Error('Database not initialised');

  const sql = `
    SELECT DISTINCT substr(expiry, 1, 7) as month
    FROM oi_history
    WHERE scrip = ?
      AND expiry IS NOT NULL
      AND expiry != ''
    ORDER BY month
  `;
  const results = db.exec(sql, [scrip]);
  if (!results.length) return [];
  return results[0].values.map(([m]) => m);
}

/**
 * Get the nearest future expiry months from the current instruments cache.
 * NSE lists 3 monthly expiries per F&O underlying, so we cap the result to
 * the nearest `limit` months and drop far-dated (semi-annual) contracts.
 * Returns sorted array of 'YYYY-MM' strings.
 */
export function getOiHistoryExpiryMonths(scrip, minExpiryDate, limit = 3) {
  if (!db) throw new Error('Database not initialised');

  const scripName = scrip === 'NIFTY50' ? 'NIFTY' : scrip;
  const sql = `
    SELECT DISTINCT substr(expiry, 1, 7) as month
    FROM instruments
    WHERE name = ?
      AND exchange = 'NFO'
      AND instrument_type IN ('CE', 'PE')
      AND expiry IS NOT NULL
      AND expiry >= ?
    ORDER BY month
    LIMIT ?
  `;
  const results = db.exec(sql, [scripName, minExpiryDate, limit]);
  if (!results.length) return [];
  return results[0].values.map(([m]) => m);
}


/**
 * Delete all OI history rows for a given month (all scrips).
 * @param {string} month - Format 'YYYY-MM'
 * @returns {number} Number of rows deleted
 */
export function deleteOiHistoryByMonth(month) {
  if (!db) throw new Error('Database not initialised');

  db.run("DELETE FROM oi_history WHERE date LIKE ? || '%'", [month]);
  const changes = db.getRowsModified();
  if (changes > 0) persist();
  return changes;
}

/**
 * Delete all OI history rows for a given scrip.
 * @param {string} scrip - Scrip name (e.g., 'NIFTY50')
 * @returns {number} Number of rows deleted
 */
export function deleteOiHistoryByScrip(scrip) {
  if (!db) throw new Error('Database not initialised');

  db.run('DELETE FROM oi_history WHERE scrip = ?', [scrip]);
  const changes = db.getRowsModified();
  if (changes > 0) persist();
  return changes;
}

/**
 * Delete all OI history rows for a given expiry month.
 * @param {string} scrip - Scrip name (e.g., 'NIFTY50')
 * @param {string} expiryMonth - Format 'YYYY-MM'
 * @returns {number} Number of rows deleted
 */
export function deleteOiHistoryByExpiryMonth(scrip, expiryMonth) {
  if (!db) throw new Error('Database not initialised');

  db.run("DELETE FROM oi_history WHERE scrip = ? AND expiry LIKE ? || '%'", [scrip, expiryMonth]);
  const changes = db.getRowsModified();
  if (changes > 0) persist();
  return changes;
}

/**
 * Delete OI history rows for a scrip with expiry months older than cutoff.
 * @param {string} scrip - Scrip name (e.g., 'NIFTY50')
 * @param {string} cutoffExpiryMonth - Keep this expiry month and newer. Format 'YYYY-MM'
 * @returns {number} Number of rows deleted
 */
export function deleteOiHistoryBeforeExpiryMonth(scrip, cutoffExpiryMonth) {
  if (!db) throw new Error('Database not initialised');

  db.run("DELETE FROM oi_history WHERE scrip = ? AND substr(expiry, 1, 7) < ?", [scrip, cutoffExpiryMonth]);
  const changes = db.getRowsModified();
  if (changes > 0) persist();
  return changes;
}

/**
 * Delete OI history rows for specific dates (for a given scrip).
 * Used before re-fetching to ensure clean data for those dates.
 * @param {string} scrip - Scrip name (e.g., 'NIFTY50')
 * @param {string[]} dates - Array of 'YYYY-MM-DD' strings
 * @returns {number} Number of rows deleted
 */
export function deleteOiHistoryByDates(scrip, dates) {
  if (!db) throw new Error('Database not initialised');
  if (!dates.length) return 0;

  const placeholders = dates.map(() => '?').join(', ');
  const sql = `DELETE FROM oi_history WHERE scrip = ? AND date IN (${placeholders})`;
  db.run(sql, [scrip, ...dates]);
  const changes = db.getRowsModified();
  if (changes > 0) persist();
  return changes;
}

/**
 * Delete OI history rows for specific dates and expiry month.
 */
export function deleteOiHistoryByDatesForExpiryMonth(scrip, expiryMonth, dates) {
  if (!db) throw new Error('Database not initialised');
  if (!dates.length) return 0;

  const placeholders = dates.map(() => '?').join(', ');
  const sql = `DELETE FROM oi_history WHERE scrip = ? AND expiry LIKE ? || '%' AND date IN (${placeholders})`;
  db.run(sql, [scrip, expiryMonth, ...dates]);
  const changes = db.getRowsModified();
  if (changes > 0) persist();
  return changes;
}

/**
 * Get distinct F&O symbol names from the instruments cache.
 * Returns sorted array of names (e.g. ['BANKNIFTY', 'HDFCBANK', 'NIFTY', 'RELIANCE', ...])
 */
export function getFnoSymbols() {
  if (!db) throw new Error('Database not initialised');

  const results = db.exec(
    "SELECT DISTINCT name FROM instruments WHERE exchange = 'NFO' AND instrument_type IN ('CE', 'PE') ORDER BY name",
  );
  if (!results.length) return [];
  return results[0].values.map(([name]) => name);
}

/**
 * Look up the NSE EQ instrument token for a stock (used as spot token).
 * Matches by tradingsymbol since NSE `name` is the full company name
 * while NFO `name` is the short symbol.
 * Returns the instrument_token or null if not found.
 */
export function getSpotToken(name) {
  if (!db) throw new Error('Database not initialised');

  const results = db.exec(
    "SELECT instrument_token FROM instruments WHERE tradingsymbol = ? AND exchange = 'NSE' AND instrument_type = 'EQ' LIMIT 1",
    [name],
  );
  if (!results.length || !results[0].values.length) return null;
  return results[0].values[0][0];
}

/**
 * Get the strike step size for a symbol by looking at the gap between adjacent strikes.
 * Returns the most common step size, or 50 as default.
 */
export function getStrikeStepSize(scripName) {
  if (!db) throw new Error('Database not initialised');

  const results = db.exec(
    `SELECT DISTINCT strike FROM instruments
     WHERE name = ? AND exchange = 'NFO' AND instrument_type = 'CE' AND strike > 0
     ORDER BY strike LIMIT 20`,
    [scripName],
  );
  if (!results.length || results[0].values.length < 2) return 50;

  const strikes = results[0].values.map(([s]) => s);
  // Find the most common gap between consecutive strikes
  const gaps = new Map();
  for (let i = 1; i < strikes.length; i++) {
    const gap = Math.round(strikes[i] - strikes[i - 1]);
    if (gap > 0) gaps.set(gap, (gaps.get(gap) || 0) + 1);
  }

  let bestGap = 50;
  let bestCount = 0;
  for (const [gap, count] of gaps) {
    if (count > bestCount) { bestGap = gap; bestCount = count; }
  }
  return bestGap;
}
