/**
 * SQLite Database Manager
 *
 * Manages persistent storage for OptionTrap using sql.js (pure-JS SQLite).
 * The database lives at server/data/optiontrap.db and is auto-created on
 * first run.
 *
 * Currently handles:
 *   - user_credentials: per-user Kite API key + AES-256-GCM encrypted secret
 *   - sessions: express-session data persisted across server restarts
 *
 * The encryption key is derived from SESSION_SECRET via scrypt. Without the
 * secret, the database file alone is useless — defense-in-depth against
 * stolen backups or disk access without shell access.
 */

import initSqlJs from 'sql.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'optiontrap.db');

// ---------------------------------------------------------------------------
// Encryption (AES-256-GCM)
// ---------------------------------------------------------------------------

const ENCRYPTION_KEY = crypto.scryptSync(
  process.env.SESSION_SECRET || 'insecure-dev-secret',
  'optiontrap-credential-salt',
  32,
);

/**
 * Encrypt a plaintext string. Returns `iv:tag:ciphertext` in hex.
 */
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an `iv:tag:ciphertext` hex string back to plaintext.
 * Throws on tampered or invalid data.
 */
function decrypt(ciphertext) {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const enc = Buffer.from(parts[2], 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc, undefined, 'utf8') + decipher.final('utf8');
}

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
    CREATE TABLE IF NOT EXISTS user_credentials (
      api_key        TEXT PRIMARY KEY,
      api_secret_enc TEXT NOT NULL,
      user_id        TEXT,
      user_name      TEXT,
      created_at     TEXT DEFAULT (datetime('now')),
      updated_at     TEXT DEFAULT (datetime('now'))
    )
  `);

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
      exit_time         TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS oi_snapshots (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp  INTEGER NOT NULL,
      time_label TEXT NOT NULL,
      data       TEXT NOT NULL,
      prices     TEXT,
      close      TEXT,
      spot       REAL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_oi_snapshots_timestamp ON oi_snapshots(timestamp)
  `);

  // Migrate existing oi_snapshots table: add close and spot columns if missing
  try {
    const tableInfo = db.exec('PRAGMA table_info(oi_snapshots)');
    if (tableInfo.length) {
      const columns = tableInfo[0].values.map((row) => row[1]);
      if (!columns.includes('close')) {
        db.run('ALTER TABLE oi_snapshots ADD COLUMN close TEXT');
      }
      if (!columns.includes('spot')) {
        db.run('ALTER TABLE oi_snapshots ADD COLUMN spot REAL');
      }
    }
  } catch (err) {
    console.warn('[DB] oi_snapshots migration warning:', err.message);
  }

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
// Credential CRUD
// ---------------------------------------------------------------------------

/**
 * Upsert a user's credentials. The api_secret is encrypted before storage.
 * On conflict (same api_key), the secret, user_id, and user_name are updated.
 */
export function saveCredentials(apiKey, apiSecret, userId = null, userName = null) {
  if (!db) throw new Error('Database not initialised');

  const encrypted = encrypt(apiSecret);

  db.run(
    `INSERT INTO user_credentials (api_key, api_secret_enc, user_id, user_name, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(api_key) DO UPDATE SET
       api_secret_enc = excluded.api_secret_enc,
       user_id        = COALESCE(excluded.user_id, user_credentials.user_id),
       user_name      = COALESCE(excluded.user_name, user_credentials.user_name),
       updated_at     = datetime('now')`,
    [apiKey, encrypted, userId, userName],
  );

  persist();
}

/**
 * Look up credentials by API key. Returns decrypted secret or null.
 */
export function getCredentialsByApiKey(apiKey) {
  if (!db) throw new Error('Database not initialised');

  const stmt = db.prepare('SELECT * FROM user_credentials WHERE api_key = ?');
  stmt.bind([apiKey]);

  if (!stmt.step()) {
    stmt.free();
    return null;
  }

  const row = stmt.getAsObject();
  stmt.free();

  return {
    apiKey: row.api_key,
    apiSecret: decrypt(row.api_secret_enc),
    userId: row.user_id || null,
    userName: row.user_name || null,
  };
}

/**
 * Look up credentials by Kite user ID. Returns decrypted secret or null.
 */
export function getCredentialsByUserId(userId) {
  if (!db) throw new Error('Database not initialised');

  const stmt = db.prepare('SELECT * FROM user_credentials WHERE user_id = ?');
  stmt.bind([userId]);

  if (!stmt.step()) {
    stmt.free();
    return null;
  }

  const row = stmt.getAsObject();
  stmt.free();

  return {
    apiKey: row.api_key,
    apiSecret: decrypt(row.api_secret_enc),
    userId: row.user_id || null,
    userName: row.user_name || null,
  };
}

