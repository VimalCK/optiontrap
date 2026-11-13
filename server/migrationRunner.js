/**
 * Applied files are recorded by name and checksum, and startup is refused when one was edited. The base schema
 * (000_base_schema.sql) is the end state of the migrations it replaces; its `-- replaces: <file>` line names the last one.
 *
 * - An empty database runs the base file like any other.
 * - A database that already has the `replaces` file recorded only records the base file, and the rows of deleted files
 *   are cleared.
 * - Any other database is refused: it is behind the base file (IF NOT EXISTS would skip existing tables), or the base
 *   file was edited without a new `replaces`.
 * The plan is a pure function (planMigrations), so every path is tested without a database.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { MigrationAction } from '../shared/appEnums.js';

export const BASE_SCHEMA_FILE = '000_base_schema.sql';

const REPLACES_LINE = /^-- replaces: (\S+\.sql)\s*$/m;

/**
 * @typedef {{ name: string, sql: string, checksum: string }} MigrationFile
 * @typedef {{ action: import('../shared/appEnums.js').MigrationActionId, file: MigrationFile }} MigrationStep
 */

/**
 * Over LF line endings, so a CRLF checkout matches.
 * @param {string} sql
 */
export const migrationChecksum = (sql) => crypto.createHash('sha256').update(sql).digest('hex');

/**
 * @param {MigrationFile} base
 * @returns {string}
 */
export function replacedMigration(base) {
  const match = REPLACES_LINE.exec(base.sql);
  if (!match) throw new Error(`${base.name} needs a "-- replaces: <last migration it replaces>.sql" line.`);
  return match[1];
}

/**
 * @param {MigrationFile} base
 * @param {Map<string, string>} applied
 * @returns {MigrationStep | null}
 */
function planBaseSchema(base, applied) {
  const recorded = applied.get(base.name);
  if (recorded === base.checksum) return null;
  const replaces = replacedMigration(base);
  if (applied.size === 0) return { action: MigrationAction.Run, file: base };
  if (applied.has(replaces)) return { action: MigrationAction.Record, file: base };
  if (recorded !== undefined) {
    throw new Error(`${base.name} was modified after being applied without folding in more migrations: change its schema with a new migration, or update its "-- replaces:" line when squashing.`);
  }
  throw new Error(`This database is behind ${base.name}: it hasn't run ${replaces}, the last migration the base file replaces. Bring it up to ${replaces} with the old migrations first.`);
}

/**
 * Throws when an applied file's checksum changed, or the database is behind the base file.
 * @param {MigrationFile[]} files  in filename order
 * @param {Map<string, string>} applied  name → checksum from schema_migrations
 * @returns {MigrationStep[]}
 */
export function planMigrations(files, applied) {
  /** @type {MigrationStep[]} */
  const steps = [];
  for (const file of files) {
    if (file.name === BASE_SCHEMA_FILE) {
      const step = planBaseSchema(file, applied);
      if (step) steps.push(step);
      continue;
    }
    const checksum = applied.get(file.name);
    if (checksum === undefined) {
      steps.push({ action: MigrationAction.Run, file });
      continue;
    }
    if (checksum !== file.checksum) {
      throw new Error(`Migration ${file.name} was modified after being applied. Add a new migration instead of editing it.`);
    }
  }
  return steps;
}

/**
 * @param {string} dir
 * @returns {MigrationFile[]}
 */
function readMigrationFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n');
      return { name, sql, checksum: migrationChecksum(sql) };
    });
}

/**
 * One step in its own transaction.
 * @param {import('pg').Pool} pool
 * @param {MigrationStep} step
 * @param {string[]} fileNames  every file in the folder
 */
async function applyStep(pool, { action, file }, fileNames) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (action === MigrationAction.Run) await client.query(file.sql);
    else await client.query('DELETE FROM schema_migrations WHERE NOT (name = ANY($1))', [fileNames]);
    await client.query(
      `INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`,
      [file.name, file.checksum],
    );
    await client.query('COMMIT');
    console.log(action === MigrationAction.Run ? `[DB] Applied migration ${file.name}` : `[DB] Recorded ${file.name} (the schema it builds is already here)`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`Migration ${file.name} failed: ${/** @type {Error} */ (err).message}`);
  } finally {
    client.release();
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} dir
 */
export async function runMigrations(pool, dir) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    )
  `);
  const files = readMigrationFiles(dir);
  const { rows } = await pool.query('SELECT name, checksum FROM schema_migrations');
  const applied = new Map(rows.map((row) => [row.name, row.checksum]));
  const fileNames = files.map((file) => file.name);
  for (const step of planMigrations(files, applied)) await applyStep(pool, step, fileNames);
}
