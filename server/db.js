/**
 * SQLite Database Manager
 *
 * Manages persistent storage for OptionTrap using sql.js (pure-JS SQLite).
 * The database lives at server/data/optiontrap.db and is auto-created on
 * first run.
 *
 * Currently handles:
 *   - user_credentials: per-user Kite API key + AES-256-GCM encrypted secret
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
