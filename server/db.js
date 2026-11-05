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
import { MARKET_TIME_ZONE, marketDayStartMs } from '../shared/marketTime.js';
import { buildDailyPnlQuery, buildPositionsQuery, buildStatsQueries } from './positionsQuery.js';
import { withDefaults } from '../shared/automation.js';

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

/** Run a query against the pool. For nightly JS jobs; app code uses the named helpers. */
export { query };

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
    price: Number(row.plan_price ?? row.price ?? 0),
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

/** Add a plan's duration to a base date and return a new Date. */
function addPlanDuration(fromDate, durationCount, durationUnit) {
  const d = new Date(fromDate.getTime());
  const count = Math.max(1, parseInt(durationCount, 10) || 1);

  switch (durationUnit) {
    case 'day':
      d.setDate(d.getDate() + count);
      break;
    case 'week':
      d.setDate(d.getDate() + count * 7);
      break;
    case 'month':
      d.setMonth(d.getMonth() + count);
      break;
    case 'year':
      d.setFullYear(d.getFullYear() + count);
      break;
    default:
      d.setMonth(d.getMonth() + count);
      break;
  }

  return d;
}

function getPlanExpiryDate(durationCount, durationUnit) {
  return addPlanDuration(new Date(), durationCount, durationUnit);
}

