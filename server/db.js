/**
 * PostgreSQL Database Manager
 *
 * Persistent storage for OptionTrap backed by PostgreSQL (via `pg`).
 * All exported functions are async.
 *
 * Connection is configured via DATABASE_URL, e.g.
 *   postgres://optiontrap:optiontrap@localhost:5433/optiontrap
 *
 * Credentials (apiKey + apiSecret) are stored ONLY in the client browser's
 * localStorage. The server never persists them.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const DATABASE_URL = process.env.DATABASE_URL
  || 'postgres://optiontrap:optiontrap@localhost:5433/optiontrap';

// Return integers as JS numbers (safe for our value ranges) instead of strings.
pg.types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10))); // int8/bigint
pg.types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val))); // numeric

/** @type {pg.Pool | null} */
let pool = null;

/**
 * Run a query against the pool. Returns the pg result.
 */
async function query(text, params = []) {
  if (!pool) throw new Error('Database not initialised');
  return pool.query(text, params);
}

/**
 * Convenience: return all rows for a query.
 */
async function rows(text, params = []) {
  const res = await query(text, params);
  return res.rows;
}

/**
 * Convenience: return the first row (or null).
 */
async function firstRow(text, params = []) {
  const res = await query(text, params);
  return res.rows[0] || null;
}

/**
 * Initialise the database: create the connection pool and apply pending SQL
 * migrations. Safe to call multiple times.
 */
export async function initDb() {
  if (pool) return;

  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: parseInt(process.env.PG_POOL_MAX || '10', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
  });

  await runMigrations();

  // Clean expired sessions on startup
  await query('DELETE FROM sessions WHERE expires < $1', [Date.now()]);

  console.log('[DB] PostgreSQL initialised');
}

/**
 * Apply pending SQL migrations from server/migrations/.
 *
 * Each *.sql file (e.g. 001_init_schema.sql, 004_add_column.sql) runs exactly
 * once, in filename order. Applied files are recorded in schema_migrations by
 * name + checksum, so restarts skip them. To change the schema, add a NEW
 * numbered file — never edit an already-applied one.
 */
async function runMigrations() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    )
  `);

  if (!fs.existsSync(MIGRATIONS_DIR)) return;

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    // Normalize CRLF -> LF before hashing so checksums stay stable across
    // platforms and git autocrlf checkouts (Windows). Otherwise a line-ending
    // rewrite would look like a modified migration and block startup.
    const sql = raw.replace(/\r\n/g, '\n');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');

    const existing = await firstRow('SELECT checksum FROM schema_migrations WHERE name = $1', [file]);
    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`Migration ${file} was modified after being applied. Add a new migration instead of editing it.`);
      }
      continue; // already applied
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
        [file, checksum],
      );
      await client.query('COMMIT');
      console.log(`[DB] Applied migration ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }
}

/**
 * Close the pool cleanly. Call on process exit.
 */
export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Run `fn` while holding a transaction-scoped Postgres advisory lock.
 *
 * The lock is cross-process (works across multiple app replicas), so only one
 * caller anywhere runs the critical section at a time; others block until it is
 * released, then proceed. The lock is released automatically when the
 * transaction ends (commit/rollback), even if the process crashes.
 *
 * @param {number} lockKey - Arbitrary constant identifying the lock.
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withAdvisoryLock(lockKey, fn) {
  if (!pool) throw new Error('Database not initialised');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Hash an arbitrary string into a signed 64-bit BigInt suitable for use as a
 * Postgres advisory-lock key. Uses SHA-256 truncated to 8 bytes.
 *
 * @param {string} value
 * @returns {bigint}
 */
export function advisoryLockKey(value) {
  const hash = crypto.createHash('sha256').update(value).digest();
  // Read the first 8 bytes as a signed BigInt (pg advisory keys are bigint).
  return hash.readBigInt64BE(0);
}

/**
 * Run `fn` while holding a transaction-scoped advisory lock derived from a
 * string name. Different names lock independently; the same name serializes.
 *
 * @param {string} name
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withNamedAdvisoryLock(name, fn) {
  return withAdvisoryLock(advisoryLockKey(name), fn);
}

// ---------------------------------------------------------------------------
// User CRUD
// ---------------------------------------------------------------------------

export async function upsertUser(userId, userName) {
  await query(
    `INSERT INTO users (user_id, user_name, updated_at)
     VALUES ($1, $2, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
     ON CONFLICT (user_id) DO UPDATE SET
       user_name  = COALESCE(EXCLUDED.user_name, users.user_name),
       updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`,
    [userId, userName],
  );
}

export async function deleteUser(userId) {
  await query('DELETE FROM users WHERE user_id = $1', [userId]);
}

/**
 * Whether a user has the admin role. Admins bypass subscription checks and
 * can access the admin-only endpoints.
 */
export async function isUserAdmin(userId) {
  const row = await firstRow('SELECT is_admin FROM users WHERE user_id = $1', [userId]);
  return Boolean(row?.is_admin);
}

// ---------------------------------------------------------------------------
// Subscription CRUD
// ---------------------------------------------------------------------------

function mapPlan(row) {
  if (!row) return null;
  return {
    id: row.plan_id || row.id,
    name: row.plan_name || row.name,
    description: row.plan_description || row.description,
    currency: row.plan_currency || row.currency,
    durationCount: Number(row.plan_duration_count ?? row.duration_count ?? 1),
    durationUnit: row.plan_duration_unit || row.duration_unit || 'month',
    isActive: Boolean(row.plan_is_active ?? row.is_active),
  };
}

function mapSubscription(row) {
  if (!row) return null;

  const expiresAt = row.expires_at || null;
  const expired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;

  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    status: expired && row.status === 'active' ? 'expired' : row.status,
    active: row.status === 'active' && !expired,
    startsAt: row.starts_at || null,
    expiresAt,
    provider: row.provider || null,
    providerSubscriptionId: row.provider_subscription_id || null,
    providerPaymentId: row.provider_payment_id || null,
    updatedAt: row.updated_at,
    plan: mapPlan(row),
  };
}

function formatDbTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getPlanExpiryDate(durationCount, durationUnit) {
  const expiresAt = new Date();
  const count = Math.max(1, parseInt(durationCount, 10) || 1);

  switch (durationUnit) {
    case 'day':
      expiresAt.setDate(expiresAt.getDate() + count);
      break;
    case 'week':
      expiresAt.setDate(expiresAt.getDate() + count * 7);
      break;
    case 'month':
      expiresAt.setMonth(expiresAt.getMonth() + count);
      break;
    case 'year':
      expiresAt.setFullYear(expiresAt.getFullYear() + count);
      break;
    default:
      expiresAt.setMonth(expiresAt.getMonth() + count);
      break;
  }

  return expiresAt;
}

export async function getActiveSubscriptionPlans() {
  const result = await rows(
    'SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY price ASC, id ASC',
  );

  return result.map(mapPlan);
}

export async function getUserSubscription(userId) {
  const row = await firstRow(
    `SELECT
       s.*,
       p.id AS plan_id,
       p.name AS plan_name,
       p.description AS plan_description,
       p.price AS plan_price,
       p.currency AS plan_currency,
       p.duration_count AS plan_duration_count,
       p.duration_unit AS plan_duration_unit,
       p.is_active AS plan_is_active
     FROM subscriptions s
     JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.user_id = $1
     ORDER BY s.updated_at DESC
     LIMIT 1`,
    [userId],
  );

  return mapSubscription(row);
}

