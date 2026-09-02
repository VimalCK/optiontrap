# TEMPORARY — remove after first prod seed

This entire `server/seed/` folder and its supporting code exist ONLY to load the
initial data into the first production PostgreSQL database. It is a one-time job.

## Once prod is verified working, remove ALL of the following:

1. Delete this folder: `server/seed/` (all CSVs + this file).
2. In `server/db.js`:
   - Remove the `runSeeds()` function.
   - Remove the `await runSeeds();` call inside `initDb()`.
   - Remove now-unused imports: `pipeline` (stream/promises), `Readable` (stream),
     `copyFrom` (pg-copy-streams), and the `SEED_DIR` constant.
3. Remove the `pg-copy-streams` dependency from:
   - `package.json`
   - `server/package.json`
   - (and run npm install to update lockfiles)
4. (Optional) In prod, drop the tracking table: `DROP TABLE seed_runs;`

## Verify removal
- `npm run build` passes.
- App still boots: `[DB] PostgreSQL initialised` (no `[DB] Seeded ...` lines).
- Existing prod data is untouched (seed only ever loads into empty tables).