/** Parse a stored 'YYYY-MM-DD HH:MI:SS' timestamp into a Date. */
function parseDbTimestamp(value) {
  if (!value) return null;
  const d = new Date(value.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
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
// Admin: subscription management & user listing
// ---------------------------------------------------------------------------

/** Upsert the user's single subscription row with explicit dates/status. */
async function setUserSubscription(userId, planId, startsAt, expiresAt, status, provider = 'admin') {
  const existing = await firstRow(
    'SELECT id FROM subscriptions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [userId],
  );

  if (existing) {
    await query(
      `UPDATE subscriptions SET
         plan_id = $1, status = $2, starts_at = $3, expires_at = $4, provider = $5,
         updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
       WHERE id = $6`,
      [planId, status, startsAt, expiresAt, provider, existing.id],
    );
  } else {
    await query(
      `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at, provider, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`,
      [crypto.randomUUID(), userId, planId, status, startsAt, expiresAt, provider],
    );
  }

  return getUserSubscription(userId);
}

async function requirePlan(planId) {
  const plan = await firstRow(
    'SELECT id, duration_count, duration_unit FROM subscription_plans WHERE id = $1 AND is_active = 1',
    [planId],
  );
  if (!plan) throw new Error('Subscription plan not found');
  return plan;
}

/** Activate a fresh subscription from now. */
export async function adminActivateSubscription(userId, planId) {
  const plan = await requirePlan(planId);
  const startsAt = formatDbTimestamp(new Date());
  const expiresAt = formatDbTimestamp(getPlanExpiryDate(plan.duration_count, plan.duration_unit));
  return setUserSubscription(userId, planId, startsAt, expiresAt, 'active');
}

/** Extend from the current expiry if still in the future, otherwise from now. */
export async function adminExtendSubscription(userId, planId) {
  const plan = await requirePlan(planId);
  const current = await getUserSubscription(userId);

  const currentExpiry = current ? parseDbTimestamp(current.expiresAt) : null;
  const base = currentExpiry && currentExpiry.getTime() > Date.now() ? currentExpiry : new Date();

  const startsAt = current?.startsAt || formatDbTimestamp(new Date());
  const expiresAt = formatDbTimestamp(addPlanDuration(base, plan.duration_count, plan.duration_unit));
  return setUserSubscription(userId, planId, startsAt, expiresAt, 'active');
}

/** Cancel the user's subscription (keeps dates, marks status cancelled). */
export async function adminCancelSubscription(userId) {
  const existing = await firstRow(
    'SELECT id FROM subscriptions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [userId],
  );
  if (!existing) return null;

  await query(
    `UPDATE subscriptions SET status = 'cancelled', updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
     WHERE id = $1`,
    [existing.id],
  );
  return getUserSubscription(userId);
}

/** List all registered users with subscription, last login and feedback count. */
export async function getAdminUsers() {
  const result = await rows(
    `SELECT
       u.user_id,
       u.user_name,
       u.is_admin,
       u.updated_at AS last_login,
       (SELECT COUNT(*) FROM feedback f WHERE f.user_id = u.user_id)::int AS feedback_count,
       s.status       AS sub_status,
       s.expires_at   AS sub_expires,
       s.plan_id      AS sub_plan_id,
       p.name         AS sub_plan_name,
       p.duration_count AS sub_duration_count,
       p.duration_unit  AS sub_duration_unit
     FROM users u
     LEFT JOIN LATERAL (
       SELECT * FROM subscriptions s2 WHERE s2.user_id = u.user_id ORDER BY s2.updated_at DESC LIMIT 1
     ) s ON TRUE
     LEFT JOIN subscription_plans p ON p.id = s.plan_id
     WHERE u.is_admin = 0
     ORDER BY u.updated_at DESC
     LIMIT 500`,
  );

  return result.map((row) => {
    const expiry = row.sub_expires || null;
    const expired = expiry ? new Date(String(expiry).replace(' ', 'T')).getTime() <= Date.now() : false;
    const status = expired && row.sub_status === 'active' ? 'expired' : (row.sub_status || 'inactive');

    return {
      userId: row.user_id,
      userName: row.user_name || null,
      isAdmin: Boolean(row.is_admin),
      lastLogin: row.last_login || null,
      feedbackCount: row.feedback_count || 0,
      subscription: {
        status,
        active: row.sub_status === 'active' && !expired,
        planId: row.sub_plan_id || null,
        planName: row.sub_plan_name || null,
        expiresAt: expiry,
        durationCount: row.sub_duration_count != null ? Number(row.sub_duration_count) : null,
        durationUnit: row.sub_duration_unit || null,
      },
    };
  });
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

export async function getFeedbackCounts() {
  const row = await firstRow(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'open')::int AS open
     FROM feedback`,
  );

  return { total: row?.total || 0, open: row?.open || 0 };
}

// ---------------------------------------------------------------------------
// Diagnostics (admin health page)
// ---------------------------------------------------------------------------

/** Simple connectivity probe — resolves true if the DB answers a trivial query. */
export async function pingDb() {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** Total registered users and count of currently-active (non-expired) sessions. */
export async function getUsageStats() {
  const sessions = await firstRow(
    'SELECT COUNT(*) FILTER (WHERE expires > $1)::int AS active FROM sessions',
    [Date.now()],
  );
  const users = await firstRow('SELECT COUNT(*)::int AS total FROM users');

  return {
    activeSessions: sessions?.active || 0,
    totalUsers: users?.total || 0,
  };
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
  // Kept in its own column so admin sessions can be found without parsing every session.
  const isAdmin = sessionData?.kiteSession?.isAdmin === true;

  await query(
    `INSERT INTO sessions (sid, data, expires, is_admin) VALUES ($1, $2, $3, $4)
     ON CONFLICT (sid) DO UPDATE SET data = EXCLUDED.data, expires = EXCLUDED.expires, is_admin = EXCLUDED.is_admin`,
    [sid, data, expires, isAdmin],
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
  // After the last item; the count can collide with an existing position once items are removed or moved.
  const lastRow = await firstRow('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM watchlist_items WHERE watchlist_id = $1', [watchlistId]);
  const sortOrder = Number(lastRow.max_order) + 1;

  await query(
    `INSERT INTO watchlist_items (id, watchlist_id, instrument_token, tradingsymbol, exchange, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, watchlistId, instrumentToken, tradingsymbol, exchange || 'NSE', sortOrder],
  );

  return { id, instrumentToken, tradingsymbol, exchange: exchange || 'NSE', sortOrder };
}

/**
 * Put a watchlist's items in the given order. `itemIds` must list every item in
 * the list exactly once; returns false otherwise or when the list isn't the user's.
 */
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

// ---------------------------------------------------------------------------
// Price alerts (per user)
// ---------------------------------------------------------------------------

const PRICE_ALERT_COLUMNS = `id, instrument_token, tradingsymbol, exchange, condition, value, note,
  browser_notification, status, triggered_at, triggered_price, created_at`;

function toPriceAlert(row) {
  return {
    id: row.id,
    instrumentToken: Number(row.instrument_token),
    tradingsymbol: row.tradingsymbol,
    exchange: row.exchange,
    condition: row.condition,
    value: Number(row.value),
    note: row.note ?? undefined,
    browserNotification: row.browser_notification,
    status: row.status,
    triggeredAt: row.triggered_at ? row.triggered_at.toISOString() : undefined,
    triggeredPrice: row.triggered_price === null ? undefined : Number(row.triggered_price),
    createdAt: row.created_at.toISOString(),
  };
}

/** The user's alerts, newest first. */
export async function getPriceAlerts(userId) {
  const result = await rows(
    `SELECT ${PRICE_ALERT_COLUMNS} FROM price_alerts WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return result.map(toPriceAlert);
}

export async function createPriceAlert(userId, { instrumentToken, tradingsymbol, exchange, condition, value, note, browserNotification }) {
  const row = await firstRow(
    `INSERT INTO price_alerts (id, user_id, instrument_token, tradingsymbol, exchange, condition, value, note, browser_notification)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${PRICE_ALERT_COLUMNS}`,
    [crypto.randomUUID(), userId, instrumentToken, tradingsymbol, exchange, condition, value, note, browserNotification],
  );
  return toPriceAlert(row);
}

/** Mark an active alert triggered; null if it isn't the user's or already triggered. */
export async function triggerPriceAlert(id, userId, price) {
  const row = await firstRow(
    `UPDATE price_alerts SET status = 'triggered', triggered_at = now(), triggered_price = $3
     WHERE id = $1 AND user_id = $2 AND status = 'active'
     RETURNING ${PRICE_ALERT_COLUMNS}`,
    [id, userId, price],
  );
  return row ? toPriceAlert(row) : null;
}

/** Make a triggered alert active again; null if it isn't the user's. */
export async function resetPriceAlert(id, userId) {
  const row = await firstRow(
    `UPDATE price_alerts SET status = 'active', triggered_at = NULL, triggered_price = NULL
     WHERE id = $1 AND user_id = $2
     RETURNING ${PRICE_ALERT_COLUMNS}`,
    [id, userId],
  );
  return row ? toPriceAlert(row) : null;
}

export async function deletePriceAlert(id, userId) {
  const res = await query('DELETE FROM price_alerts WHERE id = $1 AND user_id = $2', [id, userId]);
  return res.rowCount > 0;
}

// ---------------------------------------------------------------------------
// Trade automation (per user; see shared/automation.js)
// ---------------------------------------------------------------------------

/** The user's automation configuration, or the defaults if none is saved. */
export async function getAutomationConfig(userId) {
  const row = await firstRow('SELECT config FROM automation_configs WHERE user_id = $1', [userId]);
  return withDefaults(row?.config);
}

/** Store a configuration already checked by parseAutomationConfig. */
export async function saveAutomationConfig(userId, config) {
  const row = await firstRow(
    `INSERT INTO automation_configs (user_id, config, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()
     RETURNING config`,
    [userId, JSON.stringify(config)],
  );
  return withDefaults(row.config);
}

function toAutoTrade(row) {
  return {
    id: row.id,
    horizon: row.horizon,
    kind: row.kind,
    mode: row.mode,
    tradingsymbol: row.tradingsymbol,
    instrumentToken: Number(row.instrument_token),
    side: row.side,
    quantity: Number(row.quantity),
    stage: row.stage,
    reason: row.reason,
    entryPrice: row.entry_price,
    exitPrice: row.exit_price,
    positionId: row.position_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    events: (row.events ?? []).map((e) => ({ stage: e.stage, at: e.at, detail: e.detail })),
  };
}

/** The user's latest automated trades, newest first, each with its lifecycle events in order. */
export async function getAutoTrades(userId, limit = 50) {
  const result = await rows(
    `SELECT t.*,
       COALESCE((SELECT json_agg(json_build_object('stage', e.stage, 'at', e.at, 'detail', e.detail) ORDER BY e.at, e.id)
                 FROM auto_trade_events e WHERE e.auto_trade_id = t.id), '[]'::json) AS events
     FROM auto_trades t WHERE t.user_id = $1
     ORDER BY t.created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return result.map(toAutoTrade);
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

/**
 * Insert rows with multi-row INSERT statements (one round trip per batch rather
 * than per row). `rowValues` is an array of per-row value arrays in column order;
 * `suffix` is the trailing ON CONFLICT clause. With ON CONFLICT DO UPDATE the
 * caller must de-duplicate rows by the conflict key first — Postgres rejects a
 * statement that would update the same row twice.
 */
async function insertInBatches(client, insertPrefix, suffix, rowValues, batchSize = 1000) {
  if (!rowValues.length) return;
  const columnCount = rowValues[0].length;
  for (let i = 0; i < rowValues.length; i += batchSize) {
    const batch = rowValues.slice(i, i + batchSize);
    const placeholders = batch.map((_, rowIndex) => {
      const base = rowIndex * columnCount;
      return `(${Array.from({ length: columnCount }, (_, col) => `$${base + col + 1}`).join(', ')})`;
    });
    await client.query(`${insertPrefix} VALUES ${placeholders.join(', ')} ${suffix}`, batch.flat());
  }
}

/** Keep the last row per key, matching what sequential upserts would leave behind. */
function lastPerKey(items, keyOf) {
  return [...new Map(items.map((item) => [keyOf(item), item])).values()];
}

/** Keep the first row per key, matching what ON CONFLICT DO NOTHING inserts would keep. */
function firstPerKey(items, keyOf) {
  const byKey = new Map();
  for (const item of items) if (!byKey.has(keyOf(item))) byKey.set(keyOf(item), item);
  return [...byKey.values()];
}

/**
 * Our own columns on an underlying's price row (migration 017). The sync keeps
 * them, and resets them to their defaults when Zerodha gives a token to a
 * different tradingsymbol, so a setting never moves to another instrument.
 */
const UNDERLYING_COLUMN_DEFAULTS = {
  fno_name: 'NULL',
  label: 'NULL',
  tradingview_symbol: 'NULL',
  always_snapshot: 'false',
  is_market_reference: 'false',
};

/**
 * Sync the instruments table to Zerodha's latest list, in one transaction:
 * update rows whose token is still listed, add new tokens, and delete tokens
 * no longer listed (expired contracts, delisted stocks). Rows are updated in
 * place rather than the table being wiped, so readers never see it empty.
 * `stamp` is stored as the load marker (see instruments.js).
 *
 * @returns {Promise<{ added: number, updated: number, removed: number }>}
 */
export async function saveInstruments(instruments, stamp) {
  const rowsToSave = firstPerKey(instruments, (inst) => inst.instrumentToken);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Multi-row statements: row-by-row writes of the full NSE + NFO list took
    // minutes on a hosted DB, blocking every request that waits on instruments.
    // Unchanged rows are skipped by the WHERE, so a normal day writes little.
    // xmax = 0 marks a freshly inserted row, which tells added from updated.
    let added = 0;
    let updated = 0;
    const columnCount = 9;
    for (let i = 0; i < rowsToSave.length; i += 1000) {
      const batch = rowsToSave.slice(i, i + 1000);
      const placeholders = batch.map((_, r) => `(${Array.from({ length: columnCount }, (_, c) => `$${r * columnCount + c + 1}`).join(', ')})`);
      const result = await client.query(
        `INSERT INTO instruments
           (instrument_token, exchange_token, tradingsymbol, name, exchange, instrument_type, strike, expiry, lot_size)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (instrument_token) DO UPDATE SET
           exchange_token = EXCLUDED.exchange_token,
           tradingsymbol = EXCLUDED.tradingsymbol,
           name = EXCLUDED.name,
           exchange = EXCLUDED.exchange,
           instrument_type = EXCLUDED.instrument_type,
           strike = EXCLUDED.strike,
           expiry = EXCLUDED.expiry,
           lot_size = EXCLUDED.lot_size,
           ${Object.entries(UNDERLYING_COLUMN_DEFAULTS).map(([col, reset]) => `${col} = CASE WHEN instruments.tradingsymbol = EXCLUDED.tradingsymbol THEN instruments.${col} ELSE ${reset} END`).join(',\n           ')}
         WHERE (instruments.exchange_token, instruments.tradingsymbol, instruments.name, instruments.exchange,
                instruments.instrument_type, instruments.strike, instruments.expiry, instruments.lot_size)
           IS DISTINCT FROM
               (EXCLUDED.exchange_token, EXCLUDED.tradingsymbol, EXCLUDED.name, EXCLUDED.exchange,
                EXCLUDED.instrument_type, EXCLUDED.strike, EXCLUDED.expiry, EXCLUDED.lot_size)
         RETURNING (xmax = 0) AS inserted`,
        batch.flatMap((inst) => [
          inst.instrumentToken,
          inst.exchangeToken,
          inst.tradingsymbol,
          inst.name,
          inst.exchange,
          inst.instrumentType || 'EQ',
          inst.strike || null,
          inst.expiry || null,
          inst.lotSize || null,
        ]),
      );
      for (const row of result.rows) {
        if (row.inserted) added++;
        else updated++;
      }
    }

    const removed = await client.query(
      'DELETE FROM instruments WHERE NOT (instrument_token = ANY($1::bigint[]))',
      [rowsToSave.map((inst) => inst.instrumentToken)],
    );

    await client.query(
      "INSERT INTO instruments_meta (key, value) VALUES ('last_fetched_date', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [stamp],
    );
    await client.query('COMMIT');
    return { added, updated, removed: removed.rowCount };
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

/**
 * List a user's positions. By default, open positions plus those exited
 * today; with status 'closed', a filtered page of exited positions. The
 * filter comes from parsePositionsQuery (positionsQuery.js).
 */
export async function getPositions(userId, filter = {}) {
  const todayStart = new Date(getTodayMidnight()).toISOString();
  const { sql, params } = buildPositionsQuery(userId, { ...filter, todayStart });
  const result = await rows(sql, params);
  return result.map(mapPositionRow);
}

/**
 * P&L and trade count per market-zone exit day, newest first.
 * The filter comes from parseDailyPnlQuery (positionsQuery.js).
 * @returns {Promise<{ date: string, pnl: number, trades: number }[]>}
 */
export async function getDailyPnl(userId, filter) {
  const { sql, params } = buildDailyPnlQuery(userId, filter);
  const result = await rows(sql, params);
  return result.map((row) => ({ date: row.date, pnl: Number(row.pnl), trades: Number(row.trades) }));
}

/** All-time win/loss figures over a user's exited positions. */
export async function getPositionStats(userId, { mode = null } = {}) {
  const todayStart = new Date(getTodayMidnight()).toISOString();
  const queries = buildStatsQueries(userId, { mode, todayStart });
  const [summary, best, worst] = await Promise.all([
    firstRow(queries.summary.sql, queries.summary.params),
    firstRow(queries.best.sql, queries.best.params),
    firstRow(queries.worst.sql, queries.worst.params),
  ]);
  return {
    closedTrades: Number(summary.closed_trades),
    winningTrades: Number(summary.winning_trades),
    losingTrades: Number(summary.losing_trades),
    avgWin: summary.avg_win === null ? 0 : Number(summary.avg_win),
    avgLoss: summary.avg_loss === null ? 0 : Number(summary.avg_loss),
    todayTrades: Number(summary.today_trades),
    bestTrade: best ? mapPositionRow(best) : null,
    worstTrade: worst ? mapPositionRow(worst) : null,
  };
}

function mapPositionRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    mode: row.mode,
    tradingsymbol: row.tradingsymbol,
    instrumentToken: Number(row.instrument_token),
    instrumentType: row.instrument_type,
    exchange: row.exchange,
    source: row.source,
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

/**
 * Strike, option type and expiry as stored for each instrument type: options
 * keep all three, futures only the expiry, stocks none.
 */
function instrumentColumns(position) {
  const type = position.instrumentType;
  const isOption = type === 'CE' || type === 'PE';
  return {
    strike: isOption ? position.strike : null,
    optionType: isOption ? type : null,
    expiry: isOption || type === 'FUT' ? position.expiry : null,
  };
}

/** Insert one new open position of `quantity` and return it. */
async function insertPosition(userId, mode, position, quantity, now) {
  const { strike, optionType, expiry } = instrumentColumns(position);
  const row = await firstRow(
    `INSERT INTO positions (id, user_id, mode, source, tradingsymbol, instrument_token, instrument_type, exchange, strike, option_type,
       side, quantity, entry_price, entry_time, expiry, note, target_price, stop_loss_price, strategy_tag, confidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     RETURNING *`,
    [crypto.randomUUID(), userId, mode, position.source || 'manual', position.tradingsymbol, position.instrumentToken,
     position.instrumentType, position.exchange, strike, optionType, position.side, quantity, position.entryPrice, now, expiry,
     ...positionMetaValues(position)],
  );
  return mapPositionRow(row);
}

/**
 * Open a position. A trade merges with the user's open position in the same
 * instrument from the same source: the same side averages in, the opposite
 * side nets out. Manual trades merge with manual positions and automated
 * trades (source 'auto') with automated ones, so 100 bought by the automation
 * then 500 more shows as one automated position of 600, and the automation
 * never changes a manual position (or the other way round).
 */
export async function addPosition(userId, position) {
  const mode = position.mode || 'paper';
  const source = position.source || 'manual';
  const now = new Date().toISOString();

  const openSameSource = (side) => firstRow(
    `SELECT * FROM positions
     WHERE user_id = $1 AND mode = $2 AND instrument_token = $3 AND side = $4 AND exited = 0 AND source = $5`,
    [userId, mode, position.instrumentToken, side, source],
  );

  // Same-side existing → average in
  const sameSide = await openSameSource(position.side);

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
  const opposite = await openSameSource(position.side === 'BUY' ? 'SELL' : 'BUY');

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
    return insertPosition(userId, mode, position, position.quantity - oppQty, now);
  }

  // No existing — open fresh
  return insertPosition(userId, mode, position, position.quantity, now);
}

/** One of a user's open positions, or null if there's no such open position. */
export async function getOpenPosition(id, userId) {
  const row = await firstRow('SELECT * FROM positions WHERE id = $1 AND user_id = $2 AND exited = 0', [id, userId]);
  return row ? mapPositionRow(row) : null;
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

/** Epoch ms of market-zone midnight starting the day that contains `timestamp` (default: now). */
function getTodayMidnight(timestamp = Date.now()) {
  return marketDayStartMs(timestamp);
}

function roundTo10Min(timestamp) {
  const TEN_MIN = 10 * 60 * 1000;
  return Math.floor(timestamp / TEN_MIN) * TEN_MIN;
}

/** The per-token maps a snapshot row holds beside OI (`data`): field → column. */
const OI_SNAPSHOT_MAPS = {
  prices: 'prices',
  close: 'close',
  volumes: 'volumes',
  bids: 'bids',
  asks: 'asks',
  tradeTimes: 'trade_times',
};
const OI_SNAPSHOT_MAP_COLUMNS = Object.values(OI_SNAPSHOT_MAPS);

const parseJsonMap = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

export async function saveOiSnapshot(snapshot) {
  const rounded = roundTo10Min(snapshot.timestamp);
  const newData = parseJsonMap(snapshot.data);
  const newMaps = Object.keys(OI_SNAPSHOT_MAPS).map((field) => (snapshot[field] ? parseJsonMap(snapshot[field]) : null));
  const newSpot = snapshot.spot || null;

  // All users' snapshots for a given 10-min slot merge into ONE shared row.
  // Serialize the read-modify-write per slot (cross-process) so concurrent
  // watchers on the same/different scrips can't lose each other's tokens.
  await withNamedAdvisoryLock(`oi-snapshot:${rounded}`, async () => {
    const existing = await firstRow(
      `SELECT id, data, spot, ${OI_SNAPSHOT_MAP_COLUMNS.join(', ')} FROM oi_snapshots WHERE timestamp = $1`,
      [rounded],
    );

    if (existing) {
      const data = { ...JSON.parse(existing.data), ...newData };
      const maps = OI_SNAPSHOT_MAP_COLUMNS.map((column, i) => {
        const merged = { ...(existing[column] ? JSON.parse(existing[column]) : {}), ...(newMaps[i] ?? {}) };
        return Object.keys(merged).length > 0 ? JSON.stringify(merged) : null;
      });
      const sets = OI_SNAPSHOT_MAP_COLUMNS.map((column, i) => `${column} = $${i + 3}`).join(', ');
      await query(
        `UPDATE oi_snapshots SET data = $1, spot = $2, ${sets} WHERE id = $${OI_SNAPSHOT_MAP_COLUMNS.length + 3}`,
        [JSON.stringify(data), newSpot || existing.spot || null, ...maps, existing.id],
      );
    } else {
      const columns = ['data', 'spot', ...OI_SNAPSHOT_MAP_COLUMNS];
      const placeholders = columns.map((_, i) => `$${i + 3}`).join(', ');
      await query(
        `INSERT INTO oi_snapshots (timestamp, time_label, ${columns.join(', ')})
         VALUES ($1, $2, ${placeholders})
         ON CONFLICT (timestamp) DO UPDATE SET ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(', ')}`,
        [rounded, snapshot.timeLabel, JSON.stringify(newData), newSpot, ...newMaps.map((map) => (map ? JSON.stringify(map) : null))],
      );
    }
  });
}

export async function getTodayOiSnapshots() {
  const maxRow = await firstRow('SELECT MAX(timestamp) AS max_ts FROM oi_snapshots');
  if (!maxRow || maxRow.max_ts === null) return [];

  // The newest snapshot's IST day, independent of the server's own time zone.
  const midnightMs = getTodayMidnight(Number(maxRow.max_ts));

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

export async function getLatestOiSnapshotTimestamp() {
  const row = await firstRow(
    'SELECT MAX(timestamp) AS ts FROM oi_snapshots WHERE timestamp >= $1',
    [getTodayMidnight()],
  );
  return row && row.ts !== null ? Number(row.ts) : null;
}

/** Instrument tokens (as strings) with OI in any of today's snapshots. */
export async function getTodayOiSnapshotTokens() {
  const result = await rows(
    'SELECT DISTINCT jsonb_object_keys(data::jsonb) AS token FROM oi_snapshots WHERE timestamp >= $1',
    [getTodayMidnight()],
  );
  return result.map((r) => r.token);
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
  await query(`
    CREATE TABLE IF NOT EXISTS oi_history_futures (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      scrip TEXT NOT NULL, expiry TEXT NOT NULL, date TEXT NOT NULL,
      instrument_token BIGINT NOT NULL, tradingsymbol TEXT NOT NULL,
      open DOUBLE PRECISION, high DOUBLE PRECISION, low DOUBLE PRECISION,
      close DOUBLE PRECISION, volume BIGINT, oi BIGINT,
      UNIQUE(scrip, expiry, date)
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS idx_oi_history_futures_scrip_expiry ON oi_history_futures(scrip, expiry, date)');
}

export async function insertOiHistoryFuturesRows(scrip, rowsToInsert) {
  if (!rowsToInsert.length) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertInBatches(
      client,
      `INSERT INTO oi_history_futures
        (scrip, expiry, date, instrument_token, tradingsymbol, open, high, low, close, volume, oi)`,
      `ON CONFLICT (scrip, expiry, date) DO UPDATE SET
        instrument_token = EXCLUDED.instrument_token, tradingsymbol = EXCLUDED.tradingsymbol,
        open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
        close = EXCLUDED.close, volume = EXCLUDED.volume, oi = EXCLUDED.oi`,
      lastPerKey(rowsToInsert, (row) => `${row.expiry}|${row.date}`).map((row) => [
        scrip, row.expiry, row.date, row.instrumentToken, row.tradingsymbol,
        row.open, row.high, row.low, row.close, row.volume, row.oi,
      ]),
    );
    await client.query('COMMIT');
    return rowsToInsert.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}

export async function getOiHistoryFuturesData(scrip, expiryMonth, fromDate = null) {
  let sql = `SELECT date, instrument_token, tradingsymbol, expiry, open, high, low, close, volume, oi
             FROM oi_history_futures WHERE scrip = $1 AND expiry LIKE $2 || '%'`;
  const params = [scrip, expiryMonth];
  if (fromDate) { sql += ' AND date >= $3'; params.push(fromDate); }
  sql += ' ORDER BY date';
  const result = await rows(sql, params);
  return result.map((row) => ({
    date: row.date, instrumentToken: Number(row.instrument_token), tradingsymbol: row.tradingsymbol,
    expiry: row.expiry, open: row.open, high: row.high, low: row.low, close: row.close,
    volume: row.volume == null ? row.volume : Number(row.volume), oi: row.oi == null ? row.oi : Number(row.oi),
  }));
}

export async function insertOiHistoryRows(scrip, rowsToInsert) {
  if (!rowsToInsert.length) return 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const conflictClause = `
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

    await insertInBatches(
      client,
      `INSERT INTO oi_history
        (scrip, date, instrument_token, tradingsymbol, strike, option_type, expiry, open, high, low, close, volume, oi, spot_close)`,
      conflictClause,
      lastPerKey(rowsToInsert, (r) => `${r.date}|${r.instrumentToken}`).map((r) => [
        scrip, r.date, r.instrumentToken, r.tradingsymbol, r.strike ?? null,
        r.optionType ?? null, r.expiry ?? null,
        r.open, r.high, r.low, r.close, r.volume, r.oi, r.spotClose,
      ]),
    );
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

export async function saveTradeSetupSignal(userId, signal) {
  const row = await firstRow(
    `INSERT INTO trade_setup_signals
      (user_id, scrip, signal_date, expiry, strike, option_type, action, status, entry_premium, spot_price, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (user_id, scrip, signal_date, expiry, strike, option_type, action)
     DO UPDATE SET status = EXCLUDED.status,
                   entry_premium = EXCLUDED.entry_premium,
                   spot_price = EXCLUDED.spot_price,
                   -- Merge so a re-log without the OI pattern keeps the one recorded earlier.
                   details = trade_setup_signals.details || EXCLUDED.details
     RETURNING id, signal_date, strike, option_type, action, status`,
    [userId, signal.scrip, signal.signalDate, signal.expiry || null, signal.strike,
      signal.optionType, signal.action, signal.status, signal.entryPremium ?? null,
      signal.spotPrice ?? null, JSON.stringify(signal.details || {})],
  );
  return row;
}

export async function getTradeSetupSignals(userId, { scrip = null, limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  if (scrip) {
    return rows(
      `SELECT * FROM trade_setup_signals WHERE user_id = $1 AND scrip = $2 AND deleted_at IS NULL
       ORDER BY signal_date DESC, created_at DESC LIMIT $3`,
      [userId, scrip, safeLimit],
    );
  }
  return rows(
    `SELECT * FROM trade_setup_signals WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY signal_date DESC, created_at DESC LIMIT $2`,
    [userId, safeLimit],
  );
}

/** Hide one of the user's signals from the grid and stats. Returns false if it wasn't theirs or is already deleted. */
export async function deleteTradeSetupSignal(userId, signalId) {
  const row = await firstRow(
    `UPDATE trade_setup_signals SET deleted_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [signalId, userId],
  );
  return Boolean(row);
}

export async function updateTradeSetupSignalOutcome(userId, signalId, outcome) {
  return firstRow(
    `UPDATE trade_setup_signals
     SET outcome_price = $1, outcome_date = $2, outcome_return = $3, outcome_status = $4,
         max_favorable_return = $5, max_adverse_return = $6, outcome_final = $7
     WHERE id = $8 AND user_id = $9
     RETURNING id, outcome_price, outcome_date, outcome_return, outcome_status,
               max_favorable_return, max_adverse_return, outcome_final`,
    [outcome.price, outcome.date, outcome.returnPct, outcome.status,
      outcome.maxFavorableReturn, outcome.maxAdverseReturn, outcome.final, signalId, userId],
  );
}

/**
 * Mark-to-market every open trade setup signal (all users) from stored OI
 * history. Runs on the server so signals are scored even when nobody opens
 * that strike in the browser.
 *
 * The price path starts at the signal date's close. Once the latest stored
 * date for the scrip reaches the expiry, the signal is final. If the option's
 * own expiry-day close was never stored (the contract drops out of the
 * instruments list after expiry, so a later fetch can't get it), the expiry
 * price falls back to intrinsic value from that day's stored spot close.
 */
export async function evaluateTradeSetupSignalOutcomes(scrip = null) {
  const signals = await rows(
    `SELECT id, scrip, signal_date, expiry, strike, option_type, action, entry_premium
     FROM trade_setup_signals
     WHERE NOT outcome_final AND expiry IS NOT NULL AND entry_premium > 0 AND deleted_at IS NULL
       ${scrip ? 'AND scrip = $1' : ''}`,
    scrip ? [scrip] : [],
  );
  if (signals.length === 0) return 0;

  const latestByScrip = new Map();
  const latestDateFor = async (name) => {
    if (!latestByScrip.has(name)) {
      const row = await firstRow('SELECT MAX(date) AS date FROM oi_history WHERE scrip = $1', [name]);
      latestByScrip.set(name, row?.date || null);
    }
    return latestByScrip.get(name);
  };

  let updated = 0;
  for (const signal of signals) {
    const latestDate = await latestDateFor(signal.scrip);
    if (!latestDate || latestDate < signal.signal_date) continue;

    const path = (await rows(
      `SELECT date, close FROM oi_history
       WHERE scrip = $1 AND expiry = $2 AND strike = $3 AND option_type = $4
         AND date >= $5 AND date <= $2 AND close > 0
       ORDER BY date`,
      [signal.scrip, signal.expiry, signal.strike, signal.option_type, signal.signal_date],
    )).map((row) => ({ date: row.date, price: Number(row.close) }));

    const expired = latestDate >= signal.expiry;
    let settled = path.some((point) => point.date === signal.expiry);
    if (expired && !settled) {
      const spotRow = await firstRow(
        'SELECT MAX(spot_close) AS spot FROM oi_history WHERE scrip = $1 AND date = $2 AND spot_close > 0',
        [signal.scrip, signal.expiry],
      );
      const spot = Number(spotRow?.spot);
      if (spot > 0) {
        const strike = Number(signal.strike);
        const intrinsic = signal.option_type === 'CE' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
        path.push({ date: signal.expiry, price: intrinsic });
        settled = true;
      }
    }

    // The first point is the entry day; without a later price there is nothing to measure.
    if (path.length < 2) continue;

    const entry = Number(signal.entry_premium);
    const returns = path.map(({ price }) => {
      const raw = ((price - entry) / entry) * 100;
      return signal.action === 'SELL' ? -raw : raw;
    });
    const last = path[path.length - 1];
    const returnPct = returns[returns.length - 1];
    const final = expired && settled;
    await query(
      `UPDATE trade_setup_signals
       SET outcome_price = $1, outcome_date = $2, outcome_return = $3, outcome_status = $4,
           max_favorable_return = $5, max_adverse_return = $6, outcome_final = $7
       WHERE id = $8`,
      [last.price, last.date, returnPct, final ? (returnPct > 0 ? 'Profit' : 'Loss') : 'Open',
        Math.max(...returns), Math.min(...returns), final, signal.id],
    );
    updated += 1;
  }
  return updated;
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

export async function getOptionsForStrikes(scripName, strikes, { targetMonth = '' } = {}) {
  const uniqueStrikes = [...new Set(strikes.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (uniqueStrikes.length === 0) return [];

  let sql = `SELECT instrument_token, tradingsymbol, strike, instrument_type, expiry
     FROM instruments
     WHERE name = $1
       AND exchange = 'NFO'
       AND instrument_type IN ('CE', 'PE')
       AND strike = ANY($2::double precision[])`;
  const params = [scripName, uniqueStrikes];

  if (targetMonth) {
    sql += ' AND expiry LIKE $3 || \'%\'';
    params.push(targetMonth);
  }

  sql += ' ORDER BY expiry, strike, instrument_type';

  const result = await rows(sql, params);
  return result.map((row) => ({
    instrumentToken: Number(row.instrument_token),
    tradingsymbol: row.tradingsymbol,
    strike: row.strike,
    optionType: row.instrument_type,
    expiry: row.expiry,
  }));
}

export async function getStoredOiHistoryStrikes(scrip, expiryMonth) {
  const result = await rows(
    `SELECT DISTINCT strike
     FROM oi_history
     WHERE scrip = $1
       AND expiry LIKE $2 || '%'
       AND strike IS NOT NULL
     ORDER BY strike`,
    [scrip, expiryMonth],
  );
  return result.map((r) => Number(r.strike)).filter(Number.isFinite);
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

/** Scrips with OI history stored on or after `sinceDate` (YYYY-MM-DD) — the ones being tracked. */
export async function getRecentOiHistoryScrips(sinceDate) {
  const result = await rows(
    'SELECT DISTINCT scrip FROM oi_history WHERE date >= $1 ORDER BY scrip',
    [sinceDate],
  );
  return result.map((r) => r.scrip);
}

// ---------------------------------------------------------------------------
// Scheduled jobs
// ---------------------------------------------------------------------------

/**
 * Kite sessions of admins that haven't expired, newest login first. Scheduled
 * jobs fetch shared market data with an admin's token, never another user's.
 */
export async function getAdminKiteSessions() {
  // Only admin sessions are read (sessions_admin_idx), not every user's.
  const result = await rows('SELECT data FROM sessions WHERE is_admin AND expires > $1', [Date.now()]);
  return result
    .map((r) => {
      try {
        return JSON.parse(r.data)?.kiteSession;
      } catch {
        return null;
      }
    })
    .filter((kite) => kite?.isAdmin && kite.apiKey && kite.accessToken)
    .sort((a, b) => String(b.loginTime || '').localeCompare(String(a.loginTime || '')));
}

/**
 * Claim today's run of a job. Returns false when it already finished, or is
 * running elsewhere and started within the last two hours. A failed or
 * stale run is claimed again.
 */
export async function claimScheduledJobRun(job, runDate) {
  const row = await firstRow(
    `INSERT INTO scheduled_job_runs (job, run_date, status)
     VALUES ($1, $2, 'running')
     ON CONFLICT (job, run_date) DO UPDATE
       SET status = 'running', detail = '{}'::jsonb, finished_at = NULL,
           started_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
     WHERE scheduled_job_runs.status = 'failed'
        OR (scheduled_job_runs.status = 'running'
            AND scheduled_job_runs.started_at < to_char(now() - interval '2 hours', 'YYYY-MM-DD HH24:MI:SS'))
     RETURNING job`,
    [job, runDate],
  );
  return Boolean(row);
}

/** Status of a job's run for a date ('running' | 'done' | 'failed'), or null if it hasn't run. */
export async function getScheduledJobStatus(job, runDate) {
  const row = await firstRow('SELECT status FROM scheduled_job_runs WHERE job = $1 AND run_date = $2', [job, runDate]);
  return row?.status ?? null;
}

export async function finishScheduledJobRun(job, runDate, status, detail = {}) {
  await query(
    `UPDATE scheduled_job_runs
     SET status = $3, detail = $4, finished_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
     WHERE job = $1 AND run_date = $2`,
    [job, runDate, status, JSON.stringify(detail)],
  );
}

/**
 * Run a SQL script (one or more statements) in a single transaction, giving
 * up after `timeoutMs`. Returns the total rows affected.
 */
export async function runSqlScript(sql, timeoutMs) {
  if (!pool) throw new Error('Database not initialised');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${Math.round(timeoutMs)}`);
    // Scripts work in market time: now(), date_trunc and to_char use this zone.
    await client.query(`SET LOCAL TIME ZONE '${MARKET_TIME_ZONE}'`);
    const result = await client.query(sql);
    await client.query('COMMIT');
    const results = Array.isArray(result) ? result : [result];
    return results.reduce((sum, r) => sum + (r.rowCount || 0), 0);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Runs of every job whose name starts with `prefix`, newest first. */
export async function getScheduledJobRunsByPrefix(prefix, limit = 50) {
  return rows(
    `SELECT job, run_date, status, detail, started_at, finished_at FROM scheduled_job_runs
     WHERE left(job, length($1)) = $1 ORDER BY run_date DESC, job LIMIT $2`,
    [prefix, limit],
  );
}

export async function getScheduledJobRuns(job, limit = 10) {
  return rows(
    'SELECT run_date, status, detail, started_at, finished_at FROM scheduled_job_runs WHERE job = $1 ORDER BY run_date DESC LIMIT $2',
    [job, limit],
  );
}

export async function getOiHistoryExpiryMonths(scrip, minExpiryDate, limit = 3) {
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
    [scrip, minExpiryDate, limit],
  );
  return result.map((r) => r.month);
}

export async function deleteOiHistoryByMonth(month) {
  const res = await query("DELETE FROM oi_history WHERE date LIKE $1 || '%'", [month]);
  await query("DELETE FROM oi_history_futures WHERE date LIKE $1 || '%'", [month]);
  return res.rowCount;
}

export async function deleteOiHistoryByScrip(scrip) {
  const res = await query('DELETE FROM oi_history WHERE scrip = $1', [scrip]);
  await query('DELETE FROM oi_history_futures WHERE scrip = $1', [scrip]);
  return res.rowCount;
}

export async function deleteOiHistoryByExpiryMonth(scrip, expiryMonth) {
  const res = await query("DELETE FROM oi_history WHERE scrip = $1 AND expiry LIKE $2 || '%'", [scrip, expiryMonth]);
  await query("DELETE FROM oi_history_futures WHERE scrip = $1 AND expiry LIKE $2 || '%'", [scrip, expiryMonth]);
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

/**
 * F&O underlyings (the names option contracts carry) with their price row:
 * the index row whose fno_name matches ("NIFTY" -> "NIFTY 50"), otherwise the
 * stock's NSE EQ row of the same tradingsymbol. `name` limits it to one.
 * instrumentToken is null when no price row is known for the name.
 */
async function queryUnderlyings(name = null) {
  const result = await rows(
    `WITH fno AS (
       SELECT DISTINCT name FROM instruments
       WHERE exchange = 'NFO' AND instrument_type IN ('CE', 'PE') AND ($1::text IS NULL OR name = $1)
     )
     SELECT DISTINCT ON (f.name)
       f.name,
       p.instrument_token, p.tradingsymbol, p.exchange,
       p.label, p.tradingview_symbol, p.always_snapshot, p.is_market_reference
     FROM fno f
     -- Two joins rather than one with OR: the OR forces a nested loop (~0.6 s against ~30 ms).
     LEFT JOIN instruments i ON i.fno_name = f.name
     LEFT JOIN instruments e
       ON e.fno_name IS NULL AND e.exchange = 'NSE' AND e.instrument_type = 'EQ' AND e.tradingsymbol = f.name
     CROSS JOIN LATERAL (SELECT (CASE WHEN i.instrument_token IS NOT NULL THEN i ELSE e END).*) p
     ORDER BY f.name`,
    [name],
  );
  return result.map((row) => ({
    name: row.name,
    label: row.label || row.name,
    instrumentToken: row.instrument_token == null ? null : Number(row.instrument_token),
    exchange: row.exchange,
    tradingsymbol: row.tradingsymbol,
    tradingviewSymbol: row.tradingview_symbol || row.tradingsymbol,
    alwaysSnapshot: Boolean(row.always_snapshot),
    isMarketReference: Boolean(row.is_market_reference),
  }));
}

/** Every F&O underlying, by name. */
export async function getUnderlyings() {
  return queryUnderlyings();
}

/** One F&O underlying by its F&O name ("NIFTY", "RELIANCE"), or null. */
export async function getUnderlying(name) {
  return (await queryUnderlyings(name))[0] ?? null;
}

/**
 * The market reference index (is_market_reference): the stock setups'
 * market check compares each stock against it. Null when none is set.
 */
export async function getMarketReference() {
  const row = await firstRow('SELECT instrument_token, tradingsymbol, label FROM instruments WHERE is_market_reference LIMIT 1');
  return row ? { instrumentToken: Number(row.instrument_token), label: row.label || row.tradingsymbol } : null;
}

/** F&O names of the underlyings marked always_snapshot. */
export async function getAlwaysSnapshotSymbols() {
  const result = await rows('SELECT COALESCE(fno_name, tradingsymbol) AS name FROM instruments WHERE always_snapshot ORDER BY 1');
  return result.map((r) => r.name);
}

/**
 * Set always_snapshot on an underlying's price row. Returns the updated
 * underlying, or null when the name has no price row.
 */
export async function setAlwaysSnapshot(name, alwaysSnapshot) {
  const underlying = await getUnderlying(name);
  if (!underlying?.instrumentToken) return null;
  await query('UPDATE instruments SET always_snapshot = $2 WHERE instrument_token = $1', [underlying.instrumentToken, alwaysSnapshot]);
  return { ...underlying, alwaysSnapshot };
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

// ---------- Stock candles and setups (watchlist) ----------

/** An NSE or BSE cash stock by token, or null for anything else (indices are stored as NSE EQ but contain a space). */
export async function getCashStock(instrumentToken) {
  const row = await firstRow(
    `SELECT instrument_token, tradingsymbol FROM instruments
     WHERE instrument_token = $1 AND exchange IN ('NSE', 'BSE') AND instrument_type = 'EQ' AND tradingsymbol NOT LIKE '% %'`,
    [instrumentToken],
  );
  return row ? { instrumentToken: Number(row.instrument_token), tradingsymbol: row.tradingsymbol } : null;
}

/** Every distinct NSE or BSE cash stock in any user's watchlist. */
export async function getWatchlistStocks() {
  const result = await rows(
    `SELECT DISTINCT ON (instrument_token) instrument_token, tradingsymbol
     FROM watchlist_items
     WHERE exchange IN ('NSE', 'BSE') AND tradingsymbol NOT LIKE '% %'
     ORDER BY instrument_token`,
  );
  return result.map((row) => ({ instrumentToken: Number(row.instrument_token), tradingsymbol: row.tradingsymbol }));
}

export async function getStockCandles(instrumentToken) {
  const result = await rows(
    'SELECT date, open, high, low, close, volume FROM stock_daily_candles WHERE instrument_token = $1 ORDER BY date',
    [instrumentToken],
  );
  return result.map((row) => ({ date: row.date, open: row.open, high: row.high, low: row.low, close: row.close, volume: Number(row.volume) }));
}

export async function getStockCandleSync(instrumentToken) {
  const row = await firstRow('SELECT latest_candle_date, checked_at, full_fetched_at FROM stock_candle_sync WHERE instrument_token = $1', [instrumentToken]);
  return row ? { latestCandleDate: row.latest_candle_date, checkedAt: Number(row.checked_at), fullFetchedAt: Number(row.full_fetched_at) } : null;
}

/**
 * Store fetched candles and record the check. `replace` drops the stock's stored
 * history first (a full refetch, e.g. after a split rewrote past prices).
 */
export async function saveStockCandles(instrumentToken, candles, { replace = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (replace) await client.query('DELETE FROM stock_daily_candles WHERE instrument_token = $1', [instrumentToken]);
    await insertInBatches(
      client,
      'INSERT INTO stock_daily_candles (instrument_token, date, open, high, low, close, volume)',
      `ON CONFLICT (instrument_token, date) DO UPDATE SET
        open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
        close = EXCLUDED.close, volume = EXCLUDED.volume`,
      lastPerKey(candles, (c) => c.date).map((c) => [instrumentToken, c.date, c.open, c.high, c.low, c.close, Math.round(c.volume)]),
    );
    const now = Date.now();
    await client.query(
      `INSERT INTO stock_candle_sync (instrument_token, latest_candle_date, checked_at, full_fetched_at)
       VALUES ($1, (SELECT MAX(date) FROM stock_daily_candles WHERE instrument_token = $1), $2, $2)
       ON CONFLICT (instrument_token) DO UPDATE SET
         latest_candle_date = EXCLUDED.latest_candle_date,
         checked_at = EXCLUDED.checked_at,
         full_fetched_at = CASE WHEN $3 THEN EXCLUDED.full_fetched_at ELSE stock_candle_sync.full_fetched_at END`,
      [instrumentToken, now, replace],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}

/**
 * Store a stock's latest scan summary on its sync row. Scans run on stored
 * candles, and storing candles creates the row, so it always exists.
 */
export async function saveStockScan(instrumentToken, summary) {
  await query(
    'UPDATE stock_candle_sync SET scan_summary = $2 WHERE instrument_token = $1',
    [instrumentToken, JSON.stringify(summary)],
  );
}

/** Latest scan for each stock in the user's watchlists. */
export async function getStockScansForUser(userId) {
  const result = await rows(
    `SELECT s.instrument_token, s.scan_summary
     FROM stock_candle_sync s
     WHERE s.scan_summary IS NOT NULL AND s.instrument_token IN (
       SELECT wi.instrument_token FROM watchlist_items wi
       JOIN watchlists w ON w.id = wi.watchlist_id
       WHERE w.user_id = $1
     )`,
    [userId],
  );
  return result.map((row) => ({ instrumentToken: Number(row.instrument_token), summary: row.scan_summary }));
}

/** Record setups, with their outcome when already known (a backfill); one per stock, day and type. Existing ones are kept. */
export async function insertStockSetupSignals(signals) {
  if (!signals.length) return;
  const client = await pool.connect();
  try {
    await insertInBatches(
      client,
      `INSERT INTO stock_setup_signals
        (instrument_token, tradingsymbol, signal_date, setup_type, direction, entry, stop, target,
         status, resolved_date, sessions_held, max_favorable_pct, max_adverse_pct, created_at)`,
      'ON CONFLICT (instrument_token, signal_date, setup_type) DO NOTHING',
      signals.map((s) => [
        s.instrumentToken, s.tradingsymbol, s.signalDate, s.setupType, s.direction, s.entry, s.stop, s.target,
        s.outcome?.status ?? 'open', s.outcome?.resolvedDate ?? null, s.outcome?.sessionsHeld ?? 0,
        s.outcome?.maxFavorablePct ?? null, s.outcome?.maxAdversePct ?? null, Date.now(),
      ]),
    );
  } finally { client.release(); }
}

export async function getOpenStockSetupSignals(instrumentToken) {
  const result = await rows(
    `SELECT id, signal_date, setup_type, direction, entry, stop, target
     FROM stock_setup_signals WHERE instrument_token = $1 AND status = 'open' ORDER BY signal_date`,
    [instrumentToken],
  );
  return result.map((row) => ({
    id: Number(row.id), signalDate: row.signal_date, setupType: row.setup_type, direction: row.direction,
    entry: row.entry, stop: row.stop, target: row.target,
  }));
}

export async function updateStockSetupSignal(id, outcome) {
  await query(
    `UPDATE stock_setup_signals
     SET status = $2, resolved_date = $3, sessions_held = $4, max_favorable_pct = $5, max_adverse_pct = $6
     WHERE id = $1`,
    [id, outcome.status, outcome.resolvedDate, outcome.sessionsHeld, outcome.maxFavorablePct, outcome.maxAdversePct],
  );
}

/** Outcome counts per setup type for one stock. */
export async function getStockSetupStats(instrumentToken) {
  const result = await rows(
    `SELECT setup_type, direction,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'open') AS open,
            COUNT(*) FILTER (WHERE status = 'target') AS target,
            COUNT(*) FILTER (WHERE status = 'stop') AS stop,
            COUNT(*) FILTER (WHERE status = 'expired') AS expired,
            AVG(max_favorable_pct) FILTER (WHERE status <> 'open') AS avg_favorable_pct,
            AVG(max_adverse_pct) FILTER (WHERE status <> 'open') AS avg_adverse_pct
     FROM stock_setup_signals
     WHERE instrument_token = $1
     GROUP BY setup_type, direction
     ORDER BY setup_type`,
    [instrumentToken],
  );
  return result.map((row) => ({
    setupType: row.setup_type, direction: row.direction,
    total: Number(row.total), open: Number(row.open), target: Number(row.target), stop: Number(row.stop), expired: Number(row.expired),
    avgFavorablePct: row.avg_favorable_pct === null ? null : Number(row.avg_favorable_pct),
    avgAdversePct: row.avg_adverse_pct === null ? null : Number(row.avg_adverse_pct),
  }));
}

/** One stock's recent setups, newest first. */
export async function getStockSetupSignals(instrumentToken, limit = 50) {
  const result = await rows(
    `SELECT s.id, s.instrument_token, s.tradingsymbol, s.signal_date, s.setup_type, s.direction,
            s.entry, s.stop, s.target, s.status, s.resolved_date, s.sessions_held, s.max_favorable_pct, s.max_adverse_pct
     FROM stock_setup_signals s
     WHERE s.instrument_token = $1
     ORDER BY s.signal_date DESC, s.id DESC
     LIMIT $2`,
    [instrumentToken, limit],
  );
  return result.map((row) => ({
    id: Number(row.id), instrumentToken: Number(row.instrument_token), tradingsymbol: row.tradingsymbol,
    signalDate: row.signal_date, setupType: row.setup_type, direction: row.direction,
    entry: row.entry, stop: row.stop, target: row.target, status: row.status, resolvedDate: row.resolved_date,
    sessionsHeld: row.sessions_held, maxFavorablePct: row.max_favorable_pct, maxAdversePct: row.max_adverse_pct,
  }));
}
