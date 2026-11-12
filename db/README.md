# OptionTrap database (PostgreSQL)

OptionTrap uses PostgreSQL for all persistence. Local development runs Postgres
in Docker; production uses a managed Postgres (e.g. Railway).

## Files

- `docker-compose.yml` — local Postgres 16 for development (port `5433`).
- `../server/migrations/*.sql` — versioned schema migrations, applied on startup.

## Schema migrations

The schema starts from `server/migrations/000_base_schema.sql`: every table and
index as one file. Numbered migrations after it (`001_…`, `002_…`) change it.
On startup the app (`server/migrationRunner.js`) runs any file not yet applied,
in filename order, and records it in the `schema_migrations` table. Restarts skip
already-applied files.

To change the schema (add a column, table, index, etc.), create a **new**
numbered file — for example `001_add_positions_tags.sql`. Never edit a migration
that has already run; the app will refuse to start if an applied file's contents
change (checksum mismatch).

The base file's `-- replaces: <file>` line names the last migration folded into
it. A database that has that migration recorded already has the whole base
schema, so the base file is recorded there without running. To fold more
migrations in, regenerate the base file, update that line and delete the files.

## Local development workflow

1. Start Postgres:

   ```bash
   docker compose -f db/docker-compose.yml up -d
   ```

2. Run the app. It reads `DATABASE_URL` from the root `.env` and applies any
   pending migrations automatically on boot:

   ```text
   DATABASE_URL=postgres://optiontrap:optiontrap@localhost:5433/optiontrap
   ```

   ```bash
   npm run dev
   ```

A brand-new/empty database needs no manual setup — `000_base_schema.sql` creates
all tables on first boot.

## Connection string

Local:

```text
postgres://optiontrap:optiontrap@localhost:5433/optiontrap
```

Production (Railway): use the `DATABASE_URL` provided by the Railway Postgres
plugin.

## GUI access

Use any PostgreSQL client (DBeaver, pgAdmin, TablePlus):

| Field    | Value        |
|----------|--------------|
| Host     | `localhost`  |
| Port     | `5433`       |
| Database | `optiontrap` |
| User     | `optiontrap` |
| Password | `optiontrap` |