export async function activateSubscription(userId, planId = 'one_month', provider = 'internal') {
  const plan = await firstRow('SELECT id, duration_count, duration_unit FROM subscription_plans WHERE id = $1 AND is_active = 1', [planId]);

  if (!plan) {
    throw new Error('Subscription plan not found');
  }

  const id = crypto.randomUUID();
  const startsAt = formatDbTimestamp(new Date());
  const expiresAt = formatDbTimestamp(getPlanExpiryDate(plan.duration_count, plan.duration_unit));

  await query(
    `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at, provider, updated_at)
     VALUES ($1, $2, $3, 'active', $4, $5, $6, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
     ON CONFLICT (id) DO NOTHING`,
    [id, userId, planId, startsAt, expiresAt, provider],
  );

  const existing = await firstRow(
    'SELECT id FROM subscriptions WHERE user_id = $1 AND id <> $2 ORDER BY updated_at DESC LIMIT 1',
    [userId, id],
  );

  if (existing) {
    await query(
      `UPDATE subscriptions SET
        plan_id = $1,
        status = 'active',
        starts_at = $2,
        expires_at = $3,
        provider = $4,
        updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
       WHERE id = $5`,
      [planId, startsAt, expiresAt, provider, existing.id],
    );
    await query('DELETE FROM subscriptions WHERE id = $1', [id]);
    return getUserSubscription(userId);
  }

  return getUserSubscription(userId);
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export async function createFeedback({ userId, type, message, pageUrl, userAgent }) {
  const id = crypto.randomUUID();

  await query(
    `INSERT INTO feedback (id, user_id, type, message, page_url, user_agent, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'open', to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`,
    [id, userId, type, message, pageUrl || null, userAgent || null],
  );

  return {
    id,
    userId,
    type,
    message,
    pageUrl: pageUrl || null,
    status: 'open',
  };
}

function mapFeedback(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name || null,
    type: row.type,
    message: row.message,
    pageUrl: row.page_url || null,
    userAgent: row.user_agent || null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List feedback for the admin inbox, newest first. Optional filters by type
 * and status. Joins users so the admin sees who submitted each item.
 */
export async function getFeedbackList({ type, status } = {}) {
  const conditions = [];
  const params = [];

  if (type) {
    params.push(type);
    conditions.push(`f.type = $${params.length}`);
  }

  if (status) {
    params.push(status);
    conditions.push(`f.status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await rows(
    `SELECT
       f.id, f.user_id, u.user_name, f.type, f.message,
       f.page_url, f.user_agent, f.status, f.created_at, f.updated_at
     FROM feedback f
     LEFT JOIN users u ON u.user_id = f.user_id
     ${where}
     ORDER BY f.created_at DESC
     LIMIT 500`,
    params,
  );

  return result.map(mapFeedback);
}

/**
 * Update a feedback item's status. Returns true if a row was updated.
 */
export async function updateFeedbackStatus(id, status) {
  const result = await query(
    `UPDATE feedback
     SET status = $1, updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
     WHERE id = $2`,
    [status, id],
  );

  return result.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Session CRUD (for express-session store)
// ---------------------------------------------------------------------------

export async function getSessionById(sid) {
  const row = await firstRow('SELECT data, expires FROM sessions WHERE sid = $1', [sid]);
  if (!row) return null;

  if (Number(row.expires) < Date.now()) {
    await query('DELETE FROM sessions WHERE sid = $1', [sid]);
    return null;
  }

  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

export async function setSessionData(sid, sessionData, maxAge) {
  const expires = Date.now() + (maxAge || 86400000);
  const data = JSON.stringify(sessionData);

  await query(
    `INSERT INTO sessions (sid, data, expires) VALUES ($1, $2, $3)
     ON CONFLICT (sid) DO UPDATE SET data = EXCLUDED.data, expires = EXCLUDED.expires`,
    [sid, data, expires],
  );
}

export async function deleteSession(sid) {
  await query('DELETE FROM sessions WHERE sid = $1', [sid]);
}

export async function touchSession(sid, maxAge) {
  const expires = Date.now() + (maxAge || 86400000);
  await query('UPDATE sessions SET expires = $1 WHERE sid = $2', [expires, sid]);
}

export async function cleanExpiredSessions() {
  const res = await query('DELETE FROM sessions WHERE expires < $1', [Date.now()]);
  return res.rowCount;
}

// ---------------------------------------------------------------------------
// Watchlist CRUD
// ---------------------------------------------------------------------------

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

  // watchlist_items has ON DELETE CASCADE, but delete explicitly to mirror old behavior.
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
  const sortOrder = count;

  await query(
    `INSERT INTO watchlist_items (id, watchlist_id, instrument_token, tradingsymbol, exchange, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, watchlistId, instrumentToken, tradingsymbol, exchange || 'NSE', sortOrder],
  );

  return { id, instrumentToken, tradingsymbol, exchange: exchange || 'NSE', sortOrder };
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

// ---------------------------------------------------------------------------
// Instruments (shared across all users)
// ---------------------------------------------------------------------------

export async function getInstrumentsDate() {
  const row = await firstRow("SELECT value FROM instruments_meta WHERE key = 'last_fetched_date'");
  return row ? row.value : null;
}

export async function getInstruments() {
  const result = await rows(
    'SELECT instrument_token, exchange_token, tradingsymbol, name, exchange, instrument_type, strike, expiry, lot_size FROM instruments',
  );
  return result.map((row) => ({
    instrumentToken: Number(row.instrument_token),
    exchangeToken: Number(row.exchange_token),
    tradingsymbol: row.tradingsymbol,
    name: row.name,
    exchange: row.exchange,
    instrumentType: row.instrument_type,
    strike: row.strike || null,
    expiry: row.expiry || null,
    lotSize: row.lot_size || null,
  }));
}

export async function saveInstruments(instruments, dateIST) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM instruments');
    await client.query("DELETE FROM instruments_meta WHERE key = 'last_fetched_date'");

    const text = `INSERT INTO instruments
      (instrument_token, exchange_token, tradingsymbol, name, exchange, instrument_type, strike, expiry, lot_size)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (instrument_token) DO NOTHING`;

    for (const inst of instruments) {
      await client.query(text, [
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

    await client.query(
      "INSERT INTO instruments_meta (key, value) VALUES ('last_fetched_date', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [dateIST],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Positions CRUD
// ---------------------------------------------------------------------------

export async function getPositions(userId, mode = null) {
  const sql = mode
    ? 'SELECT * FROM positions WHERE user_id = $1 AND mode = $2 ORDER BY entry_time DESC'
    : 'SELECT * FROM positions WHERE user_id = $1 ORDER BY entry_time DESC';
  const params = mode ? [userId, mode] : [userId];

  const result = await rows(sql, params);
  return result.map(mapPositionRow);
}

function mapPositionRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    mode: row.mode,
    tradingsymbol: row.tradingsymbol,
    instrumentToken: Number(row.instrument_token),
    strike: row.strike,
    optionType: row.option_type,
    side: row.side,
    quantity: Number(row.quantity),
    entryPrice: row.entry_price,
    entryTime: row.entry_time,
    expiry: row.expiry,
    exited: Number(row.exited) === 1,
    exitPrice: row.exit_price,
    exitTime: row.exit_time,
    note: row.note || '',
    targetPrice: row.target_price,
    stopLossPrice: row.stop_loss_price,
    strategyTag: row.strategy_tag || '',
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
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

export async function addPosition(userId, position) {
  const mode = position.mode || 'paper';
  const now = new Date().toISOString();

  // Same-side existing → average in
  const sameSide = await firstRow(
    'SELECT * FROM positions WHERE user_id = $1 AND mode = $2 AND instrument_token = $3 AND side = $4 AND exited = 0',
    [userId, mode, position.instrumentToken, position.side],
  );

  if (sameSide) {
    const totalQty = Number(sameSide.quantity) + position.quantity;
    const avgPrice = (sameSide.entry_price * Number(sameSide.quantity) + position.entryPrice * position.quantity) / totalQty;
    const meta = positionMetaValues(position);

    await query(
      `UPDATE positions SET
         quantity = $1, entry_price = $2, note = COALESCE($3, note), target_price = COALESCE($4, target_price),
         stop_loss_price = COALESCE($5, stop_loss_price), strategy_tag = COALESCE($6, strategy_tag), confidence = COALESCE($7, confidence)
       WHERE id = $8`,
      [totalQty, Number(avgPrice.toFixed(2)), ...meta, sameSide.id],
    );

    const [note, targetPrice, stopLossPrice, strategyTag, confidence] = meta;
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

  // Opposite-side existing → net out
  const oppSide = position.side === 'BUY' ? 'SELL' : 'BUY';
  const opposite = await firstRow(
    'SELECT * FROM positions WHERE user_id = $1 AND mode = $2 AND instrument_token = $3 AND side = $4 AND exited = 0',
    [userId, mode, position.instrumentToken, oppSide],
  );

  if (opposite) {
    const oppQty = Number(opposite.quantity);
    if (position.quantity === oppQty) {
      await query(
        'UPDATE positions SET exited = 1, exit_price = $1, exit_time = $2 WHERE id = $3',
        [position.entryPrice, now, opposite.id],
      );
      return mapPositionRow({ ...opposite, exited: 1, exit_price: position.entryPrice, exit_time: now });
    }

    if (position.quantity < oppQty) {
      await query(
        'UPDATE positions SET quantity = $1 WHERE id = $2',
        [oppQty - position.quantity, opposite.id],
      );
      return mapPositionRow({ ...opposite, quantity: oppQty - position.quantity });
    }

    // Over-close — close existing, open remainder in new side
    await query(
      'UPDATE positions SET exited = 1, exit_price = $1, exit_time = $2 WHERE id = $3',
      [position.entryPrice, now, opposite.id],
    );

    const remainderId = crypto.randomUUID();
    await query(
      `INSERT INTO positions (id, user_id, mode, tradingsymbol, instrument_token, strike, option_type, side, quantity, entry_price, entry_time, expiry, note, target_price, stop_loss_price, strategy_tag, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [remainderId, userId, mode, position.tradingsymbol, position.instrumentToken, position.strike,
       position.optionType, position.side, position.quantity - oppQty, position.entryPrice, now, position.expiry,
       ...positionMetaValues(position)],
    );
    return mapPositionRow({
      id: remainderId, user_id: userId, mode, tradingsymbol: position.tradingsymbol,
      instrument_token: position.instrumentToken, strike: position.strike, option_type: position.optionType,
      side: position.side, quantity: position.quantity - oppQty, entry_price: position.entryPrice,
      entry_time: now, expiry: position.expiry, exited: 0, exit_price: null, exit_time: null,
      note: position.note || null, target_price: position.targetPrice ?? null, stop_loss_price: position.stopLossPrice ?? null,
      strategy_tag: position.strategyTag || null, confidence: position.confidence ?? null,
    });
  }

  // No existing — open fresh
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO positions (id, user_id, mode, tradingsymbol, instrument_token, strike, option_type, side, quantity, entry_price, entry_time, expiry, note, target_price, stop_loss_price, strategy_tag, confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [id, userId, mode, position.tradingsymbol, position.instrumentToken, position.strike,
     position.optionType, position.side, position.quantity, position.entryPrice, now, position.expiry,
     ...positionMetaValues(position)],
  );
  return mapPositionRow({
    id, user_id: userId, mode, tradingsymbol: position.tradingsymbol,
    instrument_token: position.instrumentToken, strike: position.strike, option_type: position.optionType,
    side: position.side, quantity: position.quantity, entry_price: position.entryPrice,
    entry_time: now, expiry: position.expiry, exited: 0, exit_price: null, exit_time: null,
    note: position.note || null, target_price: position.targetPrice ?? null, stop_loss_price: position.stopLossPrice ?? null,
    strategy_tag: position.strategyTag || null, confidence: position.confidence ?? null,
  });
}

export async function exitPositionById(id, userId, exitPrice) {
  const now = new Date().toISOString();
  const res = await query(
    'UPDATE positions SET exited = 1, exit_price = $1, exit_time = $2 WHERE id = $3 AND user_id = $4 AND exited = 0',
    [exitPrice, now, id, userId],
  );
  return res.rowCount > 0;
}

export async function removePositionById(id, userId) {
  const res = await query('DELETE FROM positions WHERE id = $1 AND user_id = $2', [id, userId]);
  return res.rowCount > 0;
}

export async function clearPositions(userId, mode = null) {
  if (mode) {
    await query('DELETE FROM positions WHERE user_id = $1 AND mode = $2', [userId, mode]);
  } else {
    await query('DELETE FROM positions WHERE user_id = $1', [userId]);
  }
}

// ---------------------------------------------------------------------------
// OI Snapshots (shared across all users)
// ---------------------------------------------------------------------------

function getTodayMidnight() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = now.getTime() + istOffset;
  const istMidnight = Math.floor(istNow / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
  return istMidnight - istOffset;
}

function roundTo10Min(timestamp) {
  const TEN_MIN = 10 * 60 * 1000;
  return Math.floor(timestamp / TEN_MIN) * TEN_MIN;
}

export async function saveOiSnapshot(snapshot) {
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

  // All users' snapshots for a given 10-min slot merge into ONE shared row.
  // Serialize the read-modify-write per slot (cross-process) so concurrent
  // watchers on the same/different scrips can't lose each other's tokens.
  await withNamedAdvisoryLock(`oi-snapshot:${rounded}`, async () => {
    const existing = await firstRow(
      'SELECT id, data, prices, close, spot, volumes FROM oi_snapshots WHERE timestamp = $1',
      [rounded],
    );

    if (existing) {
      const existingData = JSON.parse(existing.data);
      Object.assign(existingData, newData);

      const mergedPrices = existing.prices ? JSON.parse(existing.prices) : {};
      if (newPrices) Object.assign(mergedPrices, newPrices);
      const pricesStr = Object.keys(mergedPrices).length > 0 ? JSON.stringify(mergedPrices) : null;

      const mergedClose = existing.close ? JSON.parse(existing.close) : {};
      if (newClose) Object.assign(mergedClose, newClose);
      const closeStr = Object.keys(mergedClose).length > 0 ? JSON.stringify(mergedClose) : null;

      const mergedVolumes = existing.volumes ? JSON.parse(existing.volumes) : {};
      if (newVolumes) Object.assign(mergedVolumes, newVolumes);
      const volumesStr = Object.keys(mergedVolumes).length > 0 ? JSON.stringify(mergedVolumes) : null;

      const spot = newSpot || existing.spot || null;

      await query(
        'UPDATE oi_snapshots SET data = $1, prices = $2, close = $3, spot = $4, volumes = $5 WHERE id = $6',
        [JSON.stringify(existingData), pricesStr, closeStr, spot, volumesStr, existing.id],
      );
    } else {
      await query(
        `INSERT INTO oi_snapshots (timestamp, time_label, data, prices, close, spot, volumes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (timestamp) DO UPDATE SET
           data    = EXCLUDED.data,
           prices  = EXCLUDED.prices,
           close   = EXCLUDED.close,
           spot    = EXCLUDED.spot,
           volumes = EXCLUDED.volumes`,
        [rounded, timeLabel, JSON.stringify(newData), newPrices ? JSON.stringify(newPrices) : null, newClose ? JSON.stringify(newClose) : null, newSpot, newVolumes ? JSON.stringify(newVolumes) : null],
      );
    }
  });

  await query('DELETE FROM oi_snapshots WHERE timestamp < $1', [getTodayMidnight()]);
}

export async function getTodayOiSnapshots() {
  const maxRow = await firstRow('SELECT MAX(timestamp) AS max_ts FROM oi_snapshots');
  if (!maxRow || maxRow.max_ts === null) return [];

  const maxTs = Number(maxRow.max_ts);
  const maxDate = new Date(maxTs);
  const istDate = new Date(maxDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  istDate.setHours(0, 0, 0, 0);
  const midnightMs = istDate.getTime();

  const result = await rows(
    'SELECT timestamp, time_label, data, prices, close, spot, volumes FROM oi_snapshots WHERE timestamp >= $1 ORDER BY timestamp',
    [midnightMs],
  );

  return result.map((obj) => ({
    timestamp: Number(obj.timestamp),
    timeLabel: obj.time_label,
    data: JSON.parse(obj.data),
    prices: obj.prices ? JSON.parse(obj.prices) : undefined,
    close: obj.close ? JSON.parse(obj.close) : undefined,
    spot: obj.spot || undefined,
    volumes: obj.volumes ? JSON.parse(obj.volumes) : undefined,
  }));
}

export async function cleanOldOiSnapshots() {
  const res = await query('DELETE FROM oi_snapshots WHERE timestamp < $1', [getTodayMidnight()]);
  return res.rowCount;
}

export async function getLatestOiSnapshotTimestamp() {
  const row = await firstRow(
    'SELECT MAX(timestamp) AS ts FROM oi_snapshots WHERE timestamp >= $1',
    [getTodayMidnight()],
  );
  return row && row.ts !== null ? Number(row.ts) : null;
}

// ===========================================================================
// OI History
// ===========================================================================

export async function createOiHistoryTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS oi_history (
      id               BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      scrip            TEXT NOT NULL,
      date             TEXT NOT NULL,
      instrument_token BIGINT NOT NULL,
      tradingsymbol    TEXT NOT NULL,
      strike           DOUBLE PRECISION,
      option_type      TEXT,
      expiry           TEXT,
      open             DOUBLE PRECISION,
      high             DOUBLE PRECISION,
      low              DOUBLE PRECISION,
      close            DOUBLE PRECISION,
      volume           BIGINT,
      oi               BIGINT,
      spot_close       DOUBLE PRECISION,
      UNIQUE(scrip, date, instrument_token)
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_oi_history_scrip_date ON oi_history(scrip, date)');
}

export async function insertOiHistoryRows(scrip, rowsToInsert) {
  if (!rowsToInsert.length) return 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const text = `
      INSERT INTO oi_history
        (scrip, date, instrument_token, tradingsymbol, strike, option_type, expiry, open, high, low, close, volume, oi, spot_close)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (scrip, date, instrument_token) DO UPDATE SET
        tradingsymbol = EXCLUDED.tradingsymbol,
        strike        = EXCLUDED.strike,
        option_type   = EXCLUDED.option_type,
        expiry        = EXCLUDED.expiry,
        open          = EXCLUDED.open,
        high          = EXCLUDED.high,
        low           = EXCLUDED.low,
        close         = EXCLUDED.close,
        volume        = EXCLUDED.volume,
        oi            = EXCLUDED.oi,
        spot_close    = EXCLUDED.spot_close
    `;

    for (const r of rowsToInsert) {
      await client.query(text, [
        scrip, r.date, r.instrumentToken, r.tradingsymbol, r.strike ?? null,
        r.optionType ?? null, r.expiry ?? null,
        r.open, r.high, r.low, r.close, r.volume, r.oi, r.spotClose,
      ]);
    }
    await client.query('COMMIT');
    return rowsToInsert.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function mapOiHistoryRow(obj) {
  return {
    date: obj.date,
    instrumentToken: Number(obj.instrument_token),
    tradingsymbol: obj.tradingsymbol,
    strike: obj.strike,
    optionType: obj.option_type,
    expiry: obj.expiry,
    open: obj.open,
    high: obj.high,
    low: obj.low,
    close: obj.close,
    volume: obj.volume === null || obj.volume === undefined ? obj.volume : Number(obj.volume),
    oi: obj.oi === null || obj.oi === undefined ? obj.oi : Number(obj.oi),
    spotClose: obj.spot_close,
  };
}

export async function getOiHistoryData(scrip, fromDate, toDate) {
  let sql = `SELECT date, instrument_token, tradingsymbol, strike, option_type, expiry,
             open, high, low, close, volume, oi, spot_close
             FROM oi_history WHERE scrip = $1`;
  const params = [scrip];

  if (fromDate && toDate) {
    sql += ' AND date >= $2 AND date <= $3';
    params.push(fromDate, toDate);
  } else if (fromDate) {
    sql += ' AND date >= $2';
    params.push(fromDate);
  } else if (toDate) {
    sql += ' AND date <= $2';
    params.push(toDate);
  }

  sql += ' ORDER BY date, strike, option_type';

  const result = await rows(sql, params);
  return result.map(mapOiHistoryRow);
}

export async function getOiHistoryDataByExpiryMonth(scrip, expiryMonth, fromDate = null) {
  let sql = `SELECT date, instrument_token, tradingsymbol, strike, option_type, expiry,
             open, high, low, close, volume, oi, spot_close
             FROM oi_history WHERE scrip = $1 AND expiry LIKE $2 || '%'`;
  const params = [scrip, expiryMonth];

  if (fromDate) {
    sql += ' AND date >= $3';
    params.push(fromDate);
  }

  sql += ' ORDER BY date, strike, option_type';

  const result = await rows(sql, params);
  return result.map(mapOiHistoryRow);
}

export async function getOptionsForAtm(scripName, atmStrike, stepSize = 50, range = 15, { allExpiries = false, targetMonth = '' } = {}) {
  const lowerStrike = atmStrike - range * stepSize;
  const upperStrike = atmStrike + range * stepSize;

  const result = await rows(
    `SELECT instrument_token, tradingsymbol, strike, instrument_type, expiry
     FROM instruments
     WHERE name = $1
       AND exchange = 'NFO'
       AND instrument_type IN ('CE', 'PE')
       AND strike >= $2 AND strike <= $3
     ORDER BY expiry, strike, instrument_type`,
    [scripName, lowerStrike, upperStrike],
  );

  const all = result.map((row) => ({
    instrumentToken: Number(row.instrument_token),
    tradingsymbol: row.tradingsymbol,
    strike: row.strike,
    optionType: row.instrument_type,
    expiry: row.expiry,
  }));

  if (allExpiries) {
    if (targetMonth) {
      return all.filter((r) => r.expiry && r.expiry.startsWith(targetMonth));
    }
    return all;
  }

  const expiries = [...new Set(all.map((r) => r.expiry))].sort();
  const targetExpiry = expiries[0];
  return all.filter((r) => r.expiry === targetExpiry);
}

export async function getOiHistoryDates(scrip, fromDate, toDate, minExpiries = 0) {
  let where = ' WHERE scrip = $1';
  const params = [scrip];
  let n = 2;

  if (fromDate && toDate) {
    where += ` AND date >= $${n++} AND date <= $${n++}`;
    params.push(fromDate, toDate);
  } else if (fromDate) {
    where += ` AND date >= $${n++}`;
    params.push(fromDate);
  } else if (toDate) {
    where += ` AND date <= $${n++}`;
    params.push(toDate);
  }

  if (minExpiries > 0) {
    const sql = `SELECT date, COUNT(DISTINCT expiry) AS ec FROM oi_history${where} GROUP BY date HAVING COUNT(DISTINCT expiry) >= $${n}`;
    params.push(minExpiries);
    const result = await rows(sql, params);
    return new Set(result.map((r) => r.date));
  }

  const sql = `SELECT DISTINCT date FROM oi_history${where}`;
  const result = await rows(sql, params);
  return new Set(result.map((r) => r.date));
}

export async function getOiHistoryDatesForExpiryMonth(scrip, expiryMonth, fromDate, toDate, minExpiries = 0) {
  let where = " WHERE scrip = $1 AND expiry LIKE $2 || '%'";
  const params = [scrip, expiryMonth];
  let n = 3;

  if (fromDate && toDate) {
    where += ` AND date >= $${n++} AND date <= $${n++}`;
    params.push(fromDate, toDate);
  } else if (fromDate) {
    where += ` AND date >= $${n++}`;
    params.push(fromDate);
  } else if (toDate) {
    where += ` AND date <= $${n++}`;
    params.push(toDate);
  }

  if (minExpiries > 0) {
    const sql = `SELECT date, COUNT(DISTINCT expiry) AS ec FROM oi_history${where} GROUP BY date HAVING COUNT(DISTINCT expiry) >= $${n}`;
    params.push(minExpiries);
    const result = await rows(sql, params);
    return new Set(result.map((r) => r.date));
  }

  const sql = `SELECT DISTINCT date FROM oi_history${where}`;
  const result = await rows(sql, params);
  return new Set(result.map((r) => r.date));
}

export async function getOiHistoryMonths(scrip) {
  const result = await rows(
    "SELECT DISTINCT substr(date, 1, 7) AS month FROM oi_history WHERE scrip = $1 ORDER BY month DESC",
    [scrip],
  );
  return result.map((r) => r.month);
}

export async function getStoredOiHistoryExpiryMonths(scrip) {
  const result = await rows(
    `SELECT DISTINCT substr(expiry, 1, 7) AS month
     FROM oi_history
     WHERE scrip = $1 AND expiry IS NOT NULL AND expiry != ''
     ORDER BY month`,
    [scrip],
  );
  return result.map((r) => r.month);
}

export async function getOiHistoryExpiryMonths(scrip, minExpiryDate, limit = 3) {
  const scripName = scrip === 'NIFTY50' ? 'NIFTY' : scrip;
  const result = await rows(
    `SELECT DISTINCT substr(expiry, 1, 7) AS month
     FROM instruments
     WHERE name = $1
       AND exchange = 'NFO'
       AND instrument_type IN ('CE', 'PE')
       AND expiry IS NOT NULL
       AND expiry >= $2
     ORDER BY month
     LIMIT $3`,
    [scripName, minExpiryDate, limit],
  );
  return result.map((r) => r.month);
}

export async function deleteOiHistoryByMonth(month) {
  const res = await query("DELETE FROM oi_history WHERE date LIKE $1 || '%'", [month]);
  return res.rowCount;
}

export async function deleteOiHistoryByScrip(scrip) {
  const res = await query('DELETE FROM oi_history WHERE scrip = $1', [scrip]);
  return res.rowCount;
}

export async function deleteOiHistoryByExpiryMonth(scrip, expiryMonth) {
  const res = await query("DELETE FROM oi_history WHERE scrip = $1 AND expiry LIKE $2 || '%'", [scrip, expiryMonth]);
  return res.rowCount;
}

export async function deleteOiHistoryBeforeExpiryMonth(scrip, cutoffExpiryMonth) {
  const res = await query('DELETE FROM oi_history WHERE scrip = $1 AND substr(expiry, 1, 7) < $2', [scrip, cutoffExpiryMonth]);
  return res.rowCount;
}

export async function deleteOiHistoryByDates(scrip, dates) {
  if (!dates.length) return 0;
  const placeholders = dates.map((_, i) => `$${i + 2}`).join(', ');
  const res = await query(`DELETE FROM oi_history WHERE scrip = $1 AND date IN (${placeholders})`, [scrip, ...dates]);
  return res.rowCount;
}

export async function deleteOiHistoryByDatesForExpiryMonth(scrip, expiryMonth, dates) {
  if (!dates.length) return 0;
  const placeholders = dates.map((_, i) => `$${i + 3}`).join(', ');
  const res = await query(
    `DELETE FROM oi_history WHERE scrip = $1 AND expiry LIKE $2 || '%' AND date IN (${placeholders})`,
    [scrip, expiryMonth, ...dates],
  );
  return res.rowCount;
}

export async function getFnoSymbols() {
  const result = await rows(
    "SELECT DISTINCT name FROM instruments WHERE exchange = 'NFO' AND instrument_type IN ('CE', 'PE') ORDER BY name",
  );
  return result.map((r) => r.name);
}

export async function getSpotToken(name) {
  const row = await firstRow(
    "SELECT instrument_token FROM instruments WHERE tradingsymbol = $1 AND exchange = 'NSE' AND instrument_type = 'EQ' LIMIT 1",
    [name],
  );
  return row ? Number(row.instrument_token) : null;
}

export async function getStrikeStepSize(scripName) {
  const result = await rows(
    `SELECT DISTINCT strike FROM instruments
     WHERE name = $1 AND exchange = 'NFO' AND instrument_type = 'CE' AND strike > 0
     ORDER BY strike LIMIT 20`,
    [scripName],
  );
  if (result.length < 2) return 50;

  const strikes = result.map((r) => r.strike);
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
