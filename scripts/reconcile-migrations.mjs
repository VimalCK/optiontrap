// One-time fix: reconcile stored migration checksums with the normalized
// (LF) checksums of the current files. Safe because the migration CONTENT is
// unchanged — only line endings drifted (CRLF vs LF). Only updates rows that
// already exist in schema_migrations; never inserts or runs migration SQL.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../server/migrations');
const DATABASE_URL = process.env.DATABASE_URL
  || 'postgres://optiontrap:optiontrap@localhost:5433/optiontrap';

const pool = new pg.Pool({ connectionString: DATABASE_URL });

const { rows } = await pool.query('SELECT name, checksum FROM schema_migrations');
const stored = new Map(rows.map((r) => [r.name, r.checksum]));

let updated = 0;
for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
  if (!stored.has(file)) continue; // not applied yet — leave for the server to run

  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replace(/\r\n/g, '\n');
  const normalized = crypto.createHash('sha256').update(sql).digest('hex');

  if (stored.get(file) !== normalized) {
    await pool.query('UPDATE schema_migrations SET checksum = $1 WHERE name = $2', [normalized, file]);
    console.log(`Reconciled ${file}`);
    updated += 1;
  } else {
    console.log(`OK        ${file}`);
  }
}

console.log(`\nDone. ${updated} checksum(s) reconciled.`);
await pool.end();
