/**
 * The migration runner: applies server/migrations/*.sql in filename order,
 * once each, recording every applied file in schema_migrations by name and
 * checksum, and refusing to start when an applied file was edited.
 *
 * The base schema is the file named BASE_SCHEMA_FILE (000_base_schema.sql):
 * the end state of every migration it replaced, written as one schema. Its
 * `-- replaces: <file>` line names the last migration folded into it. To fold
 * more in, regenerate the base file, update that line and delete the files it
 * now covers, all in one release; no code changes.
 *
 * - A new (empty) database runs the base file like any other.
 * - A database that has the `replaces` file recorded already has everything
 *   the base file builds: the base file is recorded (or its checksum updated,
 *   after a new squash) without running, and the rows of deleted files are
 *   cleared, so schema_migrations lists only files that exist.
 * - Any other database is refused: it is behind the base file (its IF NOT
 *   EXISTS would skip existing tables and leave the later changes out), or
 *   the base file was edited without a new `replaces`.
 * The plan is a pure function (planMigrations) so every path is tested
 * without a database; runMigrations carries it out.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { MigrationAction } from '../shared/appEnums.js';

/** The base schema's file name, fixed so the runner can tell it from the migrations after it. */
export const BASE_SCHEMA_FILE = '000_base_schema.sql';

/** The base file's required line naming the last migration it replaces. */
const REPLACES_LINE = /^-- replaces: (\S+\.sql)\s*$/m;

/**
 * @typedef {{ name: string, sql: string, checksum: string }} MigrationFile
 * @typedef {{ action: import('../shared/appEnums.js').MigrationActionId, file: MigrationFile }} MigrationStep
 */

/**
 * A migration file's checksum, over LF line endings so a CRLF checkout matches.
 * @param {string} sql
 */
export const migrationChecksum = (sql) => crypto.createHash('sha256').update(sql).digest('hex');

/**
 * The last migration the base file replaces, from its `-- replaces:` line.
 * @param {MigrationFile} base
 * @returns {string}
 */
export function replacedMigration(base) {
  const match = REPLACES_LINE.exec(base.sql);
  if (!match) throw new Error(`${base.name} needs a "-- replaces: <last migration it replaces>.sql" line.`);
  return match[1];
}

/**
 * What to do with the base file: nothing when applied as it is, run it on an
 * empty database, or record it on one that has every migration it replaces.
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
 * What to do with each file not applied yet: run it, or (the base file on a
 * database that already has what it builds) only record it. Throws when an
 * applied file's checksum changed, or the database is behind the base file.
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
 * The .sql files in `dir`, in filename order, with LF line endings.
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
 * One step in its own transaction. Recording the base file also clears the
 * rows of the files it replaced (no longer in the folder), so schema_migrations
 * lists only files that exist.
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
 * Apply the pending migrations in `dir` to the database.
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