/**
 * Delete a user's credentials by API key.
 */
export function deleteCredentials(apiKey) {
  if (!db) throw new Error('Database not initialised');
  db.run('DELETE FROM user_credentials WHERE api_key = ?', [apiKey]);
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
  };
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
      'UPDATE positions SET quantity = ?, entry_price = ? WHERE id = ?',
      [totalQty, Number(avgPrice.toFixed(2)), sameSide.id],
    );
    persist();
    return mapPositionRow({ ...sameSide, quantity: totalQty, entry_price: Number(avgPrice.toFixed(2)) });
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
      `INSERT INTO positions (id, user_id, mode, tradingsymbol, instrument_token, strike, option_type, side, quantity, entry_price, entry_time, expiry)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [remainderId, userId, mode, position.tradingsymbol, position.instrumentToken, position.strike,
       position.optionType, position.side, position.quantity - opposite.quantity, position.entryPrice, now, position.expiry],
    );
    persist();
    return mapPositionRow({
      id: remainderId, user_id: userId, mode, tradingsymbol: position.tradingsymbol,
      instrument_token: position.instrumentToken, strike: position.strike, option_type: position.optionType,
      side: position.side, quantity: position.quantity - opposite.quantity, entry_price: position.entryPrice,
      entry_time: now, expiry: position.expiry, exited: 0, exit_price: null, exit_time: null,
    });
  }

  // No existing — open fresh
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO positions (id, user_id, mode, tradingsymbol, instrument_token, strike, option_type, side, quantity, entry_price, entry_time, expiry)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, mode, position.tradingsymbol, position.instrumentToken, position.strike,
     position.optionType, position.side, position.quantity, position.entryPrice, now, position.expiry],
  );
  persist();
  return mapPositionRow({
    id, user_id: userId, mode, tradingsymbol: position.tradingsymbol,
    instrument_token: position.instrumentToken, strike: position.strike, option_type: position.optionType,
    side: position.side, quantity: position.quantity, entry_price: position.entryPrice,
    entry_time: now, expiry: position.expiry, exited: 0, exit_price: null, exit_time: null,
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

  // Check if a row exists for this 10-min slot
  const results = db.exec('SELECT id, data, prices, close, spot FROM oi_snapshots WHERE timestamp = ?', [rounded]);

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

    const spot = newSpot || row.spot || null;

    db.run(
      'UPDATE oi_snapshots SET data = ?, prices = ?, close = ?, spot = ? WHERE id = ?',
      [JSON.stringify(existingData), pricesStr, closeStr, spot, row.id],
    );
  } else {
    db.run(
      'INSERT INTO oi_snapshots (timestamp, time_label, data, prices, close, spot) VALUES (?, ?, ?, ?, ?, ?)',
      [rounded, timeLabel, JSON.stringify(newData), newPrices ? JSON.stringify(newPrices) : null, newClose ? JSON.stringify(newClose) : null, newSpot],
    );
  }

  // Silent cleanup: remove rows older than today
  const todayMidnight = getTodayMidnight();
  db.run('DELETE FROM oi_snapshots WHERE timestamp < ?', [todayMidnight]);

  persist();
}

/**
 * Get all OI snapshots from today, ordered by timestamp.
 */
export function getTodayOiSnapshots() {
  if (!db) throw new Error('Database not initialised');

  const todayMidnight = getTodayMidnight();
  const results = db.exec(
    'SELECT timestamp, time_label, data, prices, close, spot FROM oi_snapshots WHERE timestamp >= ? ORDER BY timestamp',
    [todayMidnight],
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

// ---------------------------------------------------------------------------
// Migration from legacy credentials.json
// ---------------------------------------------------------------------------

/**
 * One-time migration: if credentials.json exists and the database is empty,
 * import the single credential set into SQLite. Returns true if migrated.
 */
export function migrateFromJson(credentialsPath) {
  if (!db) throw new Error('Database not initialised');
  if (!fs.existsSync(credentialsPath)) return false;

  const [{ count }] = db.exec('SELECT COUNT(*) as count FROM user_credentials')[0]?.values
    ? [{ count: db.exec('SELECT COUNT(*) FROM user_credentials')[0].values[0][0] }]
    : [{ count: 0 }];

  if (count > 0) return false;

  try {
    const data = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
    if (data.apiKey && data.apiSecret) {
      saveCredentials(data.apiKey, data.apiSecret);
      console.log('[DB] Migrated credentials from credentials.json to SQLite');
      console.log('[DB] You can safely delete server/credentials.json');
      return true;
    }
  } catch {
    console.warn('[DB] Failed to parse credentials.json during migration');
  }

  return false;
}
