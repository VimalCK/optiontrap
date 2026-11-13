import crypto from 'crypto';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { marketDayStartMs } from '../../shared/marketTime.js';
import { runMigrations } from '../migrationRunner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.DATABASE_URL
  || 'postgres://optiontrap:optiontrap@localhost:5433/optiontrap';

// Return integers as JS numbers (safe for our value ranges) instead of strings.
pg.types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10))); // int8/bigint
pg.types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val))); // numeric

/** @type {pg.Pool | null} */
export let pool = null;

/** Run a query against the pool. For nightly JS jobs; app code uses the named helpers. */
export async function query(text, params = []) {
  if (!pool) throw new Error('Database not initialised');
  return pool.query(text, params);
}

export async function rows(text, params = []) {
  const res = await query(text, params);
  return res.rows;
}

export async function firstRow(text, params = []) {
  const res = await query(text, params);
  return res.rows[0] || null;
}

/** Safe to call multiple times. */
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

  await runMigrations(pool, MIGRATIONS_DIR);

  await query('DELETE FROM sessions WHERE expires < $1', [Date.now()]);

  console.log('[DB] PostgreSQL initialised');
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Cross-process; the lock is released when the transaction ends, even if the process crashes.
 *
 * @param {number} lockKey
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
 * SHA-256 truncated to 8 bytes, read as a signed 64-bit key.
 *
 * @param {string} value
 * @returns {bigint}
 */
function advisoryLockKey(value) {
  const hash = crypto.createHash('sha256').update(value).digest();
  return hash.readBigInt64BE(0);
}

/**
 * @param {string} name
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withNamedAdvisoryLock(name, fn) {
  return withAdvisoryLock(advisoryLockKey(name), fn);
}

/**
 * Held on a connection of its own until released (one trade engine across servers). `onLost` runs if that
 * connection drops, which frees the lock for another process.
 * @param {string} name
 * @param {() => void} onLost
 * @returns {Promise<{ release: () => Promise<void> } | null>}
 */
export async function tryHoldNamedAdvisoryLock(name, onLost) {
  if (!pool) throw new Error('Database not initialised');
  const key = advisoryLockKey(name);
  const client = await pool.connect();
  try {
    const { rows: [{ held }] } = await client.query('SELECT pg_try_advisory_lock($1) AS held', [key]);
    if (!held) {
      client.release();
      return null;
    }
  } catch (err) {
    client.release();
    throw err;
  }
  let released = false;
  client.on('error', () => {
    if (released) return;
    released = true;
    client.release(true);
    onLost();
  });
  return {
    async release() {
      if (released) return;
      released = true;
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [key]);
      } finally {
        client.release();
      }
    },
  };
}

export async function pingDb() {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * With ON CONFLICT DO UPDATE the caller must de-duplicate rows by the conflict key first: Postgres rejects a
 * statement that would update the same row twice.
 */
export async function insertInBatches(client, insertPrefix, suffix, rowValues, batchSize = 1000) {
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

/** Epoch ms of market-zone midnight starting the day that contains `timestamp` (default: now). */
export function getTodayMidnight(timestamp = Date.now()) {
  return marketDayStartMs(timestamp);
}
